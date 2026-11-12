import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionRequestSchema, executionSchema } from '../src/schemas/actionSchema.js';
import { evaluateSandboxPolicy } from '../src/services/sandboxPolicyService.js';
import { loadPolicyEvaluator, PolicyUnavailableError } from '../src/services/opaPolicy.js';
import { simulateSandboxFile } from '../src/services/sandboxSimulator.js';
import * as sdk from '@open-policy-agent/opa-wasm';

vi.mock('@open-policy-agent/opa-wasm', { spy: true });
afterEach(() => vi.restoreAllMocks());
const action = (target = 'workspace/notes.txt', operation = 'READ') => ({ agentId: 'Sandbox-Agent', action: 'SANDBOX_FILE', target,
  arguments: { operation, ...(['WRITE', 'CHANGE'].includes(operation) ? { content: 'Hello\nWorld' } : {}) } });

describe('Sandbox validation and real OPA policy', () => {
  it.each([
    ['workspace/notes.txt', 'READ', 'ALLOW'], ['workspace/reports/notes.txt', 'WRITE', 'ALLOW'],
    ['workspace/notes.txt', 'DELETE', 'REQUIRE_APPROVAL'],
    ['workspace/notes.txt', 'CHANGE', 'REQUIRE_APPROVAL'],
    ['workspace/protected/config.txt', 'READ', 'BLOCK'], ['workspace/protected', 'WRITE', 'BLOCK'],
    ['workspace/protected/config.txt', 'DELETE', 'BLOCK'], ['outside/notes.txt', 'READ', 'BLOCK'],
    ['workspace/protected/config.txt', 'CHANGE', 'BLOCK'],
    ['workspace-evil/notes.txt', 'WRITE', 'BLOCK'], ['workspace', 'READ', 'BLOCK'],
    ['workspace/protected-copy.txt', 'READ', 'ALLOW'],
  ])('%s %s gives %s', (target, operation, decision) => {
    expect(evaluateSandboxPolicy(action(target, operation))).toMatchObject({ decision, policyEngine: 'opa', policyVersion: 'opa-sandbox-r1-v2' });
  });

  it.each(['../secret.txt', 'workspace/../secret.txt', '/workspace/a.txt', 'C:/file.txt', 'workspace\\notes.txt',
    'workspace//a.txt', 'workspace/./a.txt', 'workspace/.env', 'workspace/a.txt/', 'workspace/a%2ftxt',
    'workspace/a:b', 'workspace/UPPER.txt', 'workspace/a\u0000.txt', ' workspace/a.txt', 'workspace/a.txt ', ''])('rejects ambiguous or unsafe path %j', target => {
    expect(actionRequestSchema.safeParse(action(target)).success).toBe(false);
    expect(executionSchema.safeParse(action(target)).success).toBe(false);
    expect(() => evaluateSandboxPolicy(action(target))).toThrow(PolicyUnavailableError);
  });

  it('enforces exact operation shapes and UTF-8 byte limits, preserving write text', () => {
    const write = action(undefined, 'WRITE');
    write.arguments.content = '  text\r\n<script>alert(1)</script>  ';
    expect(actionRequestSchema.parse(write)).toEqual(write);
    for (const args of [{ operation: 'EXECUTE' }, { operation: 'WRITE' }, { operation: 'READ', content: 'extra' },
      { operation: 'DELETE', recursive: true }, { operation: 'WRITE', content: '💚'.repeat(2001) }, { operation: 'WRITE', content: '\u0000' }]) {
      expect(actionRequestSchema.safeParse({ ...write, arguments: args }).success).toBe(false);
    }
    expect(actionRequestSchema.safeParse({ ...write, arguments: { operation: 'WRITE', content: '💚'.repeat(2000) } }).success).toBe(true);
    expect(actionRequestSchema.safeParse({ ...write, arguments: { operation: 'WRITE', content: '' } }).success).toBe(true);
    expect(actionRequestSchema.safeParse({ ...write, ownerId: 'injected' }).success).toBe(false);
  });

  it('defaults malformed OPA input to BLOCK and fails closed on engine errors', async () => {
    const evaluator = await loadPolicyEvaluator('sandbox');
    for (const input of [{}, { action: 'SANDBOX_FILE', operation: 'READ', target: 'workspace/../secret' },
      { action: 'SANDBOX_FILE', operation: 'EXECUTE', target: 'workspace/a.txt' }]) expect(evaluator.evaluate(input)).toBe('BLOCK');
    vi.spyOn(sdk, 'loadPolicy').mockRejectedValue(new Error('Unavailable'));
    await expect(loadPolicyEvaluator('sandbox')).rejects.toThrow(PolicyUnavailableError);
  });

  it('returns independent snapshots and pure receipts without claiming file effects', () => {
    const first = evaluateSandboxPolicy(action());
    first.policy.allowedPaths.length = 0;
    expect(evaluateSandboxPolicy(action()).policy.allowedPaths).toEqual(['workspace/']);
    const receipt = simulateSandboxFile(action(undefined, 'WRITE'));
    expect(receipt).toMatchObject({ simulator: 'SANDBOX_FILE', simulated: true, filesystemAccessed: false, operation: 'WRITE', contentBytes: 11 });
    expect(receipt.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(simulateSandboxFile(action()).receiptId).not.toBe(receipt.receiptId);
    expect(() => simulateSandboxFile(action('outside/file.txt'))).toThrow();
  });

  it('applies custom path, operation and content-size settings without weakening the hard boundary', () => {
    const settings = { version: 5, allowedPaths: ['workspace/reports/'], protectedPaths: ['workspace/reports/private/'],
      operationActions: { READ: 'BLOCK', WRITE: 'REQUIRE_APPROVAL', CHANGE: 'ALLOW', DELETE: 'BLOCK' }, maxContentBytes: 5 };
    expect(evaluateSandboxPolicy(action('workspace/reports/new.txt', 'WRITE'), settings)).toMatchObject({ decision: 'BLOCK', policyVersion: 'opa-sandbox-r1-v5' });
    const shortWrite = action('workspace/reports/new.txt', 'WRITE'); shortWrite.arguments.content = 'hello';
    expect(evaluateSandboxPolicy(shortWrite, settings).decision).toBe('REQUIRE_APPROVAL');
    const change = action('workspace/reports/current.txt', 'CHANGE'); change.arguments.content = 'hello';
    expect(evaluateSandboxPolicy(change, settings).decision).toBe('ALLOW');
    expect(evaluateSandboxPolicy(action('workspace/notes.txt', 'READ'), settings).decision).toBe('BLOCK');
    expect(evaluateSandboxPolicy(action('workspace/reports/private/key.txt', 'READ'), settings).decision).toBe('BLOCK');
    expect(evaluateSandboxPolicy(action('workspace/protected/config.txt', 'READ'), { ...settings, allowedPaths: ['workspace/'] }).decision).toBe('BLOCK');
  });
});
