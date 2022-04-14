import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
dotenv.config();

const sendMail = ({
  toEmail = '',
  title = '',
  content = '',
}: {
  toEmail: string;
  title: string;
  content: string;
}): Promise<SMTPTransport.SentMessageInfo> => {
  const mailConfig = {
    service: 'Naver',
    host: 'smtp.naver.com',
    port: 587,
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  };

  const message = {
    from: process.env.NODEMAILER_USER,
    to: toEmail,
    subject: title,
    html: `${content}`,
  };

  const transporter = nodemailer.createTransport(mailConfig);

  return new Promise((resolve, reject) => {
    transporter.sendMail(message, (err, info) => {
      if (err) {
        reject({ code: 500, message: '메일 발송에 실패 하였습니다.' });
      }
      resolve(info);
    });
  });
};

export default sendMail;
