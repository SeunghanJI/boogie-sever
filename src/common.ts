import { NextFunction } from 'express';
import { Knex } from 'knex';
import dotenv from 'dotenv';
dotenv.config();

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

interface Common {
  isExistsProfile?: (id: string) => Promise<boolean>;
}

const common: Common = {};

common.isExistsProfile = async (id: string) => {
  const profile = await knex('user_profile')
    .select('user_id as id')
    .where({ user_id: id })
    .first();
  return !!profile;
};

export default common;
