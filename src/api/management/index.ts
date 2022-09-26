import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import multer from 'multer';
import dotenv from 'dotenv';
import s3Controller from '../../s3/index';
import { checkRequiredProperties, generatedUniqueID } from '../../utils';
import { verifyAccessToken } from '../../token/index';
dotenv.config();
const SUPERVISOR_ID = process.env.SUPERVISOR_ID || '';

const app: express.Application = express();

const knex: Knex = require('knex')({
  client: 'mysql',
  connection: {
    host: process.env.DB_HOST,
    port: 3306,
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

const getAdminList = async () => {
  const adminList: { id: string; nickname: string }[] | [] = await knex('user')
    .select('id', 'nickname')
    .where({ is_admin: true })
    .andWhereNot({ id: SUPERVISOR_ID });

  return adminList;
};

const s3UploadFromBinary = async (files: {
  [fieldname: string]: Express.Multer.File[];
}): Promise<AWS.S3.ManagedUpload.SendData[]> => {
  const s3UploadResultList: Promise<AWS.S3.ManagedUpload.SendData>[] =
    Object.values(files).map(async ([file]) => {
      const uniqueId = generatedUniqueID();
      const key = `${uniqueId}_${file.originalname}`;

      await knex('banner').insert({
        name: file.originalname,
        id: key,
      });

      return s3Controller.uploadFile(file.buffer, `banner/${key}`);
    });

  return Promise.all(s3UploadResultList);
};

const formatBannerInfo = (bannerInfo: any) => {
  return bannerInfo.map(async (info: any) => {
    const s3URLPath = `banner/${info.id}`;
    const bannerImage = (
      (await s3Controller.getObjectURL(s3URLPath)) as string
    ).split('?')[0];

    return {
      fileName: info.name,
      image: bannerImage,
      key: info.id,
    };
  });
};

app.post(
  '/banner',
  multer({
    storage: multer.memoryStorage(),
  }).fields([
    { name: 'bannerImage0', maxCount: 1 },
    { name: 'bannerImage1', maxCount: 1 },
    { name: 'bannerImage2', maxCount: 1 },
    { name: 'bannerImage3', maxCount: 1 },
    { name: 'bannerImage4', maxCount: 1 },
  ]),
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const files: {
      [fieldname: string]: Express.Multer.File[];
    } = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };
    const requesterId = res.locals.email;

    try {
      const requester = await knex('user')
        .select('is_admin as isAdmin')
        .where({ id: requesterId })
        .first();

      if (!requester?.isAdmin) {
        return res.status(403).json({ message: '관리자 계정이 아닙니다.' });
      }

      const oleBannerInfo = await knex('banner').select('id', 'name');

      if (Object.values(files).length + oleBannerInfo.length > 5) {
        return res
          .status(400)
          .json({ message: '등록할려는 베너가 5개 이상입니다.' });
      }

      const s3UploadResult: AWS.S3.ManagedUpload.SendData[] =
        await s3UploadFromBinary(files);

      const newBannerInfo = await knex('banner').select('id', 'name');
      const bannerList = await Promise.all(formatBannerInfo(newBannerInfo));

      res.status(200).json({ bannerList });
    } catch (error: any) {
      console.log(error);
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get('/banner', verifyAccessToken, async (req: Request, res: Response) => {
  const requesterId: string = res.locals.email;

  try {
    const requester = await knex('user')
      .select('is_admin as isAdmin')
      .where({ id: requesterId })
      .first();

    if (!requester?.isAdmin) {
      return res.status(403).json({ message: '조회 권한 없습니다.' });
    }

    const bannerInfo = await knex('banner').select('id', 'name');
    const bannerList = await Promise.all(formatBannerInfo(bannerInfo));

    res.status(200).json({ bannerList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/student', verifyAccessToken, async (req: Request, res: Response) => {
  const requesterId: string = res.locals.email;
  const query = req.query;

  if (!(query?.uniId || query?.name)) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const requester = await knex('user')
      .select('is_admin as isAdmin')
      .where({ id: requesterId })
      .first();

    if (!requester?.isAdmin) {
      return res.status(403).json({ message: '조회 권한 없습니다.' });
    }

    const studentListQueryBuilder = knex('user').select(
      'id',
      'uni_id as uniId',
      'name'
    );
    if (query?.uniId) {
      studentListQueryBuilder.where({ uni_id: query.uniId });
    }
    if (query?.name) {
      studentListQueryBuilder.orWhere({ name: query.name });
    }

    const studentList: {
      id: string;
      uniId: string;
      name: string;
    }[] = await studentListQueryBuilder.whereNotNull('uni_id');
    res.status(200).json({ studentList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.patch(
  '/student',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const requesterId: string = res.locals.email;
    const body = req.body;

    if (!checkRequiredProperties(['id', 'uniId', 'name'], body)) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    const { name, id, uniId } = body;

    try {
      const requester = await knex('user')
        .select('is_admin as isAdmin')
        .where({ id: requesterId })
        .first();

      if (!requester?.isAdmin) {
        return res.status(403).json({ message: '조회 권한 없습니다.' });
      }

      await knex('user').update({ uni_id: uniId, name }).where({ id });

      const studentList = await knex('user')
        .select('id', 'uni_id as uniId', 'name')
        .where({ id });

      res.status(200).json({ studentList });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get(
  '/admin/list',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const requesterId = res.locals.email;

    try {
      const requester = await knex('user')
        .select('is_admin as isAdmin')
        .where({ id: requesterId })
        .first();

      if (!requester?.isAdmin) {
        return res.status(403).json({ message: '조회 권한 없습니다.' });
      }

      const adminList = await getAdminList();

      res.status(200).json({ adminList });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.delete(
  '/banner/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const requesterId = res.locals.email;
    const id = req.params.id;

    try {
      const requester = await knex('user')
        .select('is_admin as isAdmin')
        .where({ id: requesterId })
        .first();

      if (!requester?.isAdmin) {
        return res.status(403).json({ message: '관리자 계정이 아닙니다.' });
      }

      await Promise.all([
        s3Controller.deleteObject(`banner/${id}`),
        knex('banner').where({ id }).delete(),
      ]);

      const bannerInfo = await knex('banner').select('id', 'name');
      const bannerList = await Promise.all(formatBannerInfo(bannerInfo));

      res.status(200).json({ bannerList });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.delete(
  '/admin/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const requesterId = res.locals.email;
    const willDeleteAdmin = req.params?.id;

    try {
      if (requesterId !== SUPERVISOR_ID) {
        return res.status(403).json({ message: '삭제 권한 없습니다.' });
      }

      await knex('user').where({ id: willDeleteAdmin }).delete();

      const adminList = await getAdminList();

      res.status(200).json({ adminList });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

export default app;
