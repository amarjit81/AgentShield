import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeSandboxFile, sandboxDirectory } from '../src/services/sandboxFileTool.js';

const name = `agent-shield-test-${randomUUID()}.txt`;
const readSandboxFileDigest = content => createHash('sha256').update(content).digest('hex');
const target = `workspace/${name}`;
const action = (operation, content) => ({ agentId: 'test-agent', action: 'SANDBOX_FILE', target,
  arguments: { operation, ...(['WRITE', 'CHANGE'].includes(operation) ? { content } : {}) } });

describe('contained real sandbox file tool', () => {
  it('creates, reads, and deletes only its demo file', async () => {
    const written = await executeSandboxFile(action('WRITE', 'Hello\nclassroom'));
    expect(written).toMatchObject({ simulated: false, filesystemAccessed: true, operation: 'WRITE', contentBytes: 15 });
    expect((await lstat(join(sandboxDirectory, name))).isFile()).toBe(true);
    await expect(executeSandboxFile(action('WRITE', 'overwrite'))).rejects.toThrow();
    const read = await executeSandboxFile(action('READ'));
    expect(read.content).toBe('Hello\nclassroom');
    const changed = await executeSandboxFile({ ...action('CHANGE', 'Revised text'), fileSha256: readSandboxFileDigest(read.content) });
    expect(changed.operation).toBe('CHANGE');
    expect((await executeSandboxFile(action('READ'))).content).toBe('Revised text');
    await expect(executeSandboxFile({ ...action('CHANGE', 'stale'), fileSha256: readSandboxFileDigest(read.content) })).rejects.toThrow('File changed');
    expect((await executeSandboxFile({ ...action('DELETE'), fileSha256: changed.contentSha256 })).deleted).toBe(true);
    await expect(lstat(join(sandboxDirectory, name))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(executeSandboxFile(action('READ'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal and protected paths before filesystem access', async () => {
    await expect(executeSandboxFile({ ...action('READ'), target: 'workspace/../secrets.txt' })).rejects.toThrow();
    await expect(executeSandboxFile({ ...action('READ'), target: 'workspace/protected/config.txt' })).rejects.toThrow();
  });
});
