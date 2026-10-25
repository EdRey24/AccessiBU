#!/usr/bin/env node
/**
 * Starts the API and the web app together, in one terminal.
 *
 *   node scripts/dev.mjs                 start both, open the web app
 *   node scripts/dev.mjs --no-browser    start both, do not open a browser
 *   node scripts/dev.mjs --phone         start both for a phone running Expo Go
 *   node scripts/dev.mjs --no-backend    start only the web app
 *   node scripts/dev.mjs --no-frontend   start only the API
 *
 * --phone starts Expo in Expo Go mode and points the app at this computer's
 * network address instead of localhost, which on a phone means the phone
 * itself. The phone must be on the same Wi-Fi, and the firewall must allow the
 * API port. EXPO_PUBLIC_API_URL from the environment is used if you set it.
 *
 * Environment:
 *   API_PORT   port for the API (default 8000). EXPO_PUBLIC_API_URL in
 *              frontend/.env must point at the same port.
 *
 * API output is shown with an [api] prefix. The web app keeps the terminal,
 * so Expo's keys (r to reload, w for web) still work. Press Ctrl+C once to
 * stop both. If either one exits, the other is stopped too.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const isWindows = process.platform === 'win32';

const flags = new Set(process.argv.slice(2));
const startBackend = !flags.has('--no-backend');
const startFrontend = !flags.has('--no-frontend');
const openBrowser = !flags.has('--no-browser');
const forPhone = flags.has('--phone');
const apiPort = Number(process.env.API_PORT ?? 8000);

const paint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const tag = {
  dev: paint('1;35', '[dev]'),
  api: paint('36', '[api]'),
};
const say = (message) => console.log(`${tag.dev} ${message}`);

for (const flag of flags) {
  if (!['--no-browser', '--no-backend', '--no-frontend', '--phone'].includes(flag)) {
    console.error(`${tag.dev} Unknown option ${flag}. See the top of scripts/dev.mjs.`);
    process.exit(2);
  }
}
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
  console.error(`${tag.dev} API_PORT must be a port number, not "${process.env.API_PORT}".`);
  process.exit(2);
}
if (!startBackend && !startFrontend) {
  console.error(`${tag.dev} Nothing to start.`);
  process.exit(2);
}

/** This computer's address on the local network, or null if it has none. */
function lanAddress() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    // Virtual adapters (WSL, Docker, VPNs) are not reachable from a phone.
    if (/vethernet|wsl|docker|virtualbox|vmware|vpn|loopback|tailscale|hyper-v/i.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address);
    }
  }
  const home = (ip) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return found.find(home) ?? found[0] ?? null;
}

/** Resolves true when something already accepts connections on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function pythonPath() {
  const venv = isWindows
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : null;
}

/** Checks everything both servers need. Returns false if one cannot start. */
async function preflight() {
  let ok = true;

  if (startBackend) {
    if (!pythonPath()) {
      console.error(
        `${tag.dev} backend/.venv was not found. Create it once:\n` +
          `       cd backend\n` +
          `       python -m venv .venv\n` +
          `       ${isWindows ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -e ".[dev]"`
      );
      ok = false;
    }
    if (!existsSync(path.join(backendDir, '.env'))) {
      say('Warning: backend/.env is missing. Copy backend/.env.example and fill it in.');
    }
    if (await portInUse(apiPort)) {
      console.error(
        `${tag.dev} Port ${apiPort} is already in use. An old API is probably still running.\n` +
          `       Stop it, or pick another port with API_PORT (and update frontend/.env).`
      );
      ok = false;
    }
  }

  if (startFrontend) {
    if (!existsSync(path.join(frontendDir, 'node_modules'))) {
      say('frontend/node_modules is missing, running npm install first...');
      const install = spawnSync('npm', ['install'], {
        cwd: frontendDir,
        stdio: 'inherit',
        shell: isWindows,
      });
      if (install.status !== 0) {
        console.error(`${tag.dev} npm install failed.`);
        ok = false;
      }
    }
    if (!existsSync(path.join(frontendDir, '.env'))) {
      say('Warning: frontend/.env is missing. Copy frontend/.env.example and set EXPO_PUBLIC_API_URL.');
    }
  }

  return ok;
}

const children = [];
let stopping = false;
let exitCode = 0;

/** Stops a child and everything it started (uvicorn --reload starts a worker). */
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(child.detachedGroup ? -child.pid : child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

function stopAll(reason) {
  if (stopping) return;
  stopping = true;
  if (reason) say(reason);
  for (const child of children) kill(child);
  // Give the children a moment to go, then leave.
  setTimeout(() => process.exit(exitCode), 400).unref();
}

function watch(child, name) {
  children.push(child);
  child.once('error', (error) => {
    console.error(`${tag.dev} Could not start the ${name}: ${error.message}`);
    exitCode = 1;
    stopAll();
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    if (code) exitCode = code;
    stopAll(`The ${name} stopped (${signal ?? `exit ${code}`}). Stopping the rest.`);
  });
}

function runApi() {
  const child = spawn(
    pythonPath(),
    ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(apiPort), '--reload'],
    {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWindows,
    }
  );
  child.detachedGroup = !isWindows;
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on('line', (line) => {
      console.log(`${tag.api} ${line}`);
    });
  }
  watch(child, 'API');
}

function runWeb() {
  const env = { ...process.env };
  let script = openBrowser ? 'web' : 'start';

  if (forPhone) {
    script = 'go';
    if (!env.EXPO_PUBLIC_API_URL) {
      const address = lanAddress();
      if (address) {
        env.EXPO_PUBLIC_API_URL = `http://${address}:${apiPort}`;
        say(`Phone mode: the app will call the API at ${env.EXPO_PUBLIC_API_URL}`);
      } else {
        say(
          'Phone mode: no network address found. Connect to Wi-Fi, or set EXPO_PUBLIC_API_URL ' +
            'to an address the phone can reach. localhost will not work on a phone.'
        );
      }
    }
    say(
      `If sign-in fails on the phone, allow inbound TCP port ${apiPort} in the firewall ` +
        'and make sure the phone is on the same Wi-Fi.'
    );
  }

  const child = spawn('npm', ['run', script], {
    cwd: frontendDir,
    stdio: 'inherit',
    shell: isWindows,
    env,
  });
  watch(child, 'web app');
}

process.on('SIGINT', () => stopAll('Stopping...'));
process.on('SIGTERM', () => stopAll('Stopping...'));
process.on('exit', () => {
  for (const child of children) kill(child);
});

if (!(await preflight())) process.exit(1);

say(`Starting${startBackend ? ` the API on http://localhost:${apiPort}` : ''}${
  startBackend && startFrontend ? ' and' : ''
}${startFrontend ? ' the web app' : ''}. Press Ctrl+C to stop.`);
if (startBackend) runApi();
if (startFrontend) runWeb();
