import { copyFile, mkdtemp, mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('Local Gmail setup helper', () => {
  it.each(['abcdefghijklmnop', 'invalid'])('handles a hidden %s password without exposing it or replacing unrelated settings', async password => {
    const directory = await mkdtemp(join(tmpdir(), 'agentshield-gmail-'));
    const scripts = join(directory, 'scripts');
    await mkdir(scripts);
    const helper = join(scripts, 'configure-gmail.ps1');
    const envFile = join(directory, '.env');
    const harness = join(directory, 'run.ps1');
    const original = 'DATABASE_URL="keep-database"\r\nJWT_SECRET="keep-jwt"\r\nSMTP_PASSWORD="replace-old"\r\nEMAIL_DELIVERY_MODE="SIMULATED"\r\n';
    await copyFile(new URL('../scripts/configure-gmail.ps1', import.meta.url), helper);
    await writeFile(envFile, original);
    await writeFile(harness, `function global:Read-Host {\nparam([string]$Prompt, [switch]$AsSecureString)\nif ($AsSecureString) {\n$secure = [System.Security.SecureString]::new()\nforeach ($character in $env:AGENTSHIELD_FIXTURE_PASSWORD.ToCharArray()) { $secure.AppendChar($character) }\nreturn $secure\n}\nif ($Prompt -eq 'Gmail sender address') { return 'sender@gmail.com' }\nreturn 'inbox@gmail.com'\n}\n& (Join-Path $PSScriptRoot 'scripts/configure-gmail.ps1')\n`);
    try {
      const outcome = await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { windowsHide: true, env: { ...process.env, AGENTSHIELD_FIXTURE_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
        child.once('error', reject); child.once('close', code => resolve({ code, output }));
      });
      const content = await readFile(envFile, 'utf8');
      expect(outcome.output).not.toContain(password);
      if (password === 'invalid') { expect(outcome.code).not.toBe(0); expect(content).toBe(original); }
      else {
        expect(outcome.code, outcome.output).toBe(0);
        expect(content).toContain('DATABASE_URL="keep-database"'); expect(content).toContain('JWT_SECRET="keep-jwt"');
        expect(content).toContain('SMTP_PASSWORD="abcdefghijklmnop"'); expect(content).toContain('EMAIL_ALLOWED_RECIPIENTS="inbox@gmail.com"');
        expect(content).toContain('EMAIL_DELIVERY_MODE="SMTP"'); expect(content).not.toContain('replace-old');
        expect(content.match(/^SMTP_PASSWORD=/gm)).toHaveLength(1);
      }
    } finally {
      await unlink(helper); await unlink(envFile); await unlink(harness); await rmdir(scripts); await rmdir(directory);
    }
  });
});
