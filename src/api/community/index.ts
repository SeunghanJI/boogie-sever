import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ko';
import { checkRequiredProperties, generatedUniqueID } from '../../utils';
import { verifyAccessToken, getUserEmail } from '../../token/index';
import { setViewCount } from '../../view/index';
import s3Controller from '../../s3/index';
dotenv.config();
dayjs.extend(relativeTime);
dayjs.locale('ko');

const app: express.Application = express();
const knex: Knex = require('knex')({
  client: 'mysql',
  connection: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    typeCast: (field: any, next: NextFunction) => {
      if (field.type === 'TINY' && field.length === 4) {
        let value = field.string();
        return value ? value === '1' : null;
      }
      return next();
    },
  },
});
const PAGE_LIMIT = 20;

interface BoardContent {
  id: string;
  userId: string;
  userNickname: string;
  title: string;
  content: string;
  likeCount?: number;
  commentCount?: number;
  fromNowWhileAgoPosted?: string;
  profileImageURL?: string | null;
  uploadedAt?: string;
  totalCommentLikes?: number;
  isMe?: boolean;
}
interface Comment {
  id: number;
  userId: string;
  userNickname: string;
  content: string;
  uploadedAt?: string;
  fromNowWhileAgoPosted?: string;
  profileImageURL?: string | null;
}

