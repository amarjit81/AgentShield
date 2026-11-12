import { z } from 'zod';
import { emailSchema } from './authSchema.js';

export const emailArgumentsSchema = z.object({
  subject: z.string().min(1).max(200)
    .refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value), 'Subject must be nonempty and contain no control characters.'),
  body: z.string().min(1).max(8000)
    .refine(value => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 8000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Body must be plain text, nonempty, and at most 8000 UTF-8 bytes.'),
}).strict();

export const emailActionFields = { action: z.literal('SEND_EMAIL'), target: emailSchema, arguments: emailArgumentsSchema };
