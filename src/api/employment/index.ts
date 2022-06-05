import express, { Request, Response, NextFunction } from 'express';
import multer, { memoryStorage } from 'multer';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import sharp from 'sharp';
import dayjs from 'dayjs';
import sendMail from '../../mail/index';
import { v4 as uuidv4 } from 'uuid';
import {
  checkRequiredProperties,
  verifyEmail,
  generatedUniqueID,
} from '../../utils';
import { verifyAccessToken, getUserEmail } from '../../token/index';
import { REGION_MAP } from '../category/index';
import s3Controller from '../../s3';
import { setViewCount } from '../../view/index';
dotenv.config();

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

type QueryElement = string | string[] | undefined;

interface Employment extends EmploymentOptions {
  id: string;
  userId: string;
  companyName: string;
  title: string;
  content: string;
  image: string;
}

interface EmploymentOptions {
  position?: string;
  addressInformation?: string;
  applicant?: string;
  positionId?: number;
  address?: string;
  region?: string;
  hasAuthority?: Boolean;
  isApplied?: Boolean;
  deadline?: string;
  viewCount?: string;
  positionName?: string;
}

const isJsonString = (str: string) => {
  try {
    const json = JSON.parse(str);
    return typeof json === 'object';
  } catch (error) {
    return false;
  }
};

const splitJsonAddress = (address: string): string[] => {
  return JSON.parse(address)?.address.split(' ') || ['주소', '없음'];
};

const queryStringToStringArray = (
  queryString: QueryElement
): string[] | null => {
  if (!queryString) {
    return null;
  }
  if (typeof queryString === 'string') {
    return [queryString];
  }

  return queryString;
};

