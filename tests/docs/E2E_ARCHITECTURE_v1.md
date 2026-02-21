# RetroBox E2E Testing Architecture

> **Version:** 1.0.0-draft  
> **Author:** Kiosk (AI Assistant)  
> **Date:** 2026-02-03  
> **Status:** Initial Design

---

## Overview

This document specifies the end-to-end (E2E) testing architecture for RetroBox. The goal is to validate the complete user flow from screen initialization through controller connections, game loading, and gameplay interactions.

### Key Requirements

1. **Multi-browser coordination** — Simulate screen + multiple controllers as separate browser contexts
2. **Visual validation** — Screenshot capture at key states for regression testing
3. **Error detection** — Capture and validate console logs across all contexts
4. **Extensibility** — Easy to add new test scenarios without boilerplate
5. **CI/CD ready** — Headless execution with artifacts (screenshots, videos, logs)

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Test Framework | **Playwright** | Multi-browser, multi-context, built-in screenshots/video, TypeScript native |
| Test Runner | **Playwright Test** | Parallel execution, fixtures, HTML reporter |
| Assertions | **Playwright + custom matchers** | Visual comparisons, DOM state, console logs |
| Runtime | **Bun** | Consistent with server.ts, fast execution |

### Why Playwright?

- **Multiple browser contexts** — Can open screen + 4 controllers in isolated contexts within one test
- **Cross-browser** — Chromium, Firefox, WebKit
- **Network interception** — Can mock/validate WebSocket messages
- **Visual testing** — Built-in screenshot comparison
- **Trace viewer** — Debug failed tests with timeline, network, console

---

## Directory Structure

```
retrobox/
├── tests/
│   ├── e2e/
│   │   ├── fixtures/
│   │   │   ├── retrobox.fixture.ts    # Core fixtures (screen, controllers)
│   │   │   ├── game.fixture.ts        # Game loading fixtures
│   │   │   └── index.ts               # Export all fixtures
│   │   │
│   │   ├── pages/
│   │   │   ├── screen.page.ts         # Screen page object
│   │   │   ├── controller.page.ts     # Controller page object
│   │   │   └── game-menu.page.ts      # Game menu component object
│   │   │
│   │   ├── specs/
│   │   │   ├── connection.spec.ts     # Controller connection tests
│   │   │   ├── game-launch.spec.ts    # Game start/load tests
│   │   │   ├── save-state.spec.ts     # Save/load state tests
│   │   │   ├── multiplayer.spec.ts    # Multi-controller tests
│   │   │   └── error-free.spec.ts     # Console error validation
│   │   │
│   │   ├── helpers/
│   │   │   ├── wait-for.ts            # Custom wait utilities
│   │   │   ├── screenshot.ts          # Screenshot helpers
│   │   │   └── logs.ts                # Console log capture/validation
│   │   │
│   │   └── global-setup.ts            # Start server before tests
│   │
│   └── playwright.config.ts           # Playwright configuration
│
├── docs/testing/
│   ├── E2E_ARCHITECTURE.md            # This document
│   └── WRITING_TESTS.md               # Guide for adding new tests
│
└── package.json                        # Dependencies
```

---

## Core Abstractions

### 1. Fixtures

Fixtures provide reusable test setup. Playwright's fixture system allows composition.

