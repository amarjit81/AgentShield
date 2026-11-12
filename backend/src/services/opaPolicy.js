import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadPolicy } from '@open-policy-agent/opa-wasm';

export class PolicyUnavailableError extends Error {
  constructor(message, options) { super(message, options); this.name = 'PolicyUnavailableError'; }
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function loadRefundEvaluator(directory) { return loadPolicyEvaluator('refund', directory); }

export async function loadPolicyEvaluator(name, directory = new URL('../../policies/', import.meta.url)) {
  try {
    if (!['refund', 'email', 'sandbox'].includes(name)) throw new Error('Unsupported policy name.');
    const [source, wasm, manifestText] = await Promise.all([
      readFile(new URL(`${name}.rego`, directory)), readFile(new URL(`${name}.wasm`, directory)),
      readFile(new URL(`${name}.manifest.json`, directory), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText);
    if (manifest.engine !== 'opa' || manifest.revision !== 'r1'
      || manifest.entrypoint !== `agentshield/${name}/decision`
      || manifest.sourceSha256 !== hash(source.toString().replace(/\r\n/g, '\n')) || manifest.wasmSha256 !== hash(wasm)) {
      throw new Error('Policy assets do not match. Run npm run policy:build.');
    }
    const loaded = await loadPolicy(wasm);
    const entrypoint = loaded.entrypoints[manifest.entrypoint];
    if (!Number.isInteger(entrypoint)) throw new Error('Policy entrypoint is missing.');
    return {
      revision: manifest.revision, wasmSha256: manifest.wasmSha256,
      evaluate(input) {
        try {
          const results = loaded.evaluate(input, entrypoint);
          if (!Array.isArray(results) || results.length !== 1
            || !['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'].includes(results[0]?.result)) {
            throw new Error('OPA returned an undefined or invalid decision.');
          }
          return results[0].result;
        } catch (cause) {
          throw new PolicyUnavailableError(`${name} policy evaluation failed.`, { cause });
        }
      },
    };
  } catch (cause) {
    throw new PolicyUnavailableError(`Unable to load the OPA ${name} policy.`, { cause });
  }
}
