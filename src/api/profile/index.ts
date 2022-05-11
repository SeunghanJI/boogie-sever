import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { verifyAccessToken, getUserEmail } from '../../token';
import multer, { memoryStorage } from 'multer';
import { Knex } from 'knex';
import s3Controller from '../../s3/index';
import sharp from 'sharp';
import { getUniqueID } from '../../utils';
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

interface Profile {
  id: string;
  isMe: boolean;
  nickname: string;
  isOpen: boolean;
  image?: string;
  job?: number;
  positions?: string | number[];
  technologies?: string | number[];
  introduction?: string;
  awards?: string | { name: string; awarededAt: string }[];
  links?: string | string[];
}

const getProfileInfo = async (id: string, requester: string = id) => {
  const isMe = id === requester;

  try {
    const {
      isOpen,
      nickname,
      userId,
      image,
      introduction,
      positions,
      technologies,
      awards,
      links,
    }: {
      isOpen: boolean;
      nickname: string;
      userId: string;
      image: string;
      positions: string;
      introduction: string;
      technologies: string;
      awards: string;
      links: string;
    } = await knex('user_profile')
      .select(
        'is_open_information as isOpen',
        'nickname',
        'user_id as userId',
        'image',
        'positions',
        'technologies',
        'introduction',
        'awards',
        'links'
      )
      .where({ user_id: id })
      .innerJoin('user', 'user_profile.user_id', 'user.id')
      .first();

    let profileInfo: Profile = {
      isOpen,
      isMe,
      nickname,
      id: userId,
    };

    if (!!isMe || !!isOpen) {
      const optionalInfo: {
        image?: string;
        job?: number;
        positions?: string | number[];
        technologies?: string | number[];
        introduction?: string;
        awards?: string | { name: string; awarededAt: string }[];
        links?: string | string[];
      } = {
        ...(!!awards && { awards: JSON.parse(awards) }),
        ...(!!links && { links: JSON.parse(links) }),
        ...(!!introduction && { introduction }),
      };

      if (!!positions) {
        const positionArr: number[] = JSON.parse(positions);
        const positionsInfo = await knex('job_category')
          .select('*')
          .whereIn('id', positionArr);
        optionalInfo.positions = positionsInfo;
      }

      if (!!technologies) {
        const technologyArr: number[] = JSON.parse(technologies);
        const technologiesInfo = await knex('technology')
          .select('*')
          .whereIn('id', technologyArr);
        optionalInfo.technologies = technologiesInfo;
      }

      if (!!image) {
        const imageURL = await s3Controller.getObjectURL(image);

        if (!!imageURL) {
          optionalInfo.image = imageURL;
        }
      }
      profileInfo = { ...profileInfo, ...optionalInfo };
    }

    return profileInfo;
  } catch (error) {
    throw new Error('프로필 가져오기 실패');
  }
};

app.patch('/open', verifyAccessToken, async (req: Request, res: Response) => {
  const id: string = res.locals.email;
  const openInformation: boolean = req.body.openInformation;

  try {
    await knex('user_profile')
      .update({ is_open_information: openInformation })
      .where({ user_id: id });
    res.status(200).json({ isChanged: true });
  } catch (error) {
    res.status(500).json({ message: '서버요청 실패' });
  }
});

app.get('/', getUserEmail, async (req: Request, res: Response) => {
  const requester = res.locals.email || -1;
  const id = req.query?.id;

  if (!id && typeof id === 'string') {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const profileInfo = await getProfileInfo(id as string, requester);

    res.status(200).json({ profileInfo });
  } catch (error) {
    res.status(500).json({ message: '서버 요청에 실패하였습니다.' });
  }
});

export default app;
