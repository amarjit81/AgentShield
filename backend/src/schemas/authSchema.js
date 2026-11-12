import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes. Reject longer input instead of truncating.
export const passwordSchema = z.string().min(12).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.');
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
export const accountSchema = loginSchema.extend({ role: z.enum(['USER', 'MANAGER', 'ADMIN']) });
