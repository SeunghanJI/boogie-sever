import express, { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import multer from 'multer';
import dotenv from 'dotenv';
import sharp from 'sharp';
import s3Controller from '../../s3/index';
import { checkRequiredProperties, generatedUniqueID } from '../../utils';
import { setViewCount } from '../../view/index';
import { verifyAccessToken } from '../../token/index';
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
  uniId?: string;
  introduction: string;
  image?: string;
  id?: string;
}
interface SenierProject {
  id?: string;
  groupName?: string;
  year?: string;
  teamMember: string | SenierProjectTeamMember[];
  link?: string | string[];
  plattform?: string | number[];
  technology?: string | number[];
  projectDesign?: string;
  viewCount?: number;
  [propsName: string]: any;
}
interface PostSenierProject extends SenierProject {
  teamMember: SenierProjectTeamMember[];
}
interface S3_FILE {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
}

const jsonToObjectParse = (
  keys: string[],
  body: {
    [key: string]: string;
  }
): SenierProject => {
  const cloneBody: { [key: string]: string } = Object.assign(body);

  keys.forEach((key: string) => {
    cloneBody[key] = JSON.parse(cloneBody[key]);
  });

  return JSON.parse(JSON.stringify(cloneBody));
};

const checkTeamMembersRequireProperties = (
  teamMembers: SenierProjectTeamMember[]
): boolean => {
  return !teamMembers.every((member: SenierProjectTeamMember) =>
    checkRequiredProperties(['name', 'uniId', 'introduction'], member)
  );
};

const sortAsc = (a: number, b: number) => {
  return a - b;
};

const setTeamMembers = (
  teamMembers: SenierProjectTeamMember[] = [],
  id: string = ''
): Promise<number[]>[] => {
  return teamMembers.map(async (member) => {
    return knex('team_member').insert({
      id,
      uni_id: member.uniId,
      name: member.name,
      introduction: member.introduction,
      profile_image: member.image,
    });
  });
};

const s3UploadFromBinary = async (
  files: { [fieldname: string]: Express.Multer.File[] },
  path: string
): Promise<AWS.S3.ManagedUpload.SendData[]> => {
  const s3UploadResultList: Promise<AWS.S3.ManagedUpload.SendData>[] =
    Object.values(files).map(async ([file]) => {
      const fileBuffer = await (async () => {
        if (!(file.fieldname == 'projectDesign')) {
          file.originalname = `${file.originalname}.png`;

          return await sharp(file.buffer)
            .resize({ fit: 'fill', width: 1080, height: 790 })
            .toBuffer();
        }

        return file.buffer;
      })();

      return s3Controller.uploadFile(
        fileBuffer,
        `${path}/${file.originalname}`
      );
    });

  return Promise.all(s3UploadResultList);
};

const formatSenierProject = (
  senierProject: PostSenierProject,
  files: { [fieldname: string]: Express.Multer.File[] },
  s3UploadResult: AWS.S3.ManagedUpload.SendData[]
): SenierProject => {
  const cloneSenierProject: PostSenierProject = Object.assign(senierProject);

  Object.values(files).forEach((file: Express.Multer.File[], index: number) => {
    const s3key: string = s3UploadResult[index].Key;

    if (file[0].fieldname === 'projectDesign') {
      cloneSenierProject.projectDesign = s3key;
    } else {
      cloneSenierProject.teamMember[
        Number(file[0].fieldname.replace(/[^0-9]/g, '')) - 1
      ].image = s3key;
    }
  });

  return cloneSenierProject;
};

const checkObjectEmptyValue = (
  keys: string[],
  data: SenierProject
): string | false => {
  if (!Array.isArray(keys)) {
    return false;
  }

  const findEmptyIndex: number = keys.findIndex(
    (key: string) => !data[key]?.length
  );

  if (findEmptyIndex === -1) {
    return false;
  }

  return keys[findEmptyIndex];
};

