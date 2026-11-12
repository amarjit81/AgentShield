import { app } from '../backend/src/app.js';

// Vercel treats the Express application as one Node.js Function. The public
// /api routes are rewritten here while the Vite build continues to serve the UI.
export default app;
