import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = process.env.OPA_BINARY || 'opa';
const temporary = await mkdtemp(join(tmpdir(), 'agentshield-policy-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const compiler = execFileSync(executable, ['version'], { encoding: 'utf8' });
  if (!/^Version: 1\.21\.1\r?$/m.test(compiler)) throw new Error('Use OPA 1.21.1 to reproduce this policy build.');
  for (const name of ['refund', 'email', 'sandbox']) {
    execFileSync(executable, ['check', '--strict', join(root, `policies/${name}.rego`)], { stdio: 'inherit' });
    execFileSync(executable, ['build', '-t', 'wasm', '-e', `agentshield/${name}/decision`,
      '-o', join(temporary, 'bundle.tar.gz'), join(root, `policies/${name}.rego`)], { stdio: 'inherit' });
    // OPA creates a tar.gz bundle; only the compiled policy is needed at runtime.
    execFileSync('tar', ['-xzf', join(temporary, 'bundle.tar.gz'), '-C', temporary], { stdio: 'inherit' });
    const source = await readFile(join(root, `policies/${name}.rego`));
    const wasm = await readFile(join(temporary, 'policy.wasm'));
    await writeFile(join(root, `policies/${name}.wasm`), wasm);
    await writeFile(join(root, `policies/${name}.manifest.json`), JSON.stringify({
      engine: 'opa', compilerVersion: '1.21.1', revision: 'r1',
      entrypoint: `agentshield/${name}/decision`, sourceSha256: sha256(source.toString().replace(/\r\n/g, '\n')), wasmSha256: sha256(wasm),
    }, null, 2) + '\n');
    console.log(`Built and fingerprinted OPA ${name} policy. Restart the backend to load it.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
