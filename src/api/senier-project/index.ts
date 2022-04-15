import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import multer from 'multer';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { uploadFileToS3 } from '../../s3/index';
import { checkRequiredProperties, getUniqueID } from '../../utils';
import { setViewCount } from '../../view/index';
import { verifyRefreshToken } from '../../token/index';
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

interface SenierProjectTeamMember {
  name: string;
  uniID?: string;
  introduction: string;
  profileImageURL?: string;
  image: string;
  id?: string;
}

interface SenierProject {
  id: string;
  groupName: string;
  year: string;
  teamMember: string | SenierProjectTeamMember[];
  link: string | string[];
  plattform: string | number[];
  technology: string | number[];
  projectDesign: string;
  viewCount: number;
}

app.post(
  '/',
  multer({
    storage: multer.memoryStorage(),
  }).fields([
    { name: 'projectDesign', maxCount: 1 },
    { name: 'profileImage1', maxCount: 1 },
    { name: 'profileImage2', maxCount: 1 },
    { name: 'profileImage3', maxCount: 1 },
    { name: 'profileImage4', maxCount: 1 },
  ]),
  verifyRefreshToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (
        !checkRequiredProperties(
          [
            'groupName',
            'year',
            'teamMember',
            'link',
            'plattform',
            'technology',
          ],
          JSON.parse(JSON.stringify(req.body))
        )
      ) {
        throw { code: 400, message: '잘못된 요청입니다,' };
      }

      const multerStringFiyValueParsing = (body: {
        [key: string]: string;
      }): SenierProject => {
        const keys: string[] = [
          'teamMember',
          'link',
          'plattform',
          'technology',
        ];

        keys.forEach((key: string) => {
          body[key] = JSON.parse(body[key]);
        });

        return JSON.parse(JSON.stringify(body));
      };

      const body: SenierProject = multerStringFiyValueParsing(req.body);

      if (!body?.teamMember?.length) {
        throw { code: 400, message: '팀원은 한명이상이 필요합니다.' };
      }

      const checkTeamMemberRequireProperties = (
        teamMember: SenierProjectTeamMember[]
      ): boolean => {
        let isResult = false;
        teamMember.forEach((member: any) => {
          if (
            !checkRequiredProperties(
              ['name', 'uniID', 'introduction'],
              body.teamMember[0]
            )
          ) {
            isResult = true;
          }
        });

        return isResult;
      };

      if (
        checkTeamMemberRequireProperties(
          body.teamMember as SenierProjectTeamMember[]
        )
      ) {
        throw { code: 400, message: '잘못된 요청입니다,' };
      }

      if (
        !body?.plattform?.length ||
        !body?.technology?.length ||
        !body?.link?.length
      ) {
        throw {
          code: 400,
          message: '링크, 플랫폼, 기술을 하나 이상 넣어주십시오.',
        };
      }

      const email = res.locals.email;
      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!isAdmin) {
        throw { code: 403, message: '관리자 계정이 아닙니다.' };
      }

      const files: { [fieldname: string]: Express.Multer.File[] } =
        req.files as {
          [fieldname: string]: Express.Multer.File[];
        };
      const s3UploadFromBinary = async (
        files: { [fieldname: string]: Express.Multer.File[] },
        path: string
      ): Promise<AWS.S3.ManagedUpload.SendData[]> => {
        const s3UploadResultList: Promise<AWS.S3.ManagedUpload.SendData>[] =
          Object.values(files).map(async ([file, ...ignore]) => {
            if (!(file.fieldname == 'projectDesign')) {
              file.buffer = await sharp(file.buffer)
                .resize({ fit: 'fill', width: 1080, height: 790 })
                .toBuffer();
            }

            return uploadFileToS3(
              file.buffer,
              `test/${path}/${file.originalname}`
            );
          });

        return Promise.all(s3UploadResultList);
      };
      const s3UploadResult: AWS.S3.ManagedUpload.SendData[] =
        await s3UploadFromBinary(files, `${body.year}/${body.groupName}`);

      interface PostSenierProject extends SenierProject {
        teamMember: SenierProjectTeamMember[];
      }

      const formatSenierProject = (
        senierProject: PostSenierProject,
        files: { [fieldname: string]: Express.Multer.File[] },
        s3UploadResult: AWS.S3.ManagedUpload.SendData[]
      ): SenierProject => {
        Object.values(files).forEach(
          (file: Express.Multer.File[], index: number) => {
            if (file[0].fieldname === 'projectDesign') {
              senierProject.projectDesign = s3UploadResult[index].Location;
            } else {
              senierProject.teamMember[
                Number(file[0].fieldname.replace(/[^0-9]/g, '')) - 1
              ].profileImageURL = s3UploadResult[index].Location;
            }
          }
        );

        return senierProject;
      };
      const senierProject: SenierProject = formatSenierProject(
        body as PostSenierProject,
        files,
        s3UploadResult
      );
      const setTeamMember = (
        teamMember: SenierProjectTeamMember[] = [],
        id: string = ''
      ): Promise<number[]>[] => {
        return teamMember.map(async (member) => {
          const email: { id: string } = await knex('user')
            .select('id')
            .where({ is_student: 1, uni_id: member.uniID })
            .first();

          return knex('team_member').insert({
            id,
            uni_id: member.uniID,
            name: member.name,
            introduction: member.introduction,
            profile_image: member.profileImageURL,
            ...(!!email && { email: email.id }),
          });
        });
      };

      const uniqueID: string = getUniqueID();

      await Promise.all([
        setTeamMember(
          senierProject.teamMember as SenierProjectTeamMember[],
          uniqueID
        ),
        knex('senier_project').insert({
          id: uniqueID,
          year: senierProject.year,
          link: JSON.stringify(senierProject.link),
          group_name: senierProject.groupName,
          project_design: senierProject.projectDesign,
          plattform: JSON.stringify(
            (senierProject.plattform as number[]).sort(
              (a: number, b: number) => {
                return a - b;
              }
            )
          ),
          technology: JSON.stringify(
            (senierProject.technology as number[]).sort(
              (a: number, b: number) => {
                return a - b;
              }
            )
          ),
        }),
      ]);

      res.status(201).json({ isPosted: true });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

