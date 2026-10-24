#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--json')) {
  console.error('Usage: node scripts/preflight.mjs [--json]');
  process.exit(2);
}

function command(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  return { available: result.status === 0, output: result.stdout?.trim() ?? '' };
}

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeSupported = major >= 26 || (major === 24 && minor >= 11)
  || (major === 22 && minor >= 19);
const configHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const configPath = join(configHome, 'config.toml');
let configReadable = false;
let reaRegistrationDetected = false;
try {
  const config = readFileSync(configPath, 'utf8');
  configReadable = true;
  // Detect the normal setup table only; this is not a TOML parser or MCP handshake.
  reaRegistrationDetected = /^\s*\[\s*mcp_servers\.(?:rea|"rea"|'rea')\s*\]\s*(?:#.*)?$/m.test(config);
} catch {
  // A missing/unreadable config does not justify creating or replacing one.
}

const requiredFiles = [
  'AGENTS.md', 'README.md', '.gitignore',
  'docs/PRD.md', 'docs/REVERSE_ENGINEERING_PLAYBOOK.md',
  'docs/research/research-index.md', 'docs/research/permissions.md',
  'docs/research/feature-matrix.md', 'docs/research/scenarios.md',
  'docs/research/observation-template.md', 'docs/research/acceptance-plan.md',
  'docs/research/preparation-status.md',
  'docs/research/m0-closeout.md',
  'docs/research/public-observations/README.md',
  'docs/research/decisions/README.md',
];
const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
const git = command('git', ['--version']);
const privateTracked = command('git', ['ls-files', '--', '.private-research']);
const privateIgnored = command('git', ['check-ignore', '--no-index', '.private-research/preflight-probe']);
const npm = command('npm', ['--version']);
const pnpm = command('pnpm', ['--version']);
const chromeInstalled = [
  '/Applications/Google Chrome.app',
  join(homedir(), 'Applications/Google Chrome.app'),
].some(existsSync);
const readyForSetupPreview = process.platform === 'darwin' && nodeSupported
  && npm.available && git.available && missingFiles.length === 0
  && privateTracked.available && privateTracked.output === '' && privateIgnored.available;
const report = {
  checkedAt: new Date().toISOString(),
  root,
  platform: process.platform,
  architecture: process.arch,
  node: { version: process.version, executable: process.execPath, reaSupported: nodeSupported },
  npm,
  pnpm,
  git,
  chromeInstalled,
  codex: {
    configPath, configReadable, reaRegistrationDetected,
    detectionLimit: 'Normal TOML table detection only; live tool connection must be verified in Codex.',
    sessionConnection: 'not checked by this script',
  },
  research: {
    privateDirectoryExists: existsSync(join(root, '.private-research')),
    privateDirectoryIgnored: privateIgnored.available,
    privateTrackingCheckSucceeded: privateTracked.available,
    privateFilesTracked: privateTracked.available ? privateTracked.output !== '' : null,
    missingFiles,
    targetAuthorization: 'not checked by this script; see docs/research/permissions.md',
  },
  readyForSetupPreview,
  m0Complete: null,
  m0Assessment: 'not checked by this script; see docs/research/m0-closeout.md',
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`FlowForge preflight | ${report.checkedAt}`);
  console.log(`Node ${process.version} (${nodeSupported ? 'REA compatible' : 'unsupported'}) | ${process.execPath}`);
  console.log(`npm: ${npm.output || 'missing'} | pnpm: ${pnpm.output || 'missing'}`);
  console.log(`Chrome: ${chromeInstalled ? 'installed' : 'not found'} | REA registration detected: ${reaRegistrationDetected}`);
  console.log(`Private research: ignored=${privateIgnored.available}, tracked=${report.research.privateFilesTracked}`);
  console.log(`Preparation files: ${missingFiles.length ? `missing ${missingFiles.join(', ')}` : 'present'}`);
  console.log(`Ready to request setup preview: ${readyForSetupPreview}`);
  console.log('Live REA connection / target authorization / M0 observations: not verified by this script.');
}
process.exitCode = readyForSetupPreview ? 0 : 1;
