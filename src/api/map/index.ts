import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();
const app: express.Application = express();

interface AddressInfo {
  address: string;
  x: string;
  y: string;
}

app.get('/search', async (req: Request, res: Response) => {
  if (typeof req.query.address !== 'string' || !req.query.address) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }
  try {
    const address: string = req.query.address;
    axios({
      url: 'https://dapi.kakao.com/v2/local/search/address.json',
      method: 'get',
      headers: {
        Authorization: `KakaoAK ${process.env.KAKAO_API_KEY}`,
      },
      params: {
        query: address,
      },
    }).then(({ data }) => {
      const searchResultList =
        data.documents.reduce((documents: AddressInfo[], document: any) => {
          if (!document?.road_address?.address_name) return;
          const addressInfo: AddressInfo = {
            address: document.road_address.address_name,
            x: document.x,
            y: document.y,
          };
          documents.push(addressInfo);
          return documents;
        }, []) || [];
      res.status(200).json({ searchResultList });
    });
  } catch (error: any) {
    res.status(500).json({ message: '서버요청에 실패하였습니다.' });
  }
});

export default app;
