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

export const uploadFileToS3 = (
  fileBuffer: Buffer,
  fileKey: string
): Promise<AWS.S3.ManagedUpload.SendData> => {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: fileKey,
    Body: fileBuffer,
  };

  return s3.upload(params).promise();
};
