import express, { Response, Request, NextFunction } from 'express';
import { Knex } from 'knex';
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

export const REGION_MAP: { [key: string]: string } = {
  '02': '서울',
  '031': '경기',
  '032': '인천',
  '033': '강원',
  '041': '충남',
  '042': '대전',
  '043': '충북',
  '044': '세종',
  '051': '부산',
  '052': '울산',
  '053': '대구',
  '054': '경북',
  '055': '경남',
  '061': '전남',
  '062': '광주',
  '063': '전북',
  '064': '제주',
};

interface Category {
  id: number;
  name: string;
}

app.get('/job', async (req: Request, res: Response) => {
  try {
    const jobCategoryList: Category[] = await knex('job_category').select('*');
    res.status(200).json({ jobCategoryList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/region', (req: Request, res: Response) => {
  try {
    const regionList = Object.keys(REGION_MAP).reduce(
      (regionList: { id: string; name: string }[], region) => {
        regionList.push({ id: region, name: REGION_MAP[region] });
        return regionList;
      },
      []
    );
    res.status(200).json({ regionList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/plattform', async (req: Request, res: Response) => {
  try {
    const plattformList: Category[] = await knex('plattform').select('*');
    res.status(200).json({ plattformList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/technology', async (req: Request, res: Response) => {
  try {
    const technologyList: Category[] = await knex('technology').select('*');
    res.status(200).json({ technologyList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
