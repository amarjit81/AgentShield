import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sandboxActionFields } from '../schemas/sandboxSchema.js';
import { z } from 'zod';

const actionSchema = z.object(sandboxActionFields);
// The only physical files this tool can reach live in this ignored directory.
export const sandboxDirectory = process.env.AGENTSHIELD_TEST_DATABASE === '1'
  ? resolve(tmpdir(), `agentshield-sandbox-test-${process.pid}`)
  : process.env.VERCEL
    ? resolve(tmpdir(), 'agentshield-demo-workspace')
    : resolve(dirname(fileURLToPath(import.meta.url)), '../../demo-workspace');
const noFollow = constants.O_NOFOLLOW ?? 0;
const digest = content => createHash('sha256').update(content).digest('hex');

async function directory(path) {
  try { await mkdir(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe sandbox directory.');
}

async function targetPath(logicalPath, createParents) {
  if (!logicalPath.startsWith('workspace/') || logicalPath === 'workspace/protected'
    || logicalPath.startsWith('workspace/protected/')) throw new Error('Unsafe sandbox path.');
  const segments = logicalPath.slice('workspace/'.length).split('/');
  if (segments.some(segment => !/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(segment))) throw new Error('Unsafe sandbox path.');
  await directory(sandboxDirectory);
  let parent = sandboxDirectory;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    if (createParents) await directory(parent);
    else {
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe sandbox directory.');
    }
  }
  const physical = join(parent, segments.at(-1));
  if (!physical.startsWith(sandboxDirectory + sep)) throw new Error('Unsafe sandbox path.');
  return physical;
}

export async function executeSandboxFile(action) {
  const parsed = actionSchema.parse(action);
  const { operation } = parsed.arguments;
  const physical = await targetPath(parsed.target, operation === 'WRITE');
  const receipt = { tool: 'SANDBOX_FILE', simulated: false, filesystemAccessed: true,
    agentId: action.agentId, target: parsed.target, operation };
  if (operation === 'WRITE') {
    // Exclusive creation refuses existing files and symlinks. A later write needs a new name.
    const file = await open(physical, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    try { await file.writeFile(parsed.arguments.content, 'utf8'); } finally { await file.close(); }
    return { ...receipt, contentBytes: Buffer.byteLength(parsed.arguments.content, 'utf8'),
      contentSha256: digest(parsed.arguments.content) };
  }
  const entry = await lstat(physical);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Sandbox target must be a regular file.');
  if (operation === 'DELETE' || operation === 'CHANGE') {
    const current = await readSandboxFile(parsed.target);
    if (action.fileSha256 !== current.sha256) throw new Error('File changed since Manager review. Create a new request.');
    if (operation === 'DELETE') {
      await unlink(physical);
      return { ...receipt, deleted: true, previousSha256: current.sha256 };
    }
    const file = await open(physical, constants.O_RDWR | noFollow);
    try {
      const latest = await file.readFile('utf8');
      if (digest(latest) !== current.sha256) throw new Error('File changed since Manager review. Create a new request.');
      const bytes = Buffer.from(parsed.arguments.content, 'utf8');
      let written = 0;
      while (written < bytes.length) {
        const result = await file.write(bytes, written, bytes.length - written, written);
        if (!result.bytesWritten) throw new Error('Could not complete file change.');
        written += result.bytesWritten;
      }
      await file.truncate(bytes.length);
      return { ...receipt, previousSha256: current.sha256, contentBytes: bytes.length, contentSha256: digest(parsed.arguments.content) };
    } finally { await file.close(); }
  }
  const { content, contentBytes } = await readSandboxFile(parsed.target);
  return { ...receipt, content, contentBytes };
}

export async function readSandboxFile(logicalPath) {
  const physical = await targetPath(logicalPath, false);
  const entry = await lstat(physical);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Sandbox target must be a regular file.');
  if (entry.size > 8000) throw new Error('Sandbox file exceeds the 8,000-byte read limit.');
  const file = await open(physical, constants.O_RDONLY | noFollow);
  let content;
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > 8000) throw new Error('Sandbox file exceeds the 8,000-byte read limit.');
    content = await file.readFile('utf8');
  } finally { await file.close(); }
  if (Buffer.byteLength(content, 'utf8') > 8000) throw new Error('Sandbox file exceeds the 8,000-byte read limit.');
  return { content, contentBytes: Buffer.byteLength(content, 'utf8'), sha256: digest(content) };
}
