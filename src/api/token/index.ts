import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Knex } from 'knex';
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

import {
  verifyRefreshToken,
  generatedJwtToken,
  verifyToken,
} from '../../token/index';

app.post(
  '/refresh-token',
  verifyRefreshToken,
  async (req: Request, res: Response) => {
    const email = res.locals.email;
    try {
      const { id, nickname, is_admin, profileImage } = await knex('user')
        .select(
          'user.id as id',
          'user.nickname as nickname',
          'user.is_admin as is_admin',
          'user_profile.image as profileImage'
        )
        .leftJoin('user_profile', 'user.id', 'user_profile.user_id')
        .where({ 'user.id': email })
        .first();

      if (!id) {
        Promise.reject();
      }

      const accessToken = generatedJwtToken({
        email,
        sub: 'access',
        expiresIn: '5m',
      });

      res.status(200).json({
        data: {
          accessToken,
          nickname,
          email: id,
          isAdmin: is_admin,
          ...(!!profileImage && { profileImage }),
        },
      });
    } catch (error) {
      return res.status(404).json({ message: '가입되지 않은 회원입니다.' });
    }
  }
);

app.post('/verify/refresh-token', (req: Request, res: Response) => {
  const response = verifyToken(req, res, 'refresh');
  const { isOk }: { isOk: boolean } = response;

  if (isOk) {
    res.status(200).json({ isValid: true });
  } else {
    res.status(401).json({ isValid: false });
  }
});

export default app;
