/**
 * 开发启动：先起 vite，探活后再拉起 electron。不引 concurrently / wait-on。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const PORT = 15173;
const HOST = '127.0.0.1';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: HOST }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(PORT)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const shutdown = () => {
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (await waitForServer()) {
  const electron = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: `http://${HOST}:${PORT}` },
    shell: process.platform === 'win32',
  });
  electron.on('exit', (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} else {
  process.stderr.write('dev server 未能在 30s 内启动\n');
  shutdown();
}