app.get(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    setViewCount(req, res, next, 'job_posting');
  },
  getUserEmail,
  async (req: Request, res: Response) => {
    const email: string = res.locals.email || '';
    const id = req.query?.id;

    if (typeof id !== 'string') {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    try {
      const promiseAllArr = [
        knex('job_posting')
          .select(
            'job_posting.id as id',
            'user_id as userId',
            'company_name as companyName',
            'title',
            'content',
            'deadline',
            'image',
            'job_posting.field as positionId',
            'job_category.name as positionName',
            'applicant',
            'address_information as addressInformation'
          )
          .innerJoin('job_category', 'job_category.id', 'field')
          .where({ 'job_posting.id': id, is_deleted: false })
          .first(),
      ];
      if (!!email) {
        promiseAllArr.push(
          knex('user')
            .select('is_admin as isAdmin')
            .where({ id: email })
            .first()
        );
      }
      const [rawEmploymentInfo, user] = await Promise.all(promiseAllArr);

      if (!rawEmploymentInfo) {
        return res.status(404).json({ message: '리소스를 찾을 수 없습니다.' });
      }

      const {
        userId,
        image,
        companyName,
        title,
        content,
        applicant,
        addressInformation,
        deadline,
        positionId,
        positionName,
      }: Employment = { ...rawEmploymentInfo };
      const { isAdmin }: { isAdmin: boolean } = user || { isAdmin: false };

      const employmentInfo: Employment = {
        ...((email === userId || !!isAdmin) && { hasAuthority: true }),
        id,
        userId,
        image,
        companyName,
        addressInformation,
        title,
        content,
        positionId,
        positionName,
      };

      try {
        const imageURL = await s3Controller.getObjectURL(image);
        employmentInfo.image = imageURL || image;
      } catch (error) {
        res.status(500).json({ message: 'S3 연결 실패' });
      }

      if (
        !!applicant &&
        (JSON.parse(applicant) as Array<string>).find(
          (applicant) => applicant === email
        )
      ) {
        employmentInfo.isApplied = true;
      }

      const [province, city]: string[] = splitJsonAddress(
        addressInformation as string
      );
      employmentInfo.region = `${province} ${city}`;
      employmentInfo.deadline = dayjs(deadline).format('YYYY.MM.DD');

      res.status(200).json(employmentInfo);
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get('/list', async (req: Request, res: Response) => {
  const { position, region } = req.query;
  const EmploymentListQuery = knex('job_posting')
    .select(
      'job_posting.id',
      'company_name as companyName',
      'title',
      'image',
      'address_information as addressInformation',
      'job_category.name as position',
      'view_count as viewCount'
    )
    .innerJoin('job_category', 'job_posting.field', 'job_category.id')
    .where('deadline', '>=', `${dayjs().format('YYYYMMDD')}`)
    .andWhere({ is_deleted: false })
    .orderByRaw('RAND()');

  const regionFilterArray = queryStringToStringArray(region as QueryElement);
  const positionFilterArray = queryStringToStringArray(
    position as QueryElement
  );
  const regionFilterQuery = regionFilterArray
    ?.map(
      (regionId) =>
        `address_information like '{%"address"%:%"${REGION_MAP[regionId]}%'`
    )
    .join(' or ');

  if (!!regionFilterQuery) {
    EmploymentListQuery.whereRaw(regionFilterQuery);
  }
  if (!!positionFilterArray && positionFilterArray.length) {
    EmploymentListQuery.whereIn('job_posting.field', positionFilterArray);
  }

  try {
    const rawEmploymentList: Employment[] = await EmploymentListQuery;
    const jobPostingList = await Promise.all(
      rawEmploymentList.map(
        async ({
          id,
          companyName,
          image,
          position,
          addressInformation,
          viewCount,
        }) => {
          const imageURL = await s3Controller.getObjectURL(image);
          const [province, city]: string[] = splitJsonAddress(
            addressInformation as string
          );
          const jobPostingForm = {
            ...(!!imageURL && { image: imageURL }),
            id,
            companyName,
            position,
            viewCount,
            region: `${province} ${city}`,
          };
          return jobPostingForm;
        }
      )
    );

    res.status(200).json({ jobPostingList });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get(
  '/applicant/list',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const email: string = res.locals.email;
    const id = req?.query?.id;

    if (!id) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }
    try {
      const jobPosting: { userId: string; applicant: string } = await knex(
        'job_posting'
      )
        .select('user_id as userId', 'applicant')
        .where({ 'job_posting.id': id })
        .first();

      if (!jobPosting) {
        return res.status(404).json({ message: '리소스를 찾을 수 없습니다.' });
      }

      const applicantList: string[] = JSON.parse(jobPosting?.applicant || '[]');
      const applicantInformation: {
        applicantCount: number;
        applicantList?: { id: string; profileImage?: string }[];
      } = {
        applicantCount: applicantList.length,
      };

      if (jobPosting.userId === email) {
        const applicantsProfiles: { id: string; image?: string }[] = await knex(
          'user_profile'
        )
          .select('user_id as id', 'image')
          .whereIn('user_id', applicantList);
        applicantInformation.applicantList = await Promise.all(
          applicantsProfiles.map(async (profile) => {
            const applicantsProfiles: { id: string; profileImage?: string } = {
              id: profile.id,
            };

            if (!!profile.image) {
              const profileImage = await s3Controller.getObjectURL(
                profile.image
              );

              if (!!profileImage) {
                applicantsProfiles.profileImage = profileImage;
              }
            }

            return applicantsProfiles;
          })
        );
      }

      res.status(200).json(applicantInformation);
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.post(
  '/',
  multer({ storage: memoryStorage() }).single('image'),
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const email: string = res.locals.email;
    const body: Employment = JSON.parse(JSON.stringify(req.body));
    const { companyName, title, content, address, deadline, positionId } = body;
    const ONE_DAY_TIME = 24 * 60 * 60 * 10 * 100;

    if (
      !checkRequiredProperties(
        [
          'companyName',
          'title',
          'content',
          'address',
          'deadline',
          'positionId',
        ],
        body
      ) ||
      !isJsonString(address as string) ||
      !Number(deadline) ||
      dayjs(deadline, 'YYYYMMDD').diff(dayjs().format('YYYYMMDD')) <
        ONE_DAY_TIME
    ) {
      return res.status(400).json({ code: 400, message: '잘못된 요청입니다.' });
    }

    const employmentInsertBody = {
      title,
      content,
      deadline,
      id: generatedUniqueID(),
      user_id: email,
      company_name: companyName,
      image: '',
      address_information: address,
      field: positionId,
    };
    try {
      const resizedImageBuffer = await sharp(req.file?.buffer)
        .resize({ fit: 'fill', width: 1080, height: 790 })
        .toBuffer();
      const data = await s3Controller.uploadFile(
        resizedImageBuffer,
        `employment/${uuidv4()}.jpg`
      );
      employmentInsertBody.image = data.Key;
    } catch (error) {
      return res
        .status(500)
        .json({ message: '이미지 업로드에 실패하였습니다.' });
    }

    try {
      await knex('job_posting').insert(employmentInsertBody);

      res.status(201).json({ isPosted: true });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.post(
  '/applicant',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    if (
      !checkRequiredProperties(['id'], req.body) &&
      typeof req.body.id !== 'string'
    ) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    const email: string = res.locals.email;
    const id: string = req.body.id;
    try {
      const [user, jobPosting]: [
        { id: string; name: string; is_student: number },
        { userId: string; applicant: string }
      ] = await Promise.all([
        knex('user')
          .select('id', 'name', 'is_student')
          .where({ id: email })
          .first(),
        knex('job_posting')
          .select('user_id as userId', 'applicant')
          .where({ id })
          .first(),
      ]);

      if (!user.is_student || jobPosting.userId === email) {
        return res.status(403).json({ message: '지원 하실 수 없습니다.' });
      }

      const applicants: string[] = JSON.parse(jobPosting?.applicant || '[]');

      if (!applicants.find((userId: string) => userId === user.id)) {
        applicants.push(user.id);
        const applicantPromiseAll: Array<any> = [
          knex('job_posting')
            .where({ id })
            .update('applicant', `${JSON.stringify(applicants)}`),
        ];

        if (verifyEmail(jobPosting.userId)) {
          applicantPromiseAll.push(
            sendMail({
              toEmail: jobPosting.userId,
              title: 'Boogie On & On 채용공고 지원 메일',
              content: `귀하의 회사에 ${user.name}(${user.id})님이 지원하였습니다.`,
            })
          );
        }

        await Promise.all(applicantPromiseAll);
      }

      res.status(201).json({ isApplied: true });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.patch(
  '/:id',
  verifyAccessToken,
  multer({ storage: memoryStorage() }).single('image'),
  async (req: Request, res: Response) => {
    const email: string = res.locals.email;
    const id = req.params.id;
    const body = JSON.parse(JSON.stringify(req.body));
    const image: Buffer | undefined = req.file?.buffer;

    if (
      !id ||
      !checkRequiredProperties(
        [
          'title',
          'content',
          'companyName',
          'address',
          'deadline',
          'positionId',
        ],
        body
      )
    ) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    const {
      title,
      content,
      companyName,
      address,
      deadline,
      positionId,
    }: Employment = body;

    try {
      const [requesterInfo, author]: [{ isAdmin: boolean }, { id: string }] =
        await Promise.all([
          knex('user')
            .select('is_admin as isAdmin')
            .where({ id: email })
            .first(),
          knex('job_posting').select('user_id as id').where({ id }).first(),
        ]);

      if (!requesterInfo.isAdmin && author.id !== email) {
        return res.status(403).json({ message: '수정 권한이 없습니다.' });
      }
    } catch (error) {
      throw error;
    }

    const updateBody: {
      title: string;
      content: string;
      company_name: string;
      address_information?: string | null;
      deadline?: string;
      field?: number;
      image?: string | null;
    } = {
      title,
      content,
      deadline,
      company_name: companyName,
      address_information: address,
      field: positionId,
    };

    if (!!image) {
      try {
        const oldInfo: { image: string } = await knex('user_profile')
          .select('image')
          .where({ user_id: id })
          .first();

        if (!!oldInfo.image) {
          await s3Controller.deleteObject(oldInfo.image);
        }

        updateBody.image = null;
      } catch (error) {}

      try {
        const resizedImageBuffer = await sharp(image)
          .resize({ fit: 'fill', width: 1080, height: 790 })
          .toBuffer();
        const data = await s3Controller.uploadFile(
          resizedImageBuffer,
          `employment/${uuidv4()}.jpg`
        );
        updateBody.image = data.Key;
      } catch (error) {
        return res
          .status(500)
          .json({ message: '이미지 업로드에 실패하였습니다.' });
      }
    }

    try {
      await knex('job_posting').update(updateBody).where({ id });
      res.status(200).json({ isUpdated: true });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.delete('/:id', verifyAccessToken, async (req: Request, res: Response) => {
  const email: string = res.locals.email;
  const id = req.params.id;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const [requester, author]: [{ isAdmin: boolean }, { userId: string }] =
      await Promise.all([
        knex('user').select('is_admin as isAdmin').where({ id: email }).first(),
        knex('job_posting').select('user_id as userId').where({ id }).first(),
      ]);

    if (!requester.isAdmin && author.userId !== email) {
      return res.status(403).json({ message: '수정 권한이 없습니다.' });
    }

    await knex('job_posting').update({ is_deleted: true }).where({ id });

    res.status(200).json({ isDeleted: true });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.delete(
  '/applicant/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const email: string = res.locals.email;
    const id = req.params.id;

    try {
      const { applicants }: { applicants: string } = await knex('job_posting')
        .select('applicant as applicants')
        .where({ id })
        .first();

      const deletedRequesterArr: string[] = JSON.parse(applicants)?.filter(
        (applicant: string) => applicant !== email
      );

      const applicant = !!deletedRequesterArr?.length
        ? JSON.stringify(deletedRequesterArr)
        : null;

      await knex('job_posting').update({ applicant }).where({ id });

      res.status(200).json({ isDeleted: true });
    } catch (error) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

export default app;
