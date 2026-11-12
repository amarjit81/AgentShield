import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sdk from '@open-policy-agent/opa-wasm';
import { evaluateRefundPolicy } from '../src/services/policyService.js';
import { loadRefundEvaluator, PolicyUnavailableError } from '../src/services/opaPolicy.js';

vi.mock('@open-policy-agent/opa-wasm', { spy: true });

afterEach(() => vi.restoreAllMocks());

describe('Real embedded OPA refund policy', () => {
  it.each([
    [0.01, 'ALLOW', 'AUTHORIZED'], [5000, 'ALLOW', 'AUTHORIZED'],
    [5000.01, 'REQUIRE_APPROVAL', 'PENDING_APPROVAL'],
    [20000, 'REQUIRE_APPROVAL', 'PENDING_APPROVAL'], [20000.01, 'BLOCK', 'BLOCKED'],
  ])('evaluates the default boundary %s through Wasm', (amount, decision, status) => {
    expect(evaluateRefundPolicy(amount)).toMatchObject({
      decision, status, policyEngine: 'opa', policyVersion: 'opa-refund-r1-v1',
      policy: { autoApproveLimit: 5000, maxAllowedRefund: 20000 },
    });
  });

  it('uses each request’s current settings without sharing mutable data', () => {
    const custom = { autoApproveLimit: 10000, maxAllowedRefund: 25000, version: 3 };
    expect(evaluateRefundPolicy(8000, custom)).toMatchObject({ decision: 'ALLOW', policyVersion: 'opa-refund-r1-v3' });
    expect(evaluateRefundPolicy(8000).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateRefundPolicy(25000, custom).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateRefundPolicy(25001, custom).decision).toBe('BLOCK');
    expect(evaluateRefundPolicy(1, { autoApproveLimit: 0, maxAllowedRefund: 1, version: 1 }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateRefundPolicy(1, { autoApproveLimit: 1, maxAllowedRefund: 1, version: 1 }).decision).toBe('ALLOW');
  });

  it.each([0, -1, NaN, Infinity, '100'])('rejects invalid amount %s before evaluation', amount => {
    expect(() => evaluateRefundPolicy(amount)).toThrow(PolicyUnavailableError);
  });

  it.each([
    { autoApproveLimit: -1, maxAllowedRefund: 20, version: 1 },
    { autoApproveLimit: 30, maxAllowedRefund: 20, version: 1 },
    { autoApproveLimit: 1.5, maxAllowedRefund: 20, version: 1 },
    { autoApproveLimit: 0, maxAllowedRefund: 0, version: 1 },
    { autoApproveLimit: 0, maxAllowedRefund: 1000000001, version: 1 },
    { autoApproveLimit: 0, maxAllowedRefund: 20, version: 0 },
  ])('fails closed for invalid settings %j', limits => {
    expect(() => evaluateRefundPolicy(1, limits)).toThrow(PolicyUnavailableError);
  });

  it.each([{}, { action: 'EMAIL' }, { action: 'REFUND', currency: 'USD', amount: 1, limits: { autoApproveLimit: 5, maxAllowedRefund: 20 } },
    { action: 'REFUND', currency: 'INR', amount: -1, limits: { autoApproveLimit: 5, maxAllowedRefund: 20 } }])(
    'Rego itself defaults to BLOCK for unsupported or malformed input %j', async input => {
      expect((await loadRefundEvaluator()).evaluate(input)).toBe('BLOCK');
    },
  );

  it.each(['refund.rego', 'refund.wasm', 'refund.manifest.json'])('rejects changed asset %s at startup', async changed => {
    const directory = await mkdtemp(join(tmpdir(), 'agentshield-policy-test-'));
    try {
      for (const name of ['refund.rego', 'refund.wasm', 'refund.manifest.json']) {
        await copyFile(new URL(`../policies/${name}`, import.meta.url), join(directory, name));
      }
      await writeFile(join(directory, changed), 'invalid content');
      await expect(loadRefundEvaluator(pathToFileURL(directory + '/'))).rejects.toThrow(PolicyUnavailableError);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each([{ results: [] }, { results: [{ result: 'UNKNOWN' }] }, { results: [{ result: 'ALLOW' }, { result: 'BLOCK' }] }])('rejects undefined/invalid engine results %j', async ({ results }) => {
    vi.mocked(sdk.loadPolicy).mockResolvedValueOnce({
      entrypoints: { 'agentshield/refund/decision': 0 }, evaluate: () => results,
    });
    const evaluator = await loadRefundEvaluator();
    expect(() => evaluator.evaluate({})).toThrow(PolicyUnavailableError);
  });
});
