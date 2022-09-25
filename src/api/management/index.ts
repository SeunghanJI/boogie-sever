import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import multer from 'multer';
import dotenv from 'dotenv';
import sharp from 'sharp';
import s3Controller from '../../s3/index';
import { checkRequiredProperties, generatedUniqueID } from '../../utils';
import { setViewCount } from '../../view/index';
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
    const email = res.locals.email;

    try {
      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!isAdmin) {
        return res
          .status(403)
          .json({ code: 403, message: '관리자 계정이 아닙니다.' });
      }

      res.status(200).json({ test: 'test' });
    } catch (error: any) {
      console.log(error);
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get('/banner', async (req: Request, res: Response) => {});

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

app.delete('/banner/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
});

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