type QueryElement = string | number | string[] | number[] | null;
interface SerachOptions {
  technology?: number[];
  plattform?: number[];
  name?: string;
}

app.get('/card', async (req: Request, res: Response) => {
  try {
    const { year, name, plattform, technology } = req.query;

    if (!year) {
      throw { code: 400, message: '연차정보를 입력해주세요.' };
    }

    const formatTeamMember = (
      teamMember: { id: string; name: string }[]
    ): { [key: string]: string[] } => {
      return teamMember.reduce(
        (
          result: { [key: string]: string[] },
          { id, name }: { id: string; name: string }
        ) => {
          if (!result[id]) {
            result[id] = [];
          }
          result[id].push(name);

          return result;
        },
        {}
      );
    };
    const senierProjectParser = (
      senierProject: SenierProject[]
    ): SenierProject[] => {
      return senierProject.reduce(
        (result: SenierProject[], senierProjectInfo: SenierProject) => {
          senierProjectInfo.plattform = JSON.parse(
            senierProjectInfo.plattform as string
          );
          senierProjectInfo.technology = JSON.parse(
            senierProjectInfo.technology as string
          );
          result.push(senierProjectInfo);

          return result;
        },
        []
      );
    };
    const formatSearchOption = (SerachOption: QueryElement) => {
      if (!SerachOption) {
        return null;
      }

      if (Array.isArray(SerachOption)) {
        SerachOption = (SerachOption as string[]).map((value: string) => {
          return Number(value);
        });
      }

      if (!Array.isArray(SerachOption)) {
        SerachOption = [Number(SerachOption)];
      }

      return `%${[...SerachOption]
        .sort((a: number, b: number) => {
          return a - b;
        })
        .join('%')}%`;
    };

    const plattformOption = formatSearchOption(plattform as QueryElement);
    const technologyOption = formatSearchOption(technology as QueryElement);

    const getSenierProject = knex('senier_project')
      .select(
        'id',
        'group_name as groupName',
        'plattform',
        'technology',
        'view_count as viewCount'
      )
      .where({ year })
      .orderByRaw('RAND()');
    const getTeamMember = knex('team_member')
      .select('team_member.id', 'team_member.name')
      .innerJoin('senier_project', 'senier_project.id', 'team_member.id')
      .where({ 'senier_project.year': year });

    if (!!name) {
      const senierProjectID = await knex('team_member')
        .select('id')
        .where({ name });

      getSenierProject.whereIn(
        'id',
        senierProjectID.map((data: any) => data.id)
      );
      getTeamMember.whereIn(
        'senier_project.id',
        senierProjectID.map((data: any) => data.id)
      );
    }

    if (!!plattformOption) {
      getSenierProject.whereLike('plattform', plattformOption);
      getTeamMember.whereLike('senier_project.plattform', plattformOption);
    }

    if (!!technologyOption) {
      getSenierProject.whereLike('technology', technologyOption);
      getTeamMember.whereLike('senier_project.technology', technologyOption);
    }

    const [senierProject, teamMember]: [
      senierProject: SenierProject[] | (SenierProject | undefined)[],
      teamMember: { [key: string]: string[] }
    ] = await Promise.all([
      getSenierProject.then((senierProject: SenierProject[]) => {
        return senierProjectParser(senierProject);
      }),
      getTeamMember.then((teamMember: { id: string; name: string }[]) => {
        return formatTeamMember(teamMember);
      }),
    ]);

    const formatSenierProjectCardList = async (
      senierProject: SenierProject[],
      teamMember: { [key: string]: string[] }
    ) => {
      const senierProjectCardList = await Promise.all(
        senierProject.map(async (data: SenierProject) => {
          const [plattform, technology] = await Promise.all([
            knex('plattform')
              .select('name')
              .whereIn('id', data.plattform as number[]),
            knex('technology')
              .select('name')
              .whereIn('id', data.technology as number[]),
          ]);

          data.teamMember = teamMember[data.id].join(', ');
          data.plattform = plattform
            .map((data) => {
              return data.name;
            })
            .join(', ');
          data.technology = technology.map((data) => {
            return data.name;
          });

          return data;
        })
      );

      return senierProjectCardList.filter(
        (data: SenierProject | undefined) => !!data
      );
    };

    const senierProjectCardList = await formatSenierProjectCardList(
      senierProject as SenierProject[],
      teamMember
    );

    res.status(200).json({ senierProjectCardList });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get(
  '/member',
  (req: Request, res: Response, next: NextFunction) => {
    setViewCount(req, res, next, 'senier_project');
  },
  async (req: Request, res: Response) => {
    try {
      const id: string = req.query.id as string;

      if (!id) {
        throw { code: 400, message: '잘못된 요청입니다.' };
      }

      const teamMemberList: SenierProjectTeamMember[] = await knex(
        'team_member'
      )
        .select('email as id', 'name', 'introduction', 'profile_image as image')
        .where({ id });
      const formatTeamMemberList = (
        teamMemberList: SenierProjectTeamMember[]
      ): SenierProjectTeamMember[] => {
        const teamMember: SenierProjectTeamMember[] = teamMemberList.reduce(
          (
            teamMemberList: SenierProjectTeamMember[],
            memberInfo: SenierProjectTeamMember
          ) => {
            teamMemberList.push({
              name: memberInfo.name as string,
              introduction: memberInfo.introduction,
              image: memberInfo.image,
              ...(!!memberInfo.id && { id: memberInfo.id }),
            });
            return teamMemberList;
          },
          []
        );

        return teamMember;
      };

      res.status(200).json({
        senierProjectMemberList: formatTeamMemberList(teamMemberList),
      });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.get('/design', async (req: Request, res: Response) => {
  try {
    const id: string = req.query.id as string;

    if (!id) {
      throw { code: 400, message: '잘못된 요청입니다.' };
    }

    const { projectDesign }: { projectDesign: string } = await knex(
      'senier_project'
    )
      .select('project_design as projectDesign')
      .where({ id })
      .first();

    res.status(200).json({ projectDesign });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/announced', async (req: Request, res: Response) => {
  try {
    const id: string = req.query.id as string;

    if (!id) {
      throw { code: 400, message: '잘못된 요청입니다.' };
    }

    const { link }: { link: string } = await knex('senier_project')
      .select('link')
      .where({ id })
      .first();

    res.status(200).json({ link: JSON.parse(link) });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
function join(arg0: string): any {
  throw new Error('Function not implemented.');
}
