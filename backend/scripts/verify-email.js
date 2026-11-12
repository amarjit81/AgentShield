import 'dotenv/config';
import { readEmailDeliveryConfig, createEmailTransport } from '../src/services/emailDelivery.js';

let transport;
try {
  const config = readEmailDeliveryConfig();
  if (config.mode !== 'SMTP') throw new Error('Enable EMAIL_DELIVERY_MODE=SMTP first.');
  transport = createEmailTransport(config);
  await transport.verify();
  console.log('SMTP connection, TLS, and authentication verified. No message was sent. Sender acceptance and inbox delivery still need a test through the dashboard.');
} catch {
  console.error('SMTP verification failed. Check EMAIL_DELIVERY_MODE, SMTP settings, provider access, and credentials in backend/.env. No message was sent.');
  process.exitCode = 1;
} finally {
  transport?.close();
}