```typescript
// tests/e2e/fixtures/retrobox.fixture.ts
import { test as base, BrowserContext, Page } from '@playwright/test';

type RetroBoxFixtures = {
  screenContext: BrowserContext;
  screenPage: ScreenPage;
  controllerContext: BrowserContext;
  controller1: ControllerPage;
  controller2: ControllerPage;
  serverUrl: string;
  consoleLogs: Map<string, ConsoleMessage[]>;
};

export const test = base.extend<RetroBoxFixtures>({
  serverUrl: async ({}, use) => {
    // Server assumed running (started by global-setup or externally)
    await use(process.env.RETROBOX_URL || 'http://localhost:3333');
  },

  consoleLogs: async ({}, use) => {
    await use(new Map());
  },

  screenContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    await use(context);
    await context.close();
  },

  screenPage: async ({ screenContext, serverUrl, consoleLogs }, use) => {
    const page = await screenContext.newPage();
    
    // Capture console logs
    const logs: ConsoleMessage[] = [];
    page.on('console', msg => logs.push(msg));
    consoleLogs.set('screen', logs);
    
    await page.goto(serverUrl);
    await use(new ScreenPage(page));
  },

  controllerContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone 14 Pro
      isMobile: true,
      hasTouch: true,
    });
    await use(context);
    await context.close();
  },

  controller1: async ({ controllerContext, screenPage, serverUrl, consoleLogs }, use) => {
    const page = await controllerContext.newPage();
    
    const logs: ConsoleMessage[] = [];
    page.on('console', msg => logs.push(msg));
    consoleLogs.set('controller1', logs);
    
    const controllerUrl = await screenPage.getControllerUrl();
    await page.goto(controllerUrl);
    await use(new ControllerPage(page, 1));
  },

  controller2: async ({ controllerContext, screenPage, serverUrl, consoleLogs }, use) => {
    const page = await controllerContext.newPage();
    
    const logs: ConsoleMessage[] = [];
    page.on('console', msg => logs.push(msg));
    consoleLogs.set('controller2', logs);
    
    const controllerUrl = await screenPage.getControllerUrl();
    await page.goto(controllerUrl);
    await use(new ControllerPage(page, 2));
  },
});
```

### 2. Page Objects

Page objects encapsulate DOM interactions and provide a clean API.

```typescript
// tests/e2e/pages/screen.page.ts
import { Page, Locator } from '@playwright/test';

export class ScreenPage {
  readonly page: Page;
  readonly qrCode: Locator;
  readonly controllerDots: Locator;
  readonly gameContainer: Locator;
  readonly pauseOverlay: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    this.page = page;
    this.qrCode = page.locator('#qrCodeDisplay');
    this.controllerDots = page.locator('.controller-dot');
    this.gameContainer = page.locator('.game-container');
    this.pauseOverlay = page.locator('#pauseOverlay');
    this.status = page.locator('#status');
  }

  async getControllerUrl(): Promise<string> {
    return await this.page.locator('#qrUrl').getAttribute('href') || '';
  }

  async waitForControllerConnected(playerNum: number): Promise<void> {
    await this.controllerDots
      .nth(playerNum - 1)
      .waitFor({ state: 'visible' });
    await expect(this.controllerDots.nth(playerNum - 1))
      .toHaveClass(/active/);
  }

  async waitForGamePlaying(): Promise<void> {
    await this.qrCode.waitFor({ state: 'hidden', timeout: 30000 });
    await this.page.waitForFunction(() => 
      window.EJS_emulator?.started === true
    , { timeout: 30000 });
  }

  async isGamePaused(): Promise<boolean> {
    return await this.pauseOverlay.evaluate(el => 
      el.classList.contains('visible')
    );
  }

  async captureGameScreenshot(name: string): Promise<Buffer> {
    return await this.gameContainer.screenshot({ 
      path: `test-results/screenshots/${name}.png` 
    });
  }
}
```

