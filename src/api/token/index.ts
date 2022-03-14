import express, { Request, Response, NextFunction } from 'express';
const app: express.Application = express();

import { verifyRefreshToken, generatedJwtToken } from '../../token/index';

app.post('/refreshToken', verifyRefreshToken, (req: Request, res: Response) => {
  const email = res.locals.email;
  const accessToken = generatedJwtToken({
    email,
    sub: 'access',
    expiresIn: '5m',
  });

  //Todo
  //email user Table 통해서 존재하는 회원인지 검증 필요

  res.json({
    data: {
      accessToken,
      email,
    },
  });
});

export default app;
