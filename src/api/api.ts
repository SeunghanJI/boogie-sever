import express from 'express';
const app: express.Application = express();

import apiAuth from './auth/index';
app.use('/auth', apiAuth);

import apiToken from './token/index';
app.use('/token', apiToken);

import apiMap from './map/index';
app.use('/map', apiMap);

import apiSenierProject from './senier-project/index';
app.use('/senier-project', apiSenierProject);

import apiCategory from './category/index';
app.use('/category', apiCategory);

import apiEmployment from './employment/index';
app.use('/employment', apiEmployment);

import apiCommunity from './community/index';
app.use('/community', apiCommunity);

import apiProfile from './profile/index';
app.use('/profile', apiProfile);

import apiHelp from './help/index';
app.use('/help', apiHelp);

import apiManagement from './management/index';
app.use('/management', apiManagement);

import apiBanner from './banner/index';
app.use('/banner', apiBanner);

export default app;