```typescript
// tests/e2e/pages/controller.page.ts
import { Page, Locator } from '@playwright/test';

export class ControllerPage {
  readonly page: Page;
  readonly playerNum: number;
  readonly statusDot: Locator;
  readonly pingBadge: Locator;
  readonly gameMenu: Locator;

  constructor(page: Page, playerNum: number) {
    this.page = page;
    this.playerNum = playerNum;
    this.statusDot = page.locator('#statusDot');
    this.pingBadge = page.locator('#pingBadge');
    this.gameMenu = page.locator('#gameMenu');
  }

  async waitForConnected(): Promise<void> {
    await this.statusDot.waitFor({ state: 'visible' });
    await expect(this.statusDot).toHaveClass(/connected/);
    await expect(this.statusDot).toHaveClass(new RegExp(`player-${this.playerNum - 1}`));
  }

  async selectGame(gameName: string): Promise<void> {
    await this.gameMenu.locator('#allGamesSelect').selectOption({ label: gameName });
  }

  async clickStart(): Promise<void> {
    await this.gameMenu.locator('#startButton').click();
  }

  async waitForGameControls(): Promise<void> {
    // Wait for EmulatorJS controls to appear
    await this.page.waitForSelector('.ejs_menu_bar', { timeout: 30000 });
  }

  async pressButton(button: string): Promise<void> {
    // Trigger virtual button press via EmulatorJS
    await this.page.evaluate((btn) => {
      window.EJS_emulator?.handler?.exec('input.simulate', {
        button: btn, state: 'pressed', player: 0
      });
    }, button);
  }

  async clickSaveState(): Promise<void> {
    await this.page.locator('[data-btn="remoteSave"]').click();
  }

  async clickLoadState(): Promise<void> {
    await this.page.locator('[data-btn="remoteLoad"]').click();
  }
}
```

### 3. Test Helpers

```typescript
// tests/e2e/helpers/logs.ts
import { ConsoleMessage } from '@playwright/test';

export function hasErrors(logs: ConsoleMessage[]): boolean {
  return logs.some(msg => msg.type() === 'error');
}

export function getErrors(logs: ConsoleMessage[]): string[] {
  return logs
    .filter(msg => msg.type() === 'error')
    .map(msg => msg.text());
}

export function assertNoErrors(
  consoleLogs: Map<string, ConsoleMessage[]>,
  contexts: string[] = ['screen', 'controller1', 'controller2']
): void {
  for (const ctx of contexts) {
    const logs = consoleLogs.get(ctx) || [];
    const errors = getErrors(logs);
    if (errors.length > 0) {
      throw new Error(`Console errors in ${ctx}:\n${errors.join('\n')}`);
    }
  }
}
```

---

## Test Specifications

### Spec 1: Connection Flow

```typescript
// tests/e2e/specs/connection.spec.ts
import { test, expect } from '../fixtures';

test.describe('Controller Connection', () => {
  test('two controllers can connect to screen', async ({
    screenPage,
    controller1,
    controller2,
  }) => {
    // Verify screen shows QR code
    await expect(screenPage.qrCode).toBeVisible();
    await expect(screenPage.status).toContainText('Ready');

    // Controller 1 connects
    await controller1.waitForConnected();
    await screenPage.waitForControllerConnected(1);

    // Controller 2 connects
    await controller2.waitForConnected();
    await screenPage.waitForControllerConnected(2);

    // Verify both dots are active
    await expect(screenPage.controllerDots.nth(0)).toHaveClass(/active.*player-0/);
    await expect(screenPage.controllerDots.nth(1)).toHaveClass(/active.*player-1/);
  });
});
```

### Spec 2: Game Launch

```typescript
// tests/e2e/specs/game-launch.spec.ts
import { test, expect } from '../fixtures';

test.describe('Game Launch', () => {
  test('controller can start game and screen shows gameplay', async ({
    screenPage,
    controller1,
  }) => {
    await controller1.waitForConnected();

    // Select and start a game
    await controller1.selectGame('Mario Kart 64');
    await controller1.clickStart();

    // Wait for game to load on screen
    await screenPage.waitForGamePlaying();

    // Take screenshot for validation
    const screenshot = await screenPage.captureGameScreenshot('mario-kart-loaded');
    expect(screenshot).toBeTruthy();

    // Controller should show game controls
    await controller1.waitForGameControls();
  });

  test('game loading shows progress on both screen and controller', async ({
    screenPage,
    controller1,
  }) => {
    await controller1.waitForConnected();
    await controller1.selectGame('Mario Kart 64');
    await controller1.clickStart();

    // Both should show loading state
    await expect(screenPage.page.locator('.loading-spinner')).toBeVisible();
    await expect(controller1.page.locator('.loading-overlay')).toBeVisible();

    await screenPage.waitForGamePlaying();
  });
});
```

