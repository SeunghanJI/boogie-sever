import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import s3Controller from '../../s3/index';
import dotenv from 'dotenv';
dotenv.config();

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

const fomatBannerList = (bannerInfo: any) => {
  return bannerInfo.map(async (info: any) => {
    const bannerImage = (
      (await s3Controller.getObjectURL(`banner/${info.id}`)) as string
    ).split('?')[0];

    return bannerImage;
  });
};

app.get('/', async (req: Request, res: Response) => {
  try {
    const bannerInfo = await knex('banner').select('id');
    const bannerImageList = await Promise.all(fomatBannerList(bannerInfo));

    res.status(200).json({ bannerImageList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
