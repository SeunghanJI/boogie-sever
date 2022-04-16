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
  return transporter.sendMail(message);
};

export default sendMail;