### Spec 3: Save/Load State

```typescript
// tests/e2e/specs/save-state.spec.ts
import { test, expect } from '../fixtures';

test.describe('Save State', () => {
  test.beforeEach(async ({ screenPage, controller1 }) => {
    await controller1.waitForConnected();
    await controller1.selectGame('Super Mario 64');
    await controller1.clickStart();
    await screenPage.waitForGamePlaying();
  });

  test('can save and load state', async ({ screenPage, controller1 }) => {
    // Play for a moment
    await screenPage.page.waitForTimeout(2000);
    
    // Save state
    await controller1.clickSaveState();
    await expect(screenPage.page.locator('.ejs_message'))
      .toContainText(/saved/i, { timeout: 5000 });

    // Take screenshot of current state
    const beforeScreenshot = await screenPage.captureGameScreenshot('before-load');

    // Wait and let game progress
    await screenPage.page.waitForTimeout(3000);

    // Load state
    await controller1.clickLoadState();
    await expect(screenPage.page.locator('.ejs_message'))
      .toContainText(/loaded/i, { timeout: 5000 });

    // Screenshot after load - should visually match before
    const afterScreenshot = await screenPage.captureGameScreenshot('after-load');
    
    // Visual comparison (optional - requires baseline)
    // expect(afterScreenshot).toMatchSnapshot('state-restored.png');
  });
});
```

### Spec 4: Error-Free Execution

```typescript
// tests/e2e/specs/error-free.spec.ts
import { test, expect } from '../fixtures';
import { assertNoErrors, getErrors } from '../helpers/logs';

test.describe('Error-Free Operation', () => {
  test('no console errors during connection', async ({
    screenPage,
    controller1,
    controller2,
    consoleLogs,
  }) => {
    await controller1.waitForConnected();
    await controller2.waitForConnected();

    // Allow time for WebRTC negotiation
    await screenPage.page.waitForTimeout(2000);

    assertNoErrors(consoleLogs);
  });

  test('no console errors during gameplay', async ({
    screenPage,
    controller1,
    consoleLogs,
  }) => {
    await controller1.waitForConnected();
    await controller1.selectGame('Sonic the Hedgehog');
    await controller1.clickStart();
    await screenPage.waitForGamePlaying();

    // Play for 10 seconds
    await screenPage.page.waitForTimeout(10000);

    const errors = getErrors(consoleLogs.get('screen') || []);
    
    // Filter known non-critical errors
    const criticalErrors = errors.filter(e => 
      !e.includes('WakeLock') && 
      !e.includes('SharedArrayBuffer')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});
```

### Spec 5: Multiplayer

```typescript
// tests/e2e/specs/multiplayer.spec.ts
import { test, expect } from '../fixtures';

test.describe('Multiplayer', () => {
  test('second player can join mid-game', async ({
    screenPage,
    controller1,
    controller2,
  }) => {
    await controller1.waitForConnected();
    await controller1.selectGame('Mario Kart 64');
    await controller1.clickStart();
    await screenPage.waitForGamePlaying();

    // P2 connects after game started
    await controller2.waitForConnected();
    await screenPage.waitForControllerConnected(2);

    // Both players visible
    await expect(screenPage.controllerDots.nth(0)).toHaveClass(/active/);
    await expect(screenPage.controllerDots.nth(1)).toHaveClass(/active/);
  });

  test('player reconnection preserves slot', async ({
    screenPage,
    controller1,
    controllerContext,
    serverUrl,
  }) => {
    await controller1.waitForConnected();
    
    // Get controller URL for reconnection
    const controllerUrl = await screenPage.getControllerUrl();
    
    // Close controller
    await controller1.page.close();
    
    // Reconnect before grace period
    const newPage = await controllerContext.newPage();
    await newPage.goto(controllerUrl + '&p=1'); // Request same slot
    
    // Should get same player number
    await expect(newPage.locator('#statusDot')).toHaveClass(/player-0/);
  });
});
```

