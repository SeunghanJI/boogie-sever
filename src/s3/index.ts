import AWS from 'aws-sdk';
import dotenv from 'dotenv';
dotenv.config();

const { S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY_ID } = process.env;
const S3_BUCKET_NAME: string = process.env.S3_BUCKET_NAME || '';

const s3 = new AWS.S3({
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY_ID,
  region: 'ap-northeast-2',
});

const s3Controller = {
  isExists: async (fileKey: string) => {
    if (!fileKey) {
      return null;
    }

    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    };

    try {
      const headCode = await s3.headObject(params).promise();
      return headCode;
    } catch (error: any) {
      if (error?.code === 'NotFound') {
        return null;
      }
      throw new Error('s3 에러');
    }
  },
  uploadFile: (fileBuffer: Buffer, fileKey: string) => {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
      Body: fileBuffer,
    };

    return s3.upload(params).promise();
  },
  getObjectURL: async (fileKey: string) => {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    };
    const isExists = await s3Controller.isExists(fileKey);

    return !!isExists && s3.getSignedUrl('getObject', params);
  },
  deleteObject: async (fileKey: string) => {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    };
    const isExists = await s3Controller.isExists(fileKey);

    return !!isExists && s3.deleteObject(params).promise();
  },
};
export default s3Controller;
