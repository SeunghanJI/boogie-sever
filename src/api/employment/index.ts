import express, { Request, Response, NextFunction } from 'express';
import multer, { memoryStorage } from 'multer';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import sharp from 'sharp';
import dayjs from 'dayjs';
import sendMail from '../../mail/index';
import { v4 as uuidv4 } from 'uuid';
import { checkRequiredProperties, verifyEmail, getUniqueID } from '../../utils';
import { verifyAccessToken } from '../../token/index';
import { REGION_MAP } from '../category/index';
import { uploadFileToS3 } from '../../s3';
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

interface EmploymentModel {
  id: string;
  userId: string;
  position: string;
  addressInformation: string;
  viewCount: string;
  companyName: string;
  title: string;
  content: string;
  image: string;
  deadline: string;
}

interface EmploymentBody extends EmploymentModel {
  positionId?: number;
  address?: string;
  region?: string;
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

  return [...([queryString] as string[])];
};

app.get(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    setViewCount(req, res, next, 'job_posting');
  },
  async (req: Request, res: Response) => {
    if (typeof req.query?.id !== 'string') {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    const id = req.query?.id;
    try {
      const employmentInfo: EmploymentBody = await knex('job_posting')
        .select(
          'job_posting.id as id',
          'user_id as userId',
          'company_name as companyName',
          'title',
          'content',
          'deadline',
          'image',
          'job_category.name as position',
          'address_information as addressInformation'
        )
        .innerJoin('job_category', 'job_category.id', 'field')
        .where({ 'job_posting.id': id })
        .first();

      if (!employmentInfo) {
        return res.status(404).json({ message: '리소스를 찾을 수 없습니다.' });
      }

      const [province, city]: string[] = splitJsonAddress(
        employmentInfo.addressInformation
      );
      employmentInfo.region = `${province} ${city}`;
      employmentInfo.deadline = dayjs(employmentInfo.deadline).format(
        'YYYY.MM.DD'
      );

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
    const rawEmploymentList: EmploymentModel[] = await EmploymentListQuery;
    const jobPostingList = rawEmploymentList.map(
      ({ id, companyName, image, position, addressInformation, viewCount }) => {
        const [province, city]: string[] = splitJsonAddress(addressInformation);
        const jobPostingForm = {
          id,
          companyName,
          image,
          position,
          viewCount,
          region: `${province} ${city}`,
        };
        return jobPostingForm;
      }
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
      const applicantInformation = {
        ...(jobPosting.userId === email && { applicantList }),
        applicantCount: applicantList.length,
      };

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
    const body: EmploymentBody = JSON.parse(JSON.stringify(req.body));
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

    const EmploymentInsertBody = {
      title,
      content,
      deadline,
      id: getUniqueID(),
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
      const data = await uploadFileToS3(
        resizedImageBuffer,
        `employment/${uuidv4()}.jpg`
      );
      EmploymentInsertBody.image = data.Location;
    } catch (error) {
      return res
        .status(500)
        .json({ message: '이미지 업로드에 실패하였습니다.' });
    }

    try {
      await knex('job_posting').insert(EmploymentInsertBody);

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

      if (!user.is_student) {
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

export default app;
