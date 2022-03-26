import express, { Request, Response, NextFunction } from 'express';
const app: express.Application = express();

import apiAuth from './auth/index';
app.use('/auth', apiAuth);

export default app;
