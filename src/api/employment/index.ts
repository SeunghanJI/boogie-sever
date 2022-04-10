import express, { Request, Response, NextFunction } from 'express';
import multer, { memoryStorage } from 'multer';
import dotenv from 'dotenv';
import { Knex } from 'knex';
import sharp from 'sharp';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { checkRequiredProperties } from '../../utils';
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

interface EmploymentBody {
  companyName: string;
  title: string;
  content: string;
  addressInformation: string;
  address: string;
  deadline: string;
  positionId: number;
}

const isJsonString = (str: string) => {
  try {
    const json = JSON.parse(str);
    return typeof json === 'object';
  } catch (error) {
    return false;
  }
};

app.get('/', setViewCount, async (req: Request, res: Response) => {
  try {
    const id = req.query.id as QueryElement;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    const employmentInfo: EmploymentBody = await knex('job_posting')
      .select(
        'job_posting.id as id',
        'user_id as userId',
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
      return res.status(404).json({ message: '없는 게시물입니다.' });
    }

    employmentInfo.deadline = dayjs(employmentInfo.deadline).format(
      'YYYY.MM.DD'
    );

    res.status(200).json(employmentInfo);
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/list', async (req: Request, res: Response) => {
  try {
    const { position, region } = req.query;
    const filterOption: string[] = [];
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
      .where('deadline', '>=', `${dayjs().format('YYYYMMDD')}`);

    const init: { query: Array<string>; options: Array<string> } = {
      query: [],
      options: [],
    };

    const formatRegionsQuery = (
      regionIds: QueryElement
    ): { query: string; options: string[] } | undefined => {
      if (!regionIds) {
        return undefined;
      }
      if (!Array.isArray(regionIds)) {
        regionIds = [regionIds];
      }

      const { query, options }: { query: string[]; options: string[] } =
        regionIds.reduce((regionIds, regionId) => {
          regionIds.options.push(REGION_MAP[regionId]);
          regionIds.query.push(
            `address_information like '{%"address"%:%"${REGION_MAP[regionId]}%'`
          );
          return regionIds;
        }, init);
      return { query: query.join(' or '), options };
    };

    const formatPositionQuery = (
      positions: QueryElement
    ): string[] | undefined => {
      if (!positions) {
        return undefined;
      }
      if (!Array.isArray(positions)) {
        positions = [positions];
      }

      return positions;
    };

    const regionFilterQuery = formatRegionsQuery(region as QueryElement);
    const positionFilterQuery = formatPositionQuery(position as QueryElement);

    if (!!regionFilterQuery) {
      EmploymentListQuery.whereRaw(regionFilterQuery.query);
    }
    if (!!positionFilterQuery) {
      EmploymentListQuery.whereIn('job_posting.field', positionFilterQuery);
    }

    const rawEmploymentList = await EmploymentListQuery;
    const employmentList = rawEmploymentList.map((employmentInfo) => {
      const splitedAddress =
        JSON.parse(employmentInfo.addressInformation)?.address.split(' ') || '';
      const format = {
        id: employmentInfo.id,
        companyName: employmentInfo.companyName,
        image: employmentInfo.image,
        position: employmentInfo.position,
        region: `${splitedAddress[0]} ${splitedAddress[1]}`,
        viewCount: employmentInfo.viewCount,
      };
      return format;
    });

    const positionFilter = await knex('job_category')
      .select('name')
      .whereIn('id', positionFilterQuery || []);

    regionFilterQuery?.options.forEach((option) => {
      filterOption.push(option);
    });

    res.status(200).json({
      employmentList,
      filterOption: [
        ...filterOption,
        ...positionFilter.map((position) => position.name),
      ],
    });
  } catch (error) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get(
  '/applicant/list',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const email: string = res.locals.email;
      const id = req?.query?.id;

      if (!id) {
        return res.status(400).json({ message: '잘못된 요청입니다.' });
      }

      const jobPosting: { applicant: string } = await knex('user')
        .select('applicant')
        .innerJoin('job_posting', 'user.id', 'job_posting.user_id')
        .where({ 'user.id': email, 'job_posting.id': id })
        .first();

      if (!jobPosting) {
        return res.status(403).json({ message: '확인 하실 수 없습니다.' });
      }

      const applicantList: string[] = !!jobPosting.applicant
        ? JSON.parse(jobPosting.applicant)
        : [];

      res.status(200).json({ applicantList });
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
    try {
      const email = res.locals.email;
      const body: EmploymentBody = JSON.parse(JSON.stringify(req.body));
      const { companyName, title, content, address, deadline, positionId } =
        body;

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
        !isJsonString(address) ||
        !Number(deadline) ||
        dayjs(deadline, 'YYYYMMDD').diff(dayjs().format('YYYYMMDD')) <
          24 * 60 * 60 * 10 * 100
      ) {
        return res.status(400).json({ message: '잘못된 요청입니다.' });
      }

      const user = await knex('user').select('id').where({ id: email }).first();
      const resizedImageBuffer = await sharp(req.file?.buffer)
        .resize({ fit: 'fill', width: 1080, height: 790 })
        .toBuffer();
      const data = await uploadFileToS3(
        resizedImageBuffer,
        `employment/${uuidv4()}.jpg`
      );
      await knex('job_posting').insert({
        title,
        content,
        deadline,
        id: uuidv4().split('-').join('').substring(0, 16),
        user_id: user.id,
        company_name: companyName,
        image: data.Location,
        address_information: address,
        field: positionId,
      });

      res.status(201).json({ isPosted: true });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.post(
  '/applicant',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      if (
        !checkRequiredProperties(['id'], req.body) &&
        typeof req.body.id !== 'string'
      ) {
        return res.status(400).json({ message: '잘못된 요청입니다.' });
      }
      const email = res.locals.email;
      const id = req.body.id;

      const [user, jobPosting]: [
        { id: string; is_student: number },
        { applicant: string }
      ] = await Promise.all([
        knex('user').select('id', 'is_student').where({ id: email }).first(),
        knex('job_posting').select('applicant').where({ id }).first(),
      ]);

      if (!user.is_student) {
        return res.status(403).json({ message: '지원 하실 수 없습니다.' });
      }

      const applicant = !!jobPosting.applicant
        ? (JSON.parse(jobPosting?.applicant) as Array<string>)
        : [];

      if (!applicant.find((userId: string) => userId === user.id)) {
        applicant.push(user.id);
        await knex('job_posting')
          .where({ id })
          .update('applicant', `${JSON.stringify(applicant)}`);
      }

      res.status(201).json({ isApplied: true });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

export default app;
