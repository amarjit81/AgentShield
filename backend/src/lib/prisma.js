import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to start the AgentShield backend.');
}

export const prisma = new PrismaClient();
