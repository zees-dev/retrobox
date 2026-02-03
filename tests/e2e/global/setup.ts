import type { FullConfig } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const serverInfoPath = join(process.cwd(), 'test-results', 'retrobox-server.json');

async function waitForServerReady(proc: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 20000);

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('Local:') || output.includes('Network:')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) console.error('[server:err]', output);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

async function globalSetup(_config: FullConfig) {
  mkdirSync('test-results/screenshots', { recursive: true });
  mkdirSync('test-results/traces', { recursive: true });
  mkdirSync('test-results/videos', { recursive: true });

  if (process.env.RETROBOX_URL) {
    console.log('Using external server:', process.env.RETROBOX_URL);
    return;
  }

  const port = Number(process.env.RETROBOX_PORT || 3333);
  const serverUrl = `http://localhost:${port}`;

  console.log('Starting RetroBox server...');

  const serverProcess = spawn('bun', ['run', 'server.ts'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, PORT: String(port) },
  });

  await waitForServerReady(serverProcess);

  writeFileSync(
    serverInfoPath,
    JSON.stringify({ url: serverUrl, pid: serverProcess.pid }, null, 2),
    'utf-8'
  );

  console.log('Server started:', serverUrl);
}

export default globalSetup;