---

## Configuration

```typescript
// tests/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false, // Tests depend on shared server state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Sequential to avoid port conflicts
  
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  
  use: {
    baseURL: process.env.RETROBOX_URL || 'http://localhost:3333',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  globalSetup: require.resolve('./e2e/global-setup'),
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Future: Firefox, WebKit
  ],
});
```

```typescript
// tests/e2e/global-setup.ts
import { ChildProcess, spawn } from 'child_process';

let serverProcess: ChildProcess | null = null;

export default async function globalSetup() {
  if (process.env.RETROBOX_URL) {
    // External server - skip startup
    console.log('Using external server:', process.env.RETROBOX_URL);
    return;
  }

  console.log('Starting RetroBox server...');
  serverProcess = spawn('bun', ['run', 'server.ts'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  // Wait for server ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    
    serverProcess!.stdout?.on('data', (data) => {
      if (data.toString().includes('Network:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    
    serverProcess!.on('error', reject);
  });
}

export async function globalTeardown() {
  if (serverProcess) {
    serverProcess.kill();
  }
}
```

---

## Package.json Scripts

```json
{
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed",
    "test:debug": "PWDEBUG=1 playwright test",
    "test:report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@types/bun": "latest"
  }
}
```

---

## CI/CD Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install
      
      - name: Install Playwright browsers
        run: bunx playwright install --with-deps chromium
      
      - name: Run E2E tests
        run: bun test
      
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: |
            test-results/
            playwright-report/
```

---

## Extensibility Patterns

### Adding a New Test

1. **Simple test** — Add to existing spec file:
   ```typescript
   test('new scenario', async ({ screenPage, controller1 }) => {
     // test code
   });
   ```

2. **New test category** — Create new spec file in `specs/`

3. **New fixture** — Extend fixtures in `fixtures/`:
   ```typescript
   export const test = base.extend<MyFixtures>({
     myCustomSetup: async ({ screenPage }, use) => {
       // setup
       await use(result);
       // teardown
     },
   });
   ```

### Custom Assertions

```typescript
// tests/e2e/helpers/assertions.ts
import { expect as baseExpect } from '@playwright/test';

export const expect = baseExpect.extend({
  async toHaveNoConsoleErrors(consoleLogs: Map<string, any[]>) {
    const allErrors: string[] = [];
    for (const [ctx, logs] of consoleLogs) {
      const errors = logs.filter(l => l.type() === 'error');
      allErrors.push(...errors.map(e => `[${ctx}] ${e.text()}`));
    }
    
    return {
      pass: allErrors.length === 0,
      message: () => allErrors.length 
        ? `Expected no console errors but found:\n${allErrors.join('\n')}`
        : 'No console errors found',
    };
  },
});
```

---

## Future Enhancements

1. **Visual Regression** — Baseline screenshots with `toMatchSnapshot()`
2. **Performance Metrics** — Capture FPS, input latency via `page.evaluate()`
3. **Network Mocking** — Simulate slow connections, disconnects
4. **Gamepad Emulation** — Test physical gamepad input paths
5. **Cross-Browser Matrix** — Firefox, WebKit, mobile browsers

---

## Summary

This architecture provides:

- ✅ **Multi-context testing** — Screen + multiple controllers
- ✅ **Page Object Model** — Clean, maintainable selectors
- ✅ **Fixture composition** — Reusable setup/teardown
- ✅ **Console log capture** — Error detection across all contexts
- ✅ **Screenshot validation** — Visual state verification
- ✅ **CI/CD ready** — Headless with artifacts
- ✅ **Extensible** — Easy to add new scenarios

The design prioritizes **simplicity for test authors** while providing **powerful infrastructure** for complex multi-browser coordination.
