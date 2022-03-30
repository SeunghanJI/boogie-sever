import { Request } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import AWS from 'aws-sdk';
import dotenv from 'dotenv';
dotenv.config();

export type TUpload =
  | {
      [fieldname: string]: Express.Multer.File[] | Express.MulterS3.File[];
    }
  | Express.Multer.File[]
  | Express.MulterS3.File[];

const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY_ID } = process.env;
const S3_BUCKET_NAME: string = process.env.S3_BUCKET_NAME || '';

const s3 = new AWS.S3({
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY_ID,
  region: 'ap-northeast-2',
});

export const uploadS3WithPath = (
  path: string,
  fileName: string | undefined = undefined
): multer.Multer => {
  return multer({
    storage: multerS3({
      s3,
      bucket: S3_BUCKET_NAME,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (
        req: Request,
        file: Express.Multer.File,
        cb: (error: any, key?: string | undefined) => void
      ) => {
        cb(null, `test/${path}/${fileName || file.originalname}`);
      },
    }),
  });
};
