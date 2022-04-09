import express from 'express';
const app: express.Application = express();

import apiAuth from './auth/index';
app.use('/auth', apiAuth);

import apiToken from './token/index';
app.use('/token', apiToken);

import apiMap from './map/index';
app.use('/map', apiMap);

import apiCategory from './category/index';
app.use('/category', apiCategory);

import apiEmployment from './employment/index';
app.use('/employment', apiEmployment);

export default app;
