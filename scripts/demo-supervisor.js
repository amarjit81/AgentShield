import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const backend = join(root, 'backend');
const services = [
  { name: 'database', port: 51214, cwd: backend, args: ['scripts/start-local-database.js'] },
  { name: 'backend', port: 3000, cwd: backend, args: ['src/server.js'] },
  { name: 'frontend', port: 5173, cwd: root,
    args: ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'] },
];
const children = new Map();
const starting = new Set();
const attempts = new Map();
let checking = false;
let stopping = false;
let timer;
let lastDatabaseCheck = 0;

function probe(port, host) {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function listening(port) {
  const [ipv4, ipv6] = await Promise.all([probe(port, '127.0.0.1'), probe(port, '::1')]);
  return ipv4 || ipv6;
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await listening(port)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function ensure(service) {
  if (await listening(service.port)) return true;
  if (starting.has(service.name)) return false;
  const recent = (attempts.get(service.name) || []).filter(time => Date.now() - time < 60000);
  if (recent.length >= 5) {
    console.error(`${service.name} failed to start five times in one minute. Check its output and configuration.`);
    return false;
  }
  attempts.set(service.name, [...recent, Date.now()]);
  starting.add(service.name);
  console.log(`Starting ${service.name} on port ${service.port}...`);
  try {
    const child = spawn(process.execPath, service.args, {
      cwd: service.cwd, stdio: service.name === 'database' ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', windowsHide: true,
    });
    children.set(service.name, child);
    child.on('error', error => console.error(`${service.name} could not start: ${error.message}`));
    child.on('exit', code => {
      if (children.get(service.name) === child) children.delete(service.name);
      if (!stopping) console.error(`${service.name} stopped (exit ${code}); checking again shortly.`);
    });
    const ready = await waitForPort(service.port);
    if (!ready) console.error(`${service.name} did not become ready within 15 seconds.`);
    return ready;
  } finally {
    starting.delete(service.name);
  }
}

function databaseHealthy() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/check-local-database.js'], {
      cwd: backend, stdio: 'ignore', windowsHide: true,
    });
    const timeout = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once('error', () => { clearTimeout(timeout); resolve(false); });
    child.once('close', code => { clearTimeout(timeout); resolve(code === 0); });
  });
}

async function restartUnhealthyDatabase() {
  const child = children.get('database');
  if (!child) {
    console.error('Database port is open but queries fail. Stop the separately launched database and let this monitor restart it.');
    return;
  }
  console.error('Database stopped answering queries; restarting the monitored database process.');
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill(); resolve(); }, 3000);
    child.once('close', () => { clearTimeout(timeout); resolve(); });
    if (child.connected) child.send('shutdown');
    else child.kill();
  });
}

async function check() {
  if (checking || stopping) return false;
  checking = true;
  try {
    for (const service of services) {
      if (!await ensure(service)) return false;
    }
    if (Date.now() - lastDatabaseCheck >= 30000) {
      lastDatabaseCheck = Date.now();
      if (!await databaseHealthy()) {
        await restartUnhealthyDatabase();
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error(`Demo service check failed: ${error.message}`);
    return false;
  } finally {
    checking = false;
  }
}

function close() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  for (const child of children.values()) child.kill('SIGINT');
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
const ready = await check();
console.log(ready ? 'AgentShield demo ready: http://localhost:5173/' : 'AgentShield demo monitor running; waiting for services.');
timer = setInterval(check, 5000);
