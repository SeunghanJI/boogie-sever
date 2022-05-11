import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ko';
import { checkRequiredProperties, getUniqueID } from '../../utils';
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
  likeCount: number;
  commentCount: number;
  fromNowWhileAgoPosted?: string;
  profileImageURL?: string | null;
  uploadedAt?: string;
  totalCommentLikes?: number;
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
  const uniqueID: string = getUniqueID();

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

const formatComments = (comments: Comment[]): Comment[] => {
  return comments.map((comment: Comment) => {
    return {
      id: comment.id,
      userId: comment.userId,
      userNickname: comment.userNickname,
      content: comment.content,
      fromNowWhileAgoPosted: dayjs(`${comment.uploadedAt}`).fromNow(),
      ...(!!comment.profileImageURL && {
        profileImageURL: comment.profileImageURL,
      }),
    };
  });
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

    const comments: Comment[] = await knex('board_comment')
      .select(
        'board_comment.id as id',
        'board_comment.user_id as userId',
        'user.nickname as userNickname',
        'board_comment.content as content',
        'board_comment.uploaded_at as uploadedAt',
        'user_profile.image as profileImageURL'
      )
      .innerJoin(
        'user_profile',
        'user_profile.user_id',
        'board_comment.user_id'
      )
      .innerJoin('user', 'user.id', 'board_comment.user_id')
      .where({ 'board_comment.board_content_id': body.id, is_deleted: 0 });

    res.status(201).json({ comments: formatComments(comments) });
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

    return liked?.isDeleted ? false : true;
  })();

  return isLiked;
};

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

      res.status(200).json({ isLike: !isLiked });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

const formatBoardContent = async (
  email: string,
  boardContent: BoardContent
) => {
  const { profileImageURL, uploadedAt, ...data } = Object.assign(boardContent);
  const isLiked: boolean = await checkLiked(data.id, email || '');
  const { likeCount }: { likeCount: number } = (await knex('board_like')
    .count('board_content_id as likeCount')
    .where({ board_content_id: data.id })
    .first()) as { likeCount: number };
  const { commentCount }: { commentCount: number } = (await knex(
    'board_comment'
  )
    .count('board_content_id as commentCount')
    .where({ board_content_id: data.id })
    .first()) as { commentCount: number };

  return {
    likeCount,
    commentCount,
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
      const boardContent: BoardContent = await knex('board_content')
        .select(
          'board_content.id as id',
          'board_content.user_id as userId',
          'user.nickname as userNickname',
          'board_content.title as title',
          'board_content.content as content',
          'board_content.uploaded_at as uploadedAt',
          'user_profile.image as profileImageURL'
        )
        .innerJoin('user', 'user.id', 'board_content.user_id')
        .innerJoin(
          'user_profile',
          'user_profile.user_id',
          'board_content.user_id'
        )
        .where({
          'board_content.id': id,
          'board_content.is_deleted': false,
        })
        .first();

      res
        .status(200)
        .json({ content: await formatBoardContent(email, boardContent) });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get('/list', getUserEmail, async (req: Request, res: Response) => {
  const query = req.query;
  const email: string = res.locals.email;

  if (!checkRequiredProperties(['categoryId', 'page'], query)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const boardContents: BoardContent[] = await knex('board_content')
      .select(
        'board_content.id as id',
        'board_content.user_id as userId',
        'user.nickname as userNickname',
        'board_content.title as title',
        'board_content.content as content',
        'board_content.uploaded_at as uploadedAt',
        'user_profile.image as profileImageURL'
      )
      .innerJoin('user', 'user.id', 'board_content.user_id')
      .innerJoin(
        'user_profile',
        'user_profile.user_id',
        'board_content.user_id'
      )
      .where({
        'board_content.category_id': query.categoryId,
      })
      .orderBy('board_content.uploaded_at');

    const contentList: BoardContent[] = await Promise.all(
      boardContents.map((content: BoardContent) =>
        formatBoardContent(email, content)
      )
    );

    const startIndex: number = (Number(query.page as string) - 1) * PAGE_LIMIT;
    const endIndex: number = Number(query.page as string) * PAGE_LIMIT - 1;
    const currentPageContentList: BoardContent[] = contentList.slice(
      startIndex,
      endIndex
    );
    const nextPageNumber: number = ((): number => {
      const nextPageContentList: BoardContent[] = contentList.slice(
        startIndex + PAGE_LIMIT,
        endIndex + PAGE_LIMIT
      );

      if (!nextPageContentList.length) {
        return -1;
      }

      return Number(query.page as string) + 1;
    })();

    res
      .status(200)
      .json({ contentList: currentPageContentList, page: nextPageNumber });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const boardContentBestPick = (contentList: BoardContent[]): BoardContent[] => {
  const bestPickList = contentList
    .map((content: BoardContent) => {
      content.totalCommentLikes = content.commentCount * 2 + content.likeCount;

      return content;
    }, [])
    .sort(
      (a: BoardContent, b: BoardContent) =>
        (b.totalCommentLikes as number) - (a.totalCommentLikes as number)
    )
    .slice(0, 3)
    .map((content: BoardContent) => {
      delete content.totalCommentLikes;
      return content;
    });

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
      .innerJoin('user', 'user.id', 'board_content.user_id')
      .innerJoin(
        'user_profile',
        'user_profile.user_id',
        'board_content.user_id'
      )
      .where({
        'board_content.category_id': categoryId,
      })
      .andWhere('board_content.uploaded_at', '>=', yesterday)
      .orderBy('board_content.uploaded_at');

    const contentList: BoardContent[] = await Promise.all(
      boardContents.map((content: BoardContent) =>
        formatBoardContent('', content)
      )
    );

    const bestPickList = boardContentBestPick(contentList);

    res.status(200).json({ content: bestPickList });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/comments', async (req: Request, res: Response) => {
  const id: string = req.query.id as string;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const comments: Comment[] = await knex('board_comment')
      .select(
        'board_comment.board_content_id as id',
        'board_comment.user_id as userId',
        'user.nickname as userNickname',
        'board_comment.content as content',
        'board_comment.uploaded_at as uploadedAt',
        'user_profile.image as profileImageURL'
      )
      .innerJoin('user', 'user.id', 'board_comment.user_id')
      .innerJoin(
        'user_profile',
        'user_profile.user_id',
        'board_comment.user_id'
      )
      .where({
        'board_comment.board_content_id': id,
        'board_comment.is_deleted': false,
      });

    res.status(200).json({ comments: formatComments(comments) });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
