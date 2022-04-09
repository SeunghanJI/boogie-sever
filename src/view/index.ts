import { Request, Response, NextFunction } from 'express';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import dotenv from 'dotenv';
dotenv.config();

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

export const setViewCount = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const id: string = req.query.id as string;

  if (!Object.keys(req).length || !Object.keys(res).length || !id) {
    return;
  }

  const viewToken: string[] = !!req?.cookies?.view
    ? JSON.parse(req.cookies.view)
    : [];

  if (viewToken.includes(id)) {
    next();
  } else {
    try {
      let tableName = '';

      if (req.baseUrl.split('/').includes('senier-project')) {
        tableName = 'senier_project';
      } else if (req.baseUrl.split('/').includes('employment')) {
        tableName = 'job_posting';
      }

      const { viewCount }: { viewCount: number } = await knex(tableName)
        .select('view_count as viewCount')
        .where({ id })
        .first();

      await knex(tableName)
        .update({ view_count: viewCount + 1 })
        .where({ id });

      viewToken.push(id);

      const currentDate = dayjs().format('YYYY-MM-DD');
      const maxAge =
        dayjs(`${currentDate} 23:59:59`).valueOf() - dayjs().valueOf();

      res.cookie('view', JSON.stringify(viewToken), {
        maxAge,
        httpOnly: true,
      });
    } catch {
      next();
    }
  }
};
