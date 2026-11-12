import express from 'express';
import { actionRouter } from './routes/actionRoutes.js';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/authRoutes.js';
import { agentRouter } from './routes/agentRoutes.js';
import { policyRouter } from './routes/policyRoutes.js';
import { PolicyUnavailableError } from './services/opaPolicy.js';
import { EmailConfigurationError } from './services/emailDelivery.js';
import { Prisma } from '@prisma/client';

export const app = express();
let lastDatabaseWarning = 0;

app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
app.use('/api/auth', authRouter);
app.use('/api/actions', actionRouter);
app.use('/api/agents', agentRouter);
app.use('/api/policy', policyRouter);

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.too.large') return response.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'Action JSON must be at most 16 KB.' });
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({
      error: 'INVALID_JSON',
      message: 'Request body must contain valid JSON.',
    });
  }

  if (error instanceof EmailConfigurationError) {
    return response.status(503).json({ error: 'EMAIL_NOT_CONFIGURED', message: error.message });
  }
  if (error instanceof Prisma.PrismaClientInitializationError
    || ['P1001', 'P1002', 'P1017'].includes(error.code ?? error.errorCode)) {
    if (Date.now() - lastDatabaseWarning > 30000) {
      console.error('AgentShield database unavailable. Check the local database process.');
      lastDatabaseWarning = Date.now();
    }
    return response.status(503).json({ error: 'DATABASE_UNAVAILABLE',
      message: 'The database is temporarily unavailable. The dashboard will retry; keep the local database running.' });
  }
  console.error(error);
  if (error instanceof PolicyUnavailableError) {
    return response.status(503).json({
      error: 'POLICY_UNAVAILABLE',
      message: 'Action policy could not be evaluated. No request was saved. Try again after the policy service is restored.',
    });
  }
  return response.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred.',
  });
});
