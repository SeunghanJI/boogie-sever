import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import crypto from 'crypto';
import { verifyEmail, checkObjectValueEmpty } from '../../utils';
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

const encryptString = (str: string = ''): string => {
  return crypto.createHash('sha256').update(str).digest('base64');
};

app.post('/password', async (req: Request, res: Response) => {
  const { id, password, verifyPassword } = req.body;

  if (!checkObjectValueEmpty({ id, password, verifyPassword })) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  if (!verifyEmail(id)) {
    return res.status(400).json({ message: '아이디가 형식에 맞지않습니다.' });
  }

  if (password !== verifyPassword) {
    return res.status(400).json({ message: '입력하신 비밀번호와 다릅니다.' });
  }

  try {
    const checkRegisteredUser = await knex('user')
      .select('id', 'password')
      .where({ id })
      .first();

    if (!checkRegisteredUser) {
      return res
        .status(403)
        .json({ message: '등록되어 있지 않은 ID(이메일)입니다.' });
    }

    if (checkRegisteredUser.password == encryptString(password)) {
      return res.status(409).json({ message: '기존 비밀번호와 동일합니다.' });
    }

    await knex('user')
      .update({ password: encryptString(password) })
      .where({ id });

    res.status(200).json({ isSucceeded: true });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
