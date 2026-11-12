import { access, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the already-installed local Prisma development server, without fetching
// a new version or changing the application's Prisma Client dependency.
const require = createRequire(import.meta.url);
let serverModule;
try {
  serverModule = require.resolve('@prisma/dev');
} catch {
  if (process.env.LOCALAPPDATA) {
    const cache = join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
    const entries = await readdir(cache, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter(entry => entry.isDirectory())) {
      const packagePath = join(cache, entry.name, 'node_modules', '@prisma', 'dev');
      try { serverModule = require.resolve(packagePath); break; } catch { /* Try the next cached install. */ }
    }
  }
}

if (!serverModule) {
  throw new Error('Local Prisma server tooling was not found. Start your configured PostgreSQL database, or set up Prisma dev tooling first.');
}

// Match the package's ESM entry point when launching from an ESM script.
// require.resolve selects its CommonJS entry; prefer the ESM build used by the
// previously verified local recovery.
if (serverModule.endsWith('.cjs')) {
  const esmModule = serverModule.slice(0, -4) + '.js';
  try { await access(esmModule); serverModule = esmModule; } catch { /* Use the resolved entry if no ESM build exists. */ }
}
const { startPrismaDevServer } = await import(pathToFileURL(serverModule).href);
let server;
try {
  server = await startPrismaDevServer({
    name: 'agentshield', persistenceMode: 'stateful', port: 51213,
    databasePort: 51214, shadowDatabasePort: 51215, streamsPort: 51216,
  });
} catch (error) {
  console.error(`Unable to start local database: ${error.message}`);
  process.exit(1);
}
console.log('AgentShield local database ready on port 51214. Keep this terminal open during the demo.');
const keepAlive = setInterval(() => {}, 60000);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(keepAlive);
  await server.close();
  if (process.connected) process.disconnect();
}
process.on('SIGINT', () => close().catch(error => { console.error(error.message); process.exitCode = 1; }));
process.on('SIGTERM', () => close().catch(error => { console.error(error.message); process.exitCode = 1; }));
process.on('message', message => {
  if (message === 'shutdown') close().catch(error => { console.error(error.message); process.exitCode = 1; });
});
