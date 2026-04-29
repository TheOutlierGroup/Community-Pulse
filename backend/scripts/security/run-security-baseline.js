import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const backendDir = path.resolve(repoRoot, 'backend');
const frontendDir = path.resolve(repoRoot, 'frontend');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function resolveResultsDir() {
  const explicit = String(process.env.SECURITY_RESULTS_DIR || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  }
  return path.resolve(repoRoot, `docs/security-results-${todayIso()}`);
}

function runCommand({ command, cwd }) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout || ''}${result.stderr || ''}`.trimEnd(),
  };
}

async function writeLog(resultsDir, filename, content) {
  const target = path.join(resultsDir, filename);
  await fs.writeFile(target, `${content}\n`, 'utf8');
}

async function main() {
  const resultsDir = resolveResultsDir();
  await fs.mkdir(resultsDir, { recursive: true });

  console.log('Security baseline runner');
  console.log(`Results dir: ${path.relative(repoRoot, resultsDir)}`);
  console.log('');

  const checks = [
    {
      key: 'backend-auth-token-tests',
      command:
        'node --test src/middleware/auth.test.js src/security/inviteToken.test.js src/services/reportDownloadToken.test.js src/routes/reports.test.js',
      cwd: backendDir,
      required: true,
    },
    {
      key: 'invalid-token-e2e',
      command: 'npm run test:e2e -- e2e/smoke-and-a11y.spec.js --grep "invalid token"',
      cwd: frontendDir,
      required: true,
    },
    {
      key: 'backend-audit',
      command: 'npm audit --omit=dev',
      cwd: backendDir,
      required: false,
    },
    {
      key: 'frontend-audit',
      command: 'npm audit --omit=dev',
      cwd: frontendDir,
      required: false,
    },
    {
      key: 'security-abuse-baseline',
      command: 'npm run security:abuse-baseline',
      cwd: backendDir,
      required: true,
    },
    {
      key: 'security-idor-privilege-smoke',
      command: 'npm run security:idor-privilege-smoke',
      cwd: backendDir,
      required: true,
    },
    {
      key: 'security-token-input-smoke',
      command: 'npm run security:token-input-smoke',
      cwd: backendDir,
      required: true,
    },
  ];

  let failedRequired = 0;
  for (const check of checks) {
    console.log(`> ${check.key}`);
    const result = runCommand({ command: check.command, cwd: check.cwd });
    await writeLog(resultsDir, `${check.key}.log`, result.output);

    const passed = result.exitCode === 0;
    const status = passed ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    if (!passed && check.required) failedRequired += 1;
    console.log(`  ${status} (exit=${result.exitCode}) -> ${check.key}.log`);
  }

  console.log('');
  if (failedRequired > 0) {
    console.error(`Completed with ${failedRequired} required check failure(s).`);
    process.exit(1);
  }
  console.log('Completed. Required baseline checks passed.');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
