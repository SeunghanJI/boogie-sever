import express, { Request, Response, NextFunction } from 'express';
const app: express.Application = express();

import apiAuth from './auth/index';
app.use('/auth', apiAuth);

import apiToken from './token/index';
app.use('/token', apiToken);

export default app;
