import type { FullConfig } from '@playwright/test';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const serverInfoPath = join(process.cwd(), 'test-results', 'retrobox-server.json');

async function globalTeardown(_config: FullConfig) {
  if (process.env.RETROBOX_URL) return;
  if (!existsSync(serverInfoPath)) return;

  let pid: number | undefined;
  try {
    const info = JSON.parse(readFileSync(serverInfoPath, 'utf-8'));
    pid = info.pid;
  } catch {
    pid = undefined;
  }

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          process.kill(pid!, 'SIGKILL');
        } catch {}
        resolve();
      }, 5000);

      const check = () => {
        try {
          process.kill(pid!, 0);
          setTimeout(check, 200);
        } catch {
          clearTimeout(timeout);
          resolve();
        }
      };

      check();
    });
  }

  try {
    unlinkSync(serverInfoPath);
  } catch {}
}

export default globalTeardown;
