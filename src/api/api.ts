import express, { Request, Response, NextFunction } from 'express';
const app: express.Application = express();

import apiAuth from './auth/index';
app.use('/auth', apiAuth);

import apiToken from './token/index';
app.use('/token', apiToken);

import apiMap from './map/index';
app.use('/map', apiMap);

import apiCategory from './category/index';
app.use('/category', apiCategory);

export default app;
