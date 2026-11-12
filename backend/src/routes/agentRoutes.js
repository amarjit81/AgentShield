import { Router } from 'express';
import { requireAuth } from '../services/authService.js';
import { listOwnedAgents } from '../services/agentService.js';

export const agentRouter = Router();
agentRouter.get('/', requireAuth, async (request, response) => {
  response.json({ agents: await listOwnedAgents(request.user.id) });
});
