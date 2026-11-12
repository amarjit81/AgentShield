import { Router } from 'express';
import { createAction, getAction, reviewAction, executeRequestedAction, getAudit, getPendingActions, getSandboxFilePreview } from '../controllers/actionController.js';
import { requireAuth, requireCsrf, requireManager } from '../services/authService.js';
import { emailDeliveryInfo } from '../services/emailDelivery.js';

export const actionRouter = Router();
actionRouter.use(requireAuth, requireCsrf);

actionRouter.post('/', createAction);
actionRouter.get('/email-delivery', (_request, response) => response.json(emailDeliveryInfo()));
actionRouter.get('/pending', requireManager, getPendingActions);
actionRouter.get('/:id/file-preview', requireManager, getSandboxFilePreview);
actionRouter.get('/:id', getAction);
actionRouter.post('/:id/review', requireManager, reviewAction);
actionRouter.post('/:id/execute', executeRequestedAction);
actionRouter.get('/:id/audit', getAudit);