app.post('/', verifyAccessToken, async (req: Request, res: Response) => {
  const body = req.body;

  if (!checkRequiredProperties(['categoryId', 'title', 'content'], body)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const email: string = res.locals.email;
  const uniqueID: string = generatedUniqueID();

  try {
    await knex('board_content').insert({
      id: uniqueID,
      user_id: email,
      category_id: body.categoryId,
      title: body.title,
      content: body.content,
      uploaded_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });

    res.status(201).json({ isPosted: true });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const formatComments = (
  comments: Comment[],
  email: string
): Promise<Comment>[] => {
  return comments.map(async (comment: Comment) => {
    let isMe: boolean = false;
    if (email === comment.userId) {
      isMe = true;
    }
    return {
      id: comment.id,
      userId: comment.userId,
      userNickname: comment.userNickname,
      content: comment.content,
      fromNowWhileAgoPosted: dayjs(`${comment.uploadedAt}`).fromNow(),
      ...(isMe && { isMe }),
      ...(!!comment.profileImageURL && {
        profileImageURL: (
          (await s3Controller.getObjectURL(comment.profileImageURL)) as string
        ).split('?')[0],
      }),
    };
  });
};

const getComments = (id: string): Promise<Comment[]> => {
  return knex('board_comment')
    .select(
      'board_comment.id as id',
      'board_comment.user_id as userId',
      'user.nickname as userNickname',
      'board_comment.content as content',
      'board_comment.uploaded_at as uploadedAt',
      'user_profile.image as profileImageURL'
    )
    .leftJoin('user', 'user.id', 'board_comment.user_id')
    .leftJoin('user_profile', 'user_profile.user_id', 'board_comment.user_id')
    .where({
      'board_comment.board_content_id': id,
      'board_comment.is_deleted': false,
    })
    .orderBy('board_comment.uploaded_at', 'desc');
};

app.post('/comment', verifyAccessToken, async (req: Request, res: Response) => {
  const body = req.body;

  if (!checkRequiredProperties(['id', 'content'], body)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const email: string = res.locals.email;

  try {
    await knex('board_comment').insert({
      board_content_id: body.id,
      user_id: email,
      content: body.content,
      uploaded_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });

    const originalComments: Comment[] = await getComments(body.id);
    const comments: Comment[] = await Promise.all(
      formatComments(originalComments, email)
    );

    res.status(201).json({ comments });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const checkLiked = (id: string, email: string): Promise<boolean> => {
  const isLiked: Promise<boolean> = (async () => {
    const liked: { isDeleted: boolean } | undefined = await knex('board_like')
      .select('is_deleted as isDeleted')
      .where({ board_content_id: id, user_id: email })
      .first();

    if (!liked) {
      return false;
    }

    return liked.isDeleted ? false : true;
  })();

  return isLiked;
};

app.patch('/', verifyAccessToken, async (req: Request, res: Response) => {
  const body = req.body;

  if (!checkRequiredProperties(['id', 'title', 'content'], body)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const email: string = res.locals.email;

  try {
    const hasAuthority = await knex('board_content')
      .select('user_id')
      .where({ user_id: email })
      .first();

    const { is_admin: isAdmin } = await knex('user')
      .select('is_admin')
      .where({ id: email })
      .first();

    if (!hasAuthority && !isAdmin) {
      return res.status(400).json({ message: '수정 할 권한이 없습니다.' });
    }

    await knex('board_content')
      .update({ title: body.title, content: body.content })
      .where({ id: body.id });

    res.status(200).json({ isUpdated: true });
  } catch (error: any) {
    console.log(error);
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.patch(
  '/like/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const id: string = req.params.id;
    const email: string = res.locals.email;

    if (!id) {
      return res.status(400).json({ message: '잘못된 요입니다.' });
    }

    try {
      const isLiked: boolean = await checkLiked(id, email);

      await knex('board_like')
        .insert({
          board_content_id: id,
          user_id: email,
          updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          is_deleted: isLiked,
        })
        .onConflict()
        .merge();

      const { likeCount }: { likeCount: number } = (await knex('board_like')
        .count('board_content_id as likeCount')
        .where({ board_content_id: id, is_deleted: 0 })
        .first()) as { likeCount: number };

      res.status(200).json({ isLiked: !isLiked, likeCount });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.delete('/:id', verifyAccessToken, async (req: Request, res: Response) => {
  const id: string = req.params.id;
  const email: string = res.locals.email;

  try {
    const hasAuthority = await knex('board_comment')
      .select('user_id')
      .where({ user_id: email })
      .first();

    const { is_admin: isAdmin } = await knex('user')
      .select('is_admin')
      .where({ id: email })
      .first();

    if (!hasAuthority && !isAdmin) {
      return res.status(400).json({ message: '삭제 할 권한이 없습니다.' });
    }

    await knex('board_content').update({ is_deleted: 1 }).where({ id });

    res.status(200).json({ isDeleted: true });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.delete(
  '/comment/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const id: string = req.params.id;
    const email: string = res.locals.email;

    try {
      const hasAuthority = await knex('board_comment')
        .select('user_id')
        .where({ user_id: email })
        .first();

      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!hasAuthority && !isAdmin) {
        return res.status(400).json({ message: '삭제 할 권한이 없습니다.' });
      }

      await knex('board_comment').update({ is_deleted: true }).where({ id });

      const { boardContentId } = await knex('board_comment')
        .select('board_content_id as boardContentId')
        .where({ id })
        .first();
      const originalComments: Comment[] = await getComments(boardContentId);
      const comments: Comment[] = await Promise.all(
        formatComments(originalComments, email)
      );
      const { commentCount } = (await knex('board_comment')
        .count('board_content_id as commentCount')
        .where({ board_content_id: boardContentId, is_deleted: 0 })
        .first()) as { commentCount: number };

      res.status(201).json({ comments, commentCount });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

const formatBoardContent = async (
  email: string,
  boardContent: BoardContent
) => {
  const { profileImageURL, uploadedAt, ...data } = boardContent;
  const isLiked: boolean = await checkLiked(data.id, email || '');
  const [like, comment] = (await Promise.all([
    knex('board_like')
      .count('board_content_id as count')
      .where({ board_content_id: data.id, is_deleted: 0 })
      .first(),
    knex('board_comment')
      .count('board_content_id as count')
      .where({ board_content_id: data.id, is_deleted: 0 })
      .first(),
  ])) as { count: number }[];

  return {
    likeCount: like.count,
    commentCount: comment.count,
    fromNowWhileAgoPosted: dayjs(uploadedAt).fromNow(),
    ...data,
    ...(isLiked && { isLiked }),
    ...(!!profileImageURL && {
      profileImageURL: (
        (await s3Controller.getObjectURL(profileImageURL)) as string
      ).split('?')[0],
    }),
  };
};

app.get(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    setViewCount(req, res, next, 'board_content');
  },
  getUserEmail,
  async (req: Request, res: Response) => {
    const id: string = req.query.id as string;
    const email: string = res.locals.email;

    if (!id) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    try {
      const originalBoardContent: BoardContent = await knex('board_content')
        .select(
          'board_content.id as id',
          'board_content.category_id as categoryId',
          'board_content.user_id as userId',
          'user.nickname as userNickname',
          'board_content.title as title',
          'board_content.content as content',
          'board_content.uploaded_at as uploadedAt',
          'user_profile.image as profileImageURL'
        )
        .leftJoin('user', 'user.id', 'board_content.user_id')
        .leftJoin(
          'user_profile',
          'user_profile.user_id',
          'board_content.user_id'
        )
        .where({
          'board_content.id': id,
          'board_content.is_deleted': false,
        })
        .first();

      if (email === originalBoardContent.userId) {
        originalBoardContent.isMe = true;
      }

      const content = await formatBoardContent(email, originalBoardContent);

      res.status(200).json({ content });
    } catch (error: any) {
      console.log(error);
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

const getBoardContents = (
  categoryId: any,
  offset: number
): Promise<BoardContent[]> => {
  return knex('board_content')
    .select(
      'board_content.id as id',
      'board_content.user_id as userId',
      'user.nickname as userNickname',
      'board_content.title as title',
      'board_content.content as content',
      'board_content.uploaded_at as uploadedAt',
      'user_profile.image as profileImageURL'
    )
    .leftJoin('user', 'user.id', 'board_content.user_id')
    .leftJoin('user_profile', 'user_profile.user_id', 'board_content.user_id')
    .where({
      'board_content.category_id': categoryId,
      'board_content.is_deleted': false,
    })
    .orderBy('board_content.uploaded_at', 'desc')
    .limit(PAGE_LIMIT)
    .offset(offset);
};

app.get('/list', getUserEmail, async (req: Request, res: Response) => {
  const query = req.query;
  const email: string = res.locals.email;

  if (!checkRequiredProperties(['categoryId', 'page'], query)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  if (Number(query.page as string) < 1) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const currentPageContentList: BoardContent[] = await getBoardContents(
      query.categoryId,
      (Number(query.page as string) - 1) * PAGE_LIMIT
    );
    const nextPageNumber: number = await (async (): Promise<number> => {
      const nextPageContentList: BoardContent[] = await getBoardContents(
        query.categoryId,
        Number(query.page as string) * PAGE_LIMIT
      );

      if (!nextPageContentList.length) {
        return -1;
      }

      return Number(query.page as string) + 1;
    })();

    const contentList: BoardContent[] = await Promise.all(
      currentPageContentList.map((contentInfo: BoardContent) =>
        formatBoardContent(email, contentInfo)
      )
    );

    res.status(200).json({ contentList, page: nextPageNumber });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const bestBoardContents = (contentList: BoardContent[]): BoardContent[] => {
  const bestPickList: BoardContent[] = contentList
    .map((content: BoardContent) => {
      content.totalCommentLikes =
        (content.commentCount as number) * 2 + (content.likeCount as number);

      return content;
    }, [])
    .sort(
      (a: BoardContent, b: BoardContent) =>
        (b.totalCommentLikes as number) - (a.totalCommentLikes as number)
    )
    .slice(0, 3);

  bestPickList.forEach(
    (bestPick: BoardContent) => delete bestPick.totalCommentLikes
  );

  return bestPickList;
};

app.get('/best-pick', async (req: Request, res: Response) => {
  const categoryId: string = req.query.categoryId as string;

  if (!categoryId) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const yesterday: string = dayjs().add(-1, 'day').format('YYYY-MM-DD');
    const boardContents: BoardContent[] = await knex('board_content')
      .select(
        'board_content.id as id',
        'user.nickname as userNickname',
        'board_content.title as title',
        'board_content.uploaded_at as uploadedAt',
        'user_profile.image as profileImageURL'
      )
      .leftJoin('user', 'user.id', 'board_content.user_id')
      .leftJoin('user_profile', 'user_profile.user_id', 'board_content.user_id')
      .where({
        'board_content.category_id': categoryId,
        'board_content.is_deleted': false,
      })
      .andWhere('board_content.uploaded_at', '>=', yesterday)
      .orderBy('board_content.uploaded_at');

    const contentList: BoardContent[] = await Promise.all(
      boardContents.map((content: BoardContent) =>
        formatBoardContent('', content)
      )
    );

    const bestPickList: BoardContent[] = bestBoardContents(contentList);

    res.status(200).json({ content: bestPickList });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/comments', getUserEmail, async (req: Request, res: Response) => {
  const id: string = req.query.id as string;
  const email: string = res.locals.email;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const originalComments: Comment[] = await getComments(id);
    const comments: Comment[] = await Promise.all(
      formatComments(originalComments, email)
    );

    res.status(200).json({ comments });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
