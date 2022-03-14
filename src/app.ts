import express, { Request, Response, NextFunction } from "express";
import API from "./api/api";
const app = express();
const port: number = 3000;

app.use("/api", API);

app.listen(process.env.PORT || port, () => {
  console.log(`listening on port: ${port}`);
});
