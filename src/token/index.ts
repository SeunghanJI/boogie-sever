import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

interface UserPayload {
  email: string;
}

interface VerifyTokenErrorJSON {
  status: number;
  message: string;
  code?: string;
}

const verifyToken = (
  req: Request,
  res: Response,
  type: string
): { isOk: boolean; json?: VerifyTokenErrorJSON } => {
  const authorization: string = req.headers.authorization || '';
  const jwtSecretKey: string = process.env.jWT_SECRET || '';
  if (!authorization) {
    return {
      isOk: false,
      json: {
        status: 401,
        message: '토큰이 없습니다',
      },
    };
  }
  try {
    const data = jwt.verify(
      authorization.replace(`${jwtSecretKey} `, ''),
      jwtSecretKey
    ) as UserPayload;
    res.locals.email = data.email;
    return {
      isOk: true,
    };
  } catch (error: unknown) {
    const typeToKor = type === 'access' ? '엑세스' : '리프레시';

    if (error instanceof Error) {
      if (error.name === 'TokenExpiredError') {
        return {
          isOk: false,
          json: {
            status: 419,
            message: `만료된 ${typeToKor} 토큰입니다.`,
            code: 'expired',
          },
        };
      }
    }

    return {
      isOk: false,
      json: {
        status: 401,
        message: `유효하지 않은 ${typeToKor} 토큰입니다.`,
      },
    };
  }
};

export const verifyAccessToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const response = verifyToken(req, res, 'access');
  const { isOk }: { isOk: boolean } = response;

  if (isOk) {
    next();
  } else {
    const status = response.json?.status || 401;
    const message = response.json?.message;
    const code = response.json?.code;

    return res.status(status).json({
      message,
      ...(!!code && {
        code,
      }),
    });
  }
};

export const verifyRefreshToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const response = verifyToken(req, res, 'refresh');
  const { isOk }: { isOk: boolean } = response;

  if (isOk) {
    next();
  } else {
    const status = response.json?.status || 401;
    const message = response.json?.message;
    const code = response.json?.code;

    return res.status(status).json({
      message,
      ...(!!code && {
        code,
      }),
    });
  }
};

export const generatedJwtToken = ({
  sub,
  email,
  expiresIn,
}: {
  sub: string;
  email: string;
  expiresIn: string;
}): string | void => {
  if (!['refresh', 'access'].includes(sub)) {
    return;
  }

  const jwtSecretKey: string = process.env.jWT_SECRET || '';

  const token = jwt.sign({ sub, email }, jwtSecretKey, {
    expiresIn,
  });

  return token;
};
