import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type BaseFixtures = {
  serverUrl: string;
};

const serverInfoPath = join(process.cwd(), 'test-results', 'retrobox-server.json');
let serverProcess: ChildProcess | null = null;
let serverUrl = '';

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

function loadServerInfo(): { url?: string } {
  if (!existsSync(serverInfoPath)) return {};
  try {
    return JSON.parse(readFileSync(serverInfoPath, 'utf-8'));
  } catch {
    return {};
  }
}

export const test = base.extend<BaseFixtures>({
  serverUrl: [
    async ({}, use) => {
      if (process.env.RETROBOX_URL) {
        await use(process.env.RETROBOX_URL);
        return;
      }

      if (!serverUrl) {
        const info = loadServerInfo();
        if (info.url) {
          serverUrl = info.url;
        }
      }

      let startedHere = false;
      if (!serverUrl) {
        const port = Number(process.env.RETROBOX_PORT || 3333);
        serverUrl = `http://localhost:${port}`;

        serverProcess = spawn('bun', ['run', 'server.ts'], {
          cwd: process.cwd(),
          env: { ...process.env, PORT: String(port) },
          stdio: 'pipe',
        });

        startedHere = true;
        await waitForServerReady(serverProcess);
      }

      try {
        await use(serverUrl);
      } finally {
        if (startedHere && serverProcess) {
          serverProcess.kill('SIGTERM');
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              serverProcess?.kill('SIGKILL');
              resolve();
            }, 5000);
            serverProcess.on('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
          serverProcess = null;
          serverUrl = '';
        }
      }
    },
    { scope: 'worker' },
  ],
});
