import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

dotenv.config();

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const configPath = resolve(process.cwd(), 'src', 'app_config.json');
let appConfig = {};

try {
  appConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.error('Unable to read src/app_config.json:', error.message);
  process.exit(1);
}

const recipientEmail = appConfig?.email;
const senderEmail = process.env.SES_SOURCE_EMAIL || appConfig?.ses_source_email;
const awsRegion = process.env.AWS_REGION || appConfig?.aws_region;

if (!recipientEmail) {
  console.error('Recipient email is missing in src/app_config.json');
  process.exit(1);
}

if (!senderEmail) {
  console.error(
    'Sender email is not configured. Set SES_SOURCE_EMAIL or app_config.json ses_source_email.'
  );
  process.exit(1);
}

if (!awsRegion) {
  console.error('AWS region is not configured. Set AWS_REGION or app_config.json aws_region.');
  process.exit(1);
}

const sesClient = new SESClient({ region: awsRegion });

app.post('/send-email-summary', async (req, res) => {
  const { recipient = recipientEmail, subject, body, html } = req.body || {};

  if (!subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: subject and body' });
  }

  try {
    const messageBody = {
      Text: {
        Data: body,
        Charset: 'UTF-8',
      },
    };

    if (html) {
      messageBody.Html = {
        Data: html,
        Charset: 'UTF-8',
      };
    }

    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: [recipient],
      },
      Message: {
        Body: messageBody,
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
      },
      Source: senderEmail,
    });

    await sesClient.send(command);
    return res.json({ message: 'Email sent', recipient });
  } catch (error) {
    console.error('SES send error:', error);
    return res.status(500).json({ error: error.message || 'SES send failed' });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`SES email server is running at http://localhost:${PORT}`);
  console.log(`Sending email summaries to ${recipientEmail} from ${senderEmail}`);
});