const doubleCheckMembers = async (teamMembers: SenierProjectTeamMember[]) => {
  let isOk = false;
  let duplicateMember: string[] = [];

  const searchMembers = await Promise.all(
    teamMembers.map(async (member: SenierProjectTeamMember) => {
      return await knex('team_member')
        .select('name')
        .where({ uni_id: member.uniId })
        .first();
    })
  );

  searchMembers.forEach((member) => {
    if (!!member) {
      isOk = true;
      duplicateMember.push(member.name);
    }
  });

  return { isOk, duplicateMember: duplicateMember.join(', ') };
};

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
    { name: 'profileImage5', maxCount: 1 },
    { name: 'profileImage6', maxCount: 1 },
    { name: 'profileImage7', maxCount: 1 },
    { name: 'profileImage8', maxCount: 1 },
  ]),
  verifyAccessToken,
  async (req: Request, res: Response, next: NextFunction) => {
    if (
      !checkRequiredProperties(
        [
          'groupName',
          'classId',
          'year',
          'teamMember',
          'link',
          'plattform',
          'technology',
        ],
        JSON.parse(JSON.stringify(req.body))
      )
    ) {
      return res.status(400).json({ message: '잘못된 요청입니다,' });
    }

    const body: SenierProject = jsonToObjectParse(
      ['teamMember', 'link', 'plattform', 'technology'],
      req.body
    );

    if (!body?.teamMember?.length) {
      return res.status(400).json({ message: '팀원은 한명이상이 필요합니다.' });
    }

    if (
      checkTeamMembersRequireProperties(
        body.teamMember as SenierProjectTeamMember[]
      )
    ) {
      return res.status(400).json({ message: '잘못된 요청입니다,' });
    }

    const emptyValue: string | false = checkObjectEmptyValue(
      ['plattform', 'technology', 'link'],
      body
    );

    if (emptyValue) {
      return res.status(400).json({
        message: `${
          { plattform: '플랫폼', technology: '기술', link: '링크' }[emptyValue]
        }(를)을 하나 이상 넣어주십시오.`,
      });
    }

    const email = res.locals.email;

    try {
      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!isAdmin) {
        return res
          .status(403)
          .json({ code: 403, message: '관리자 계정이 아닙니다.' });
      }

      const { groupName } = (await knex('senier_project')
        .select('group_name as groupName')
        .where({
          year: body.year,
          class_id: body.classId,
          group_name: body.groupName,
        })
        .first()) || { groupName: false };

      if (!!groupName) {
        return res.status(400).json({
          message: `${groupName}은 이미 등록되어 있는 조 이름 입니다.`,
        });
      }

      const files: {
        [fieldname: string]: Express.Multer.File[];
      } = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };
      const s3UploadResult: AWS.S3.ManagedUpload.SendData[] =
        await s3UploadFromBinary(files, `${body.year}/${body.groupName}`);
      const senierProject: SenierProject = formatSenierProject(
        body as PostSenierProject,
        files,
        s3UploadResult
      );
      const uniqueID: string = generatedUniqueID();
      const checkMembersResult = await doubleCheckMembers(
        senierProject.teamMember as SenierProjectTeamMember[]
      );

      if (checkMembersResult.isOk) {
        return res.status(400).json({
          message: `${checkMembersResult.duplicateMember} 은(는) 이미 등록되어 있습니다.`,
        });
      }

      await Promise.all([
        setTeamMembers(
          senierProject.teamMember as SenierProjectTeamMember[],
          uniqueID
        ),
        knex('senier_project').insert({
          id: uniqueID,
          year: senierProject.year,
          link: JSON.stringify(senierProject.link),
          group_name: senierProject.groupName,
          class_id: senierProject.classId,
          project_design: senierProject.projectDesign,
          plattform: JSON.stringify(
            (senierProject.plattform as number[]).sort(sortAsc)
          ),
          technology: JSON.stringify(
            (senierProject.technology as number[]).sort(sortAsc)
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

const fomatUpdateSenierProject = (
  body: any,
  s3UploadResult: any,
  files: any
) => {
  const { teamMember, ...data } = body;
  const checkUpdateProjectDesign: S3_FILE[] | undefined = Object.values(
    files
  ).find((file: any) => file[0].fieldname === 'projectDesign') as
    | S3_FILE[]
    | undefined;

  if (!!checkUpdateProjectDesign) {
    const projectDesign = s3UploadResult.find((s3UploadInfo: any) =>
      s3UploadInfo.key.includes(checkUpdateProjectDesign[0].originalname)
    );

    data.projectDesign = projectDesign.key;
  }

  const newTeamMember: SenierProjectTeamMember[] = teamMember.map(
    (member: SenierProjectTeamMember) => {
      if (!member?.image) {
        const image = s3UploadResult.find((s3UploadInfo: any) =>
          s3UploadInfo.key.includes(member.name)
        );

        member.image = image.key;
      }

      return member;
    }
  );

  return {
    ...{ teamMember: newTeamMember },
    ...data,
  };
};

app.patch(
  '/',
  verifyAccessToken,
  multer({
    storage: multer.memoryStorage(),
  }).fields([
    { name: 'projectDesign', maxCount: 1 },
    { name: 'profileImage1', maxCount: 1 },
    { name: 'profileImage2', maxCount: 1 },
    { name: 'profileImage3', maxCount: 1 },
    { name: 'profileImage4', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    if (
      !checkRequiredProperties(
        [
          'groupName',
          'classId',
          'year',
          'teamMember',
          'link',
          'plattform',
          'technology',
        ],
        JSON.parse(JSON.stringify(req.body))
      )
    ) {
      return res.status(400).json({ message: '잘못된 요청입니다,' });
    }

    const body: SenierProject = jsonToObjectParse(
      ['teamMember', 'link', 'plattform', 'technology'],
      req.body
    );
    const email: string = res.locals.email;

    try {
      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!isAdmin) {
        return res
          .status(403)
          .json({ code: 403, message: '관리자 계정이 아닙니다.' });
      }

      const files: {
        [fieldname: string]: Express.Multer.File[];
      } = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      const s3UploadResult: AWS.S3.ManagedUpload.SendData[] =
        await s3UploadFromBinary(files, `${body.year}/${body.groupName}`);
      const senierProject: PostSenierProject = fomatUpdateSenierProject(
        body,
        s3UploadResult,
        files
      );

      await Promise.all([
        knex('senier_project')
          .update({
            class_id: senierProject.classId,
            group_name: senierProject.groupName,
            year: senierProject.year,
            link: JSON.stringify(senierProject.link),
            plattform: JSON.stringify(senierProject.plattform),
            technology: JSON.stringify(senierProject.technology),
            project_design: senierProject.projectDesign,
          })
          .where({ id: senierProject.id }),
        senierProject.teamMember.map(
          async (member: SenierProjectTeamMember) => {
            return knex('team_member')
              .insert({
                id: senierProject.id,
                uni_id: member.uniId,
                name: member.name,
                introduction: member.introduction,
                profile_image: member.image,
              })
              .onConflict()
              .ignore();
          }
        ),
      ]);

      res.status(201).json({ isPosted: true });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

app.delete('/:id', verifyAccessToken, async (req: Request, res: Response) => {
  const id: string = req.params.id;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요입니다.' });
  }

  const email: string = res.locals.email;

  try {
    const { is_admin: isAdmin } = await knex('user')
      .select('is_admin')
      .where({ id: email })
      .first();

    if (!isAdmin) {
      return res
        .status(403)
        .json({ code: 403, message: '관리자 계정이 아닙니다.' });
    }

    const { deleteProjectDesign } = await knex('senier_project')
      .select('project_design as deleteProjectDesign')
      .where({ id })
      .first();
    const deleteProfileImages: { image: string }[] = await knex('team_member')
      .select('profile_image as image')
      .where({ id });

    Promise.all([
      deleteProfileImages.map((deleteInfo: { image: string }) => {
        return s3Controller.deleteObject(deleteInfo.image);
      }),
      s3Controller.deleteObject(deleteProjectDesign),
      knex('senier_project').where({ id }).delete(),
      knex('team_member').where({ id }).delete(),
    ]);

    res.status(200).json({ isDeleted: true });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.delete(
  '/member/:id',
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const id: string = req.params.id;

    if (!id) {
      return res.status(400).json({ message: '잘못된 요입니다.' });
    }

    const email: string = res.locals.email;

    try {
      const { is_admin: isAdmin } = await knex('user')
        .select('is_admin')
        .where({ id: email })
        .first();

      if (!isAdmin) {
        return res
          .status(403)
          .json({ code: 403, message: '관리자 계정이 아닙니다.' });
      }

      const { deleteProfileImage } = await knex('team_member')
        .select('profile_image as deleteProfileImage')
        .where({ uni_id: id })
        .first();

      Promise.all([
        s3Controller.deleteObject(deleteProfileImage),
        knex('team_member').where({ uni_id: id }).delete(),
      ]);

      res.status(200).json({ isDeleted: true });
    } catch (error: any) {
      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

type QueryElement = string | number | string[] | number[] | null;

const formatTeamMembers = (
  teamMembers: { id: string; name: string }[]
): { [key: string]: string[] } => {
  return teamMembers.reduce(
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

const senierProjectParser = (senierProject: SenierProject): SenierProject => {
  const { plattform, technology, link, ...data } = senierProject;

  data.plattform = JSON.parse(plattform as string);
  data.technology = JSON.parse(technology as string);
  if (!!link) {
    data.link = JSON.parse(link as string);
  }

  return data;
};

const senierProjectListParser = (
  senierProject: SenierProject[]
): SenierProject[] => {
  return senierProject.reduce(
    (result: SenierProject[], senierProjectInfo: SenierProject) => {
      result.push(senierProjectParser(senierProjectInfo));

      return result;
    },
    []
  );
};

const formatSearchOption = (SerachOption: QueryElement) => {
  if (!SerachOption) {
    return null;
  }

  return `[${[...([SerachOption] as string[])]}]`;
};

const getNameByIds = (tableName: string, option: number[]) => {
  return knex(tableName).select('name').whereIn('id', option);
};

const formatSenierProjectList = async (
  senierProject: SenierProject[],
  teamMembers: { [key: string]: string[] }
) => {
  const senierProjectList = await Promise.all(
    senierProject.map(async (data: SenierProject) => {
      const [plattforms, technologys] = await Promise.all([
        getNameByIds('plattform', data.plattform as number[]),
        getNameByIds('technology', data.technology as number[]),
      ]);

      data.teamMember = teamMembers[data.id as string].join(', ');
      data.plattform = plattforms
        .map((plattform) => {
          return plattform.name;
        })
        .join(', ');
      data.technology = technologys.map((technology) => {
        return technology.name;
      });

      return data;
    })
  );

  return senierProjectList.filter((data: SenierProject | undefined) => !!data);
};

app.get('/list', async (req: Request, res: Response) => {
  const { year, name, plattform, technology, classId } = req.query;

  if (!year) {
    return res.status(400).json({ message: '연차정보를 입력해주세요.' });
  }

  const plattformOption = formatSearchOption(plattform as QueryElement);
  const technologyOption = formatSearchOption(technology as QueryElement);

  const getSenierProjects = knex('senier_project')
    .select(
      'id',
      'group_name as groupName',
      'plattform',
      'technology',
      'view_count as viewCount'
    )
    .where({ year })
    .orderByRaw('RAND()');
  const getTeamMembers = knex('team_member')
    .select('team_member.id', 'team_member.name')
    .innerJoin('senier_project', 'senier_project.id', 'team_member.id')
    .where({ 'senier_project.year': year });

  if (!!classId) {
    getSenierProjects.where({ class_id: classId });
    getTeamMembers.where({ 'senier_project.class_id': classId });
  }

  if (!!plattformOption) {
    getSenierProjects.whereJsonSupersetOf('plattform', plattformOption);
    getTeamMembers.whereJsonSupersetOf(
      'senier_project.plattform',
      plattformOption
    );
  }

  if (!!technologyOption) {
    getSenierProjects.whereJsonSupersetOf('technology', technologyOption);
    getTeamMembers.whereJsonSupersetOf(
      'senier_project.technology',
      technologyOption
    );
  }

  try {
    if (!!name) {
      const getSenierProjectIds = await knex('team_member')
        .select('id')
        .where({ name });

      const senierProjectIds = getSenierProjectIds.map(
        (data: { id: string }) => data.id
      );

      getSenierProjects.whereIn('id', senierProjectIds);
      getTeamMembers.whereIn('senier_project.id', senierProjectIds);
    }

    const [senierProject, teamMember]: [
      senierProject: SenierProject[] | (SenierProject | undefined)[],
      teamMember: { [key: string]: string[] }
    ] = await Promise.all([
      getSenierProjects.then((senierProject: SenierProject[]) => {
        return senierProjectListParser(senierProject);
      }),
      getTeamMembers.then((teamMember: { id: string; name: string }[]) => {
        return formatTeamMembers(teamMember);
      }),
    ]);

    const senierProjectList = await formatSenierProjectList(
      senierProject as SenierProject[],
      teamMember
    );

    res.status(200).json({ senierProjectList });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const formatRecommendList = (recommendList: any) => {
  return recommendList.map(async (recommendInfo: any) => {
    const [teamMembers, plattforms, technologys] = await Promise.all([
      knex('team_member').select('name').where({ id: recommendInfo.id }),
      getNameByIds(
        'plattform',
        JSON.parse(recommendInfo.plattform) as number[]
      ),
      getNameByIds(
        'technology',
        JSON.parse(recommendInfo.technology) as number[]
      ),
    ]);

    recommendInfo.teamMember =
      formatTeamMembers(teamMembers)['undefined'].join(', ');
    recommendInfo.plattform = plattforms
      .map((plattform) => {
        return plattform.name;
      })
      .join(', ');
    recommendInfo.technology = technologys.map((technology) => {
      return technology.name;
    });

    return recommendInfo;
  });
};

app.get('/recommend', async (req: Request, res: Response) => {
  const id: string = req.query.id as string;

  if (!id) {
    res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const { plattform } = await knex('senier_project')
      .select('plattform')
      .where({ id })
      .first();

    const recommendList = await knex('senier_project')
      .select(
        'id',
        'year',
        'group_name as groupName',
        'plattform',
        'technology',
        'view_count as viewCount'
      )
      .whereJsonSupersetOf('plattform', JSON.parse(plattform))
      .whereNot({ id })
      .orderByRaw('RAND()')
      .limit(5);

    const senierProjectRecommendList = await Promise.all(
      formatRecommendList(recommendList)
    );

    res.status(200).json({ senierProjectRecommendList });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

const formatTeamMemberList = async (
  teamMemberList: SenierProjectTeamMember[]
): Promise<SenierProjectTeamMember[]> => {
  const teamMember = await Promise.all(
    teamMemberList.map(async (memberInfo: SenierProjectTeamMember) => {
      const imageURL =
        !!memberInfo.image &&
        (await s3Controller.getObjectURL(memberInfo.image));

      const user = await knex('user')
        .select('id')
        .where({ uni_id: memberInfo.id, name: memberInfo.name })
        .first();

      const teamMember: SenierProjectTeamMember = {
        name: memberInfo.name as string,
        introduction: memberInfo.introduction,
        ...(!!imageURL && { image: imageURL.split('?')[0] }),
        ...(!!user?.id && { id: user.id }),
        ...(!!memberInfo.id && { uniId: memberInfo.id }),
      };

      return teamMember;
    })
  );

  return teamMember;
};

app.get('/detail/members', async (req: Request, res: Response) => {
  const id: string = req.query.id as string;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const teamMemberList: SenierProjectTeamMember[] = await knex('team_member')
      .select('uni_id as id', 'name', 'introduction', 'profile_image as image')
      .where({ id });

    res.status(200).json({
      senierProjectMemberList: await formatTeamMemberList(teamMemberList),
    });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/detail/design', async (req: Request, res: Response) => {
  const id: string = req.query.id as string;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    const { projectDesignKey }: { projectDesignKey: string } = await knex(
      'senier_project'
    )
      .select('project_design as projectDesignKey')
      .where({ id })
      .first();
    const projectDesignURL = await s3Controller.getObjectURL(projectDesignKey);

    res.status(200).json({ projectDesign: projectDesignURL });
  } catch (error: any) {
    if (!isNaN(error.code) && !!error.message) {
      return res.status(error.code).json({ message: error.message });
    }

    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

app.get('/detail/announced', async (req: Request, res: Response) => {
  const id: string = req.query.id as string;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
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

app.get(
  '/detail/group',
  (req: Request, res: Response, next: NextFunction) => {
    setViewCount(req, res, next, 'senier_project');
  },
  async (req: Request, res: Response) => {
    const id: string = req.query.id as string;

    if (!id) {
      return res.status(400).json({ message: '잘못된 요청입니다.' });
    }

    try {
      const { groupName, year }: { groupName: string; year: string } =
        await knex('senier_project')
          .select('group_name as groupName', 'year')
          .where({ id })
          .first();

      res.status(200).json({ groupName, year });
    } catch (error: any) {
      if (!isNaN(error.code) && !!error.message) {
        return res.status(error.code).json({ message: error.message });
      }

      res.status(500).json({ message: '서버요청에 실패하였습니다.' });
    }
  }
);

const formatSenierProjectDetail = async (
  senierProject: SenierProject,
  teamMembers: SenierProjectTeamMember[]
) => {
  const { plattform, technology, classId, ...data } = senierProject;
  const getNameAndId = (tableName: string, option: number[]) => {
    return knex(tableName).select('*').whereIn('id', option);
  };

  const [plattformList, technologyList, classInfo] = await Promise.all([
    getNameAndId('plattform', plattform as number[]),
    getNameAndId('technology', technology as number[]),
    knex('class').select('*').where({ id: classId }).first(),
  ]);

  const result = {
    ...data,
    ...{ plattform: plattformList },
    ...{ technology: technologyList },
    ...{ classInfo },
    ...{ teamMember: teamMembers },
  };

  return result;
};

app.get('/detail', verifyAccessToken, async (req: Request, res: Response) => {
  const id = req.query.id;

  if (!id) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const email: string = res.locals.email;

  try {
    const { is_admin: isAdmin } = await knex('user')
      .select('is_admin')
      .where({ id: email })
      .first();

    if (!isAdmin) {
      return res
        .status(403)
        .json({ code: 403, message: '관리자 계정이 아닙니다.' });
    }

    const senierProject: SenierProject = await knex('senier_project')
      .select(
        'id',
        'year',
        'link',
        'group_name as groupName',
        'class_id as classId',
        'project_design as projectDesign',
        'plattform',
        'technology'
      )
      .where({ id })
      .first();
    const oldTeamMemberList: SenierProjectTeamMember[] = await knex(
      'team_member'
    )
      .select('uni_id as id', 'name', 'introduction', 'profile_image as image')
      .where({ id });
    const teamMemberList = await formatTeamMemberList(oldTeamMemberList);
    const senierProjectDetailInfo = await formatSenierProjectDetail(
      senierProjectParser(senierProject),
      teamMemberList
    );

    res.status(200).json({ senierProjectDetailInfo });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
