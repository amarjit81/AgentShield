import nodemailer from 'nodemailer';
import { emailSchema } from '../schemas/authSchema.js';

export class EmailConfigurationError extends Error {
  constructor(message = 'Configure SMTP settings in backend/.env before sending real email.') {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

export function readEmailDeliveryConfig(env = process.env) {
  const mode = env.EMAIL_DELIVERY_MODE || 'SIMULATED';
  if (mode === 'SIMULATED') return { mode };
  if (mode !== 'SMTP') throw new EmailConfigurationError('EMAIL_DELIVERY_MODE must be SIMULATED or SMTP.');
  const from = emailSchema.safeParse(env.SMTP_FROM);
  const recipients = (env.EMAIL_ALLOWED_RECIPIENTS || '').trim()
    ? env.EMAIL_ALLOWED_RECIPIENTS.split(',').map(value => emailSchema.safeParse(value)) : [];
  const port = Number(env.SMTP_PORT || 465);
  if (!from.success || recipients.length > 10 || recipients.some(value => !value.success)
    || !/^[a-zA-Z0-9.-]+$/.test(env.SMTP_HOST || '') || ![465, 587].includes(port)
    || !env.SMTP_USER?.trim() || !env.SMTP_PASSWORD?.trim()) throw new EmailConfigurationError();
  return {
    mode, from: from.data, allowedRecipients: [...new Set(recipients.map(value => value.data))],
    host: env.SMTP_HOST, port, user: env.SMTP_USER, password: env.SMTP_PASSWORD,
  };
}

// This endpoint intentionally exposes no SMTP host, username, or password.
export function emailDeliveryInfo() {
  try {
    const config = readEmailDeliveryConfig();
    return { mode: config.mode, ready: true, from: config.from ?? null, allowedRecipients: config.allowedRecipients ?? [] };
  } catch {
    return { mode: process.env.EMAIL_DELIVERY_MODE || 'SIMULATED', ready: false, from: null, allowedRecipients: [] };
  }
}

export function createEmailTransport(config) {
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
}

export async function sendSmtpEmail(config, action, messageId) {
  const transport = createEmailTransport(config);
  try {
    const info = await transport.sendMail({
      from: { address: config.from }, to: [{ address: action.target }],
      envelope: { from: config.from, to: [action.target] },
      subject: action.arguments.subject, text: action.arguments.body, messageId,
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (!info.accepted?.some(address => address.toLowerCase() === action.target) || info.rejected?.length) {
      throw new Error('SMTP did not accept the configured recipient.');
    }
    return { messageId: info.messageId || messageId, acceptedAt: new Date().toISOString() };
  } finally {
    transport.close();
  }
}
