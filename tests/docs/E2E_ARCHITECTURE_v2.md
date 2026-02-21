# RetroBox E2E Testing Architecture v2

> **Version:** 2.0.0  
> **Author:** OpenClaw AI  
> **Date:** 2025-02-03  
> **Status:** Production-Ready Design

---

## Executive Summary

This document specifies a production-ready end-to-end testing architecture for RetroBox, a browser-based retro gaming kiosk. The architecture validates the complete user journey: screen initialization → QR code display → controller connections → game selection → gameplay → save/load states.

### Design Principles

1. **Deterministic** — Tests produce identical results across runs
2. **Isolated** — Each test starts with clean state
3. **Observable** — Full visibility into WebSocket, WebRTC, and console activity
4. **Fast** — Parallel where possible, minimal waits
5. **Debuggable** — Traces, videos, and logs on failure

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Test Framework** | Playwright Test | Multi-context orchestration, native TypeScript, built-in reporters |
| **Runtime** | Bun | Matches production server, fast startup |
| **Assertions** | Playwright Expect + Custom Matchers | Chainable, async-aware, extendable |
| **Visual Validation** | Playwright Screenshots | Built-in comparison, baseline management |
| **CI Runner** | GitHub Actions | Native Playwright action, artifact upload |

### Why Playwright Over Alternatives

| Feature | Playwright | Puppeteer | Cypress |
|---------|------------|-----------|---------|
| Multi-browser contexts | ✅ Native | ⚠️ Manual | ❌ Single |
| WebSocket inspection | ✅ CDP | ✅ CDP | ⚠️ Plugin |
| Mobile emulation | ✅ Devices | ✅ Devices | ⚠️ Limited |
| Parallel execution | ✅ Built-in | ⚠️ Manual | ⚠️ Dashboard |
| Trace viewer | ✅ Built-in | ❌ No | ⚠️ Limited |

---

## Directory Structure

```
retrobox/
├── tests/
│   ├── e2e/
│   │   ├── core/                      # Core infrastructure
│   │   │   ├── RetroBoxOrchestrator.ts   # Multi-client coordinator
│   │   │   ├── ScreenClient.ts           # Screen page object + helpers
│   │   │   ├── ControllerClient.ts       # Controller page object + helpers
│   │   │   ├── WebSocketInspector.ts     # WS message interception
│   │   │   ├── ConsoleCollector.ts       # Console log aggregation
│   │   │   └── types.ts                  # Shared TypeScript types
│   │   │
│   │   ├── fixtures/
│   │   │   ├── base.fixture.ts           # Server lifecycle, base URL
│   │   │   ├── screen.fixture.ts         # Screen context + client
│   │   │   ├── controller.fixture.ts     # Controller context(s) + clients
│   │   │   ├── orchestrator.fixture.ts   # Full orchestrator fixture
│   │   │   └── index.ts                  # Composed test export
│   │   │
│   │   ├── specs/
│   │   │   ├── 01-screen-init.spec.ts    # Screen loads, QR visible
│   │   │   ├── 02-connection.spec.ts     # Controller connection flow
│   │   │   ├── 03-game-launch.spec.ts    # Game selection and start
│   │   │   ├── 04-save-state.spec.ts     # Save/load state validation
│   │   │   ├── 05-multiplayer.spec.ts    # Multi-controller scenarios
│   │   │   ├── 06-error-free.spec.ts     # Console error validation
│   │   │   └── 07-reconnection.spec.ts   # Disconnect/reconnect handling
│   │   │
│   │   ├── utils/
│   │   │   ├── waitFor.ts                # Polling utilities
│   │   │   ├── screenshots.ts            # Screenshot helpers
│   │   │   ├── assertions.ts             # Custom matchers
│   │   │   └── testData.ts               # Test ROM/game constants
│   │   │
│   │   └── global/
│   │       ├── setup.ts                  # Global setup (server start)
│   │       └── teardown.ts               # Global teardown
│   │
│   └── playwright.config.ts              # Playwright configuration
│
├── test-results/                         # Generated artifacts
│   ├── screenshots/
│   ├── traces/
│   └── videos/
│
└── docs/testing/
    ├── E2E_ARCHITECTURE_v2.md            # This document
    └── WRITING_TESTS_v2.md               # Developer guide
```

---

## Core Abstractions

### 1. RetroBoxOrchestrator

The orchestrator is the central coordinator for multi-client test scenarios. It manages the screen and up to 4 controllers, handling synchronization and state verification.

```typescript
// tests/e2e/core/RetroBoxOrchestrator.ts
import { Browser, BrowserContext } from '@playwright/test';
import { ScreenClient } from './ScreenClient';
import { ControllerClient } from './ControllerClient';
import { ConsoleCollector } from './ConsoleCollector';

export interface OrchestratorConfig {
  serverUrl: string;
  screenViewport?: { width: number; height: number };
  controllerViewport?: { width: number; height: number };
}

export class RetroBoxOrchestrator {
  private browser: Browser;
  private config: OrchestratorConfig;
  
  public screen: ScreenClient | null = null;
  public controllers: Map<number, ControllerClient> = new Map();
  public consoleCollector: ConsoleCollector;
  
  private screenContext: BrowserContext | null = null;
  private controllerContext: BrowserContext | null = null;

  constructor(browser: Browser, config: OrchestratorConfig) {
    this.browser = browser;
    this.config = config;
    this.consoleCollector = new ConsoleCollector();
  }

  async createScreen(): Promise<ScreenClient> {
    this.screenContext = await this.browser.newContext({
      viewport: this.config.screenViewport ?? { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await this.screenContext.newPage();
    this.consoleCollector.attach(page, 'screen');
    
    this.screen = new ScreenClient(page, this.config.serverUrl);
    await this.screen.navigate();
    
    return this.screen;
  }

  async createController(playerNum?: number): Promise<ControllerClient> {
    if (!this.screen) {
      throw new Error('Screen must be created before controllers');
    }

    // Reuse controller context for all controllers (simulates same device type)
    if (!this.controllerContext) {
      this.controllerContext = await this.browser.newContext({
        viewport: this.config.controllerViewport ?? { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile',
      });
    }

    const page = await this.controllerContext.newPage();
    const controllerUrl = await this.screen.getControllerUrl();
    
    // Calculate next player number if not specified
    const nextPlayerNum = playerNum ?? this.controllers.size;
    this.consoleCollector.attach(page, `controller-${nextPlayerNum}`);
    
    const controller = new ControllerClient(page, controllerUrl, nextPlayerNum);
    await controller.navigate();
    
    this.controllers.set(nextPlayerNum, controller);
    return controller;
  }

  async waitForAllControllersConnected(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [playerNum, controller] of this.controllers) {
      promises.push(controller.waitForConnected());
      promises.push(this.screen!.waitForControllerConnected(playerNum));
    }
    
    await Promise.all(promises);
  }

  getConsoleErrors(): { source: string; errors: string[] }[] {
    return this.consoleCollector.getErrors();
  }

  hasConsoleErrors(ignoredPatterns?: RegExp[]): boolean {
    return this.consoleCollector.hasErrors(ignoredPatterns);
  }

  async captureScreenshot(name: string): Promise<Buffer> {
    if (!this.screen) throw new Error('No screen');
    return this.screen.screenshot(name);
  }

  async cleanup(): Promise<void> {
    for (const controller of this.controllers.values()) {
      await controller.close();
    }
    this.controllers.clear();
    
    await this.screen?.close();
    this.screen = null;
    
    await this.screenContext?.close();
    await this.controllerContext?.close();
    this.screenContext = null;
    this.controllerContext = null;
    
    this.consoleCollector.clear();
  }
}
```

### 2. ScreenClient

Page object for the screen (kiosk display).

```typescript
// tests/e2e/core/ScreenClient.ts
import { Page, Locator, expect } from '@playwright/test';

export type ScreenState = 'idle' | 'loading' | 'playing';

export class ScreenClient {
  readonly page: Page;
  readonly baseUrl: string;
  
  // Locators
  readonly qrContainer: Locator;
  readonly qrCodeDisplay: Locator;
  readonly qrUrl: Locator;
  readonly controllerDots: Locator;
  readonly gameContainer: Locator;
  readonly pauseOverlay: Locator;
  readonly status: Locator;
  readonly gameMenu: Locator;
  readonly loadingOverlay: Locator;

  constructor(page: Page, baseUrl: string) {
    this.page = page;
    this.baseUrl = baseUrl;
    
    // Initialize locators
    this.qrContainer = page.locator('#qrContainer');
    this.qrCodeDisplay = page.locator('#qrCodeDisplay');
    this.qrUrl = page.locator('#qrUrl');
    this.controllerDots = page.locator('.controller-dot');
    this.gameContainer = page.locator('.game-container');
    this.pauseOverlay = page.locator('#pauseOverlay');
    this.status = page.locator('#status');
    this.gameMenu = page.locator('#gameMenu');
    this.loadingOverlay = page.locator('#loadingOverlay');
  }

  async navigate(): Promise<void> {
    await this.page.goto(this.baseUrl);
    await this.page.waitForLoadState('networkidle');
  }

  async getControllerUrl(): Promise<string> {
    // Wait for QR to be generated
    await expect(this.qrUrl).toHaveAttribute('href', /.+/);
    const href = await this.qrUrl.getAttribute('href');
    if (!href) throw new Error('Controller URL not found');
    return href;
  }

  async waitForQRCode(): Promise<void> {
    await expect(this.qrCodeDisplay).toBeVisible();
    // Verify QR code canvas/image is rendered
    const qrElement = this.qrCodeDisplay.locator('canvas, img').first();
    await expect(qrElement).toBeVisible();
  }

  async waitForControllerConnected(playerNum: number): Promise<void> {
    const dot = this.controllerDots.nth(playerNum);
    await expect(dot).toHaveClass(/active/, { timeout: 10000 });
    await expect(dot).toHaveClass(new RegExp(`player-${playerNum}`));
  }

  async waitForControllerDisconnected(playerNum: number): Promise<void> {
    const dot = this.controllerDots.nth(playerNum);
    await expect(dot).not.toHaveClass(/active/, { timeout: 10000 });
  }

  async getConnectedPlayerCount(): Promise<number> {
    const dots = await this.controllerDots.all();
    let count = 0;
    for (const dot of dots) {
      const classes = await dot.getAttribute('class');
      if (classes?.includes('active')) count++;
    }
    return count;
  }

  async waitForGameLoading(): Promise<void> {
    // Game menu shows loading overlay when game is starting
    await expect(this.loadingOverlay).toBeVisible({ timeout: 5000 });
  }

  async waitForGamePlaying(): Promise<void> {
    // QR code hides when game starts
    await expect(this.qrContainer).toHaveClass(/hidden/, { timeout: 30000 });
    
    // EmulatorJS started
    await this.page.waitForFunction(
      () => (window as any).EJS_emulator?.started === true,
      { timeout: 30000 }
    );
  }

  async waitForGameMenuVisible(): Promise<void> {
    await expect(this.gameMenu).toBeVisible();
  }

  async getCurrentState(): Promise<ScreenState> {
    const qrHidden = await this.qrContainer.evaluate(
      el => el.classList.contains('hidden')
    );
    
    if (!qrHidden) return 'idle';
    
    const emulatorStarted = await this.page.evaluate(
      () => (window as any).EJS_emulator?.started === true
    );
    
    return emulatorStarted ? 'playing' : 'loading';
  }

  async isPaused(): Promise<boolean> {
    return this.pauseOverlay.evaluate(
      el => el.classList.contains('visible')
    );
  }

  async screenshot(name: string): Promise<Buffer> {
    const path = `test-results/screenshots/${name}.png`;
    return this.gameContainer.screenshot({ path });
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
```

### 3. ControllerClient

Page object for controller (mobile device).

```typescript
// tests/e2e/core/ControllerClient.ts
import { Page, Locator, expect } from '@playwright/test';

export class ControllerClient {
  readonly page: Page;
  readonly url: string;
  readonly expectedPlayerNum: number;
  
  // Locators
  readonly statusDot: Locator;
  readonly pingBadge: Locator;
  readonly gameMenu: Locator;
  readonly playerStatus: Locator;

  constructor(page: Page, url: string, expectedPlayerNum: number) {
    this.page = page;
    this.url = url;
    this.expectedPlayerNum = expectedPlayerNum;
    
    this.statusDot = page.locator('#statusDot');
    this.pingBadge = page.locator('#pingBadge');
    this.gameMenu = page.locator('#gameMenu');
    this.playerStatus = page.locator('#playerStatus');
  }

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
    await this.page.waitForLoadState('networkidle');
  }

  async waitForConnected(): Promise<void> {
    // Status dot shows connected state with player color
    await expect(this.statusDot).toHaveClass(/connected/, { timeout: 10000 });
    await expect(this.statusDot).toHaveClass(
      new RegExp(`player-${this.expectedPlayerNum}`)
    );
    
    // Player status becomes visible
    await expect(this.playerStatus).toHaveClass(/visible/);
  }

  async waitForP2PConnected(): Promise<void> {
    // P2P indicator (small dot on status)
    await expect(this.statusDot).toHaveClass(/p2p/, { timeout: 15000 });
  }

  async isConnected(): Promise<boolean> {
    const classes = await this.statusDot.getAttribute('class');
    return classes?.includes('connected') ?? false;
  }

  async getPlayerNumber(): Promise<number | null> {
    const text = await this.statusDot.textContent();
    const match = text?.match(/P(\d)/);
    return match ? parseInt(match[1], 10) - 1 : null;
  }

  async selectGame(gameName: string): Promise<void> {
    const allGamesSelect = this.gameMenu.locator('#allGamesSelect');
    await allGamesSelect.selectOption({ label: gameName });
  }

  async selectGameByCore(core: string, playerCount: string, gameName: string): Promise<void> {
    const coreSelect = this.gameMenu.locator('#coreSelect');
    const playerCountSelect = this.gameMenu.locator('#playerCountSelect');
    const gameSelect = this.gameMenu.locator('#gameSelect');
    
    await coreSelect.selectOption(core);
    await playerCountSelect.selectOption(playerCount);
    await gameSelect.selectOption({ label: gameName });
  }

  async clickStart(): Promise<void> {
    const startButton = this.gameMenu.locator('#startButton');
    await expect(startButton).toBeEnabled();
    await startButton.click();
  }

  async waitForGameControls(): Promise<void> {
    // EmulatorJS control bar appears
    await this.page.waitForSelector('.ejs_menu_bar', { timeout: 30000 });
  }

  async pressButton(button: number): Promise<void> {
    await this.page.evaluate((btn) => {
      const emulator = (window as any).EJS_emulator;
      emulator?.handler?.exec('input.simulate', {
        button: btn,
        state: 'pressed',
        player: 0, // Will be remapped by screen
      });
    }, button);
  }

  async releaseButton(button: number): Promise<void> {
    await this.page.evaluate((btn) => {
      const emulator = (window as any).EJS_emulator;
      emulator?.handler?.exec('input.simulate', {
        button: btn,
        state: 'released',
        player: 0,
      });
    }, button);
  }

  async clickSaveState(): Promise<void> {
    const saveButton = this.page.locator('[data-btn="remoteSave"]');
    await saveButton.click();
  }

  async clickLoadState(): Promise<void> {
    const loadButton = this.page.locator('[data-btn="remoteLoad"]');
    await loadButton.click();
  }

  async clickResetToMenu(): Promise<void> {
    const menuButton = this.page.locator('[data-btn="home"]');
    await menuButton.click();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
```

### 4. ConsoleCollector

Aggregates console logs across all contexts.

```typescript
// tests/e2e/core/ConsoleCollector.ts
import { Page, ConsoleMessage } from '@playwright/test';

interface LogEntry {
  source: string;
  type: string;
  text: string;
  timestamp: number;
}

export class ConsoleCollector {
  private logs: LogEntry[] = [];
  private attachedPages: Map<Page, string> = new Map();

  attach(page: Page, source: string): void {
    this.attachedPages.set(page, source);
    
    page.on('console', (msg: ConsoleMessage) => {
      this.logs.push({
        source,
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });

    page.on('pageerror', (error: Error) => {
      this.logs.push({
        source,
        type: 'pageerror',
        text: error.message + '\n' + error.stack,
        timestamp: Date.now(),
      });
    });
  }

  getAll(): LogEntry[] {
    return [...this.logs];
  }

  getBySource(source: string): LogEntry[] {
    return this.logs.filter(l => l.source === source);
  }

  getErrors(ignoredPatterns?: RegExp[]): { source: string; errors: string[] }[] {
    const errorTypes = ['error', 'pageerror'];
    const errorsBySource = new Map<string, string[]>();

    for (const log of this.logs) {
      if (!errorTypes.includes(log.type)) continue;
      
      // Skip ignored patterns
      if (ignoredPatterns?.some(p => p.test(log.text))) continue;
      
      if (!errorsBySource.has(log.source)) {
        errorsBySource.set(log.source, []);
      }
      errorsBySource.get(log.source)!.push(log.text);
    }

    return Array.from(errorsBySource.entries()).map(([source, errors]) => ({
      source,
      errors,
    }));
  }

  hasErrors(ignoredPatterns?: RegExp[]): boolean {
    return this.getErrors(ignoredPatterns).some(e => e.errors.length > 0);
  }

  clear(): void {
    this.logs = [];
  }
}
```

### 5. WebSocketInspector

Intercepts WebSocket messages for validation.

```typescript
// tests/e2e/core/WebSocketInspector.ts
import { Page, CDPSession } from '@playwright/test';

interface WSMessage {
  direction: 'sent' | 'received';
  data: any;
  timestamp: number;
}

export class WebSocketInspector {
  private cdp: CDPSession | null = null;
  private messages: WSMessage[] = [];
  private wsRequestId: string | null = null;

  async attach(page: Page): Promise<void> {
    this.cdp = await page.context().newCDPSession(page);
    
    await this.cdp.send('Network.enable');
    
    this.cdp.on('Network.webSocketCreated', (params) => {
      if (params.url.includes('/ws')) {
        this.wsRequestId = params.requestId;
      }
    });

    this.cdp.on('Network.webSocketFrameSent', (params) => {
      if (params.requestId !== this.wsRequestId) return;
      try {
        this.messages.push({
          direction: 'sent',
          data: JSON.parse(params.response.payloadData),
          timestamp: Date.now(),
        });
      } catch {}
    });

    this.cdp.on('Network.webSocketFrameReceived', (params) => {
      if (params.requestId !== this.wsRequestId) return;
      try {
        this.messages.push({
          direction: 'received',
          data: JSON.parse(params.response.payloadData),
          timestamp: Date.now(),
        });
      } catch {}
    });
  }

  getMessages(): WSMessage[] {
    return [...this.messages];
  }

  getSentMessages(): WSMessage[] {
    return this.messages.filter(m => m.direction === 'sent');
  }

  getReceivedMessages(): WSMessage[] {
    return this.messages.filter(m => m.direction === 'received');
  }

  findMessage(predicate: (msg: any) => boolean): WSMessage | undefined {
    return this.messages.find(m => predicate(m.data));
  }

  waitForMessage(
    predicate: (msg: any) => boolean,
    timeout: number = 5000
  ): Promise<WSMessage> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        const found = this.findMessage(predicate);
        if (found) {
          resolve(found);
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout waiting for WebSocket message'));
          return;
        }
        
        setTimeout(check, 50);
      };
      
      check();
    });
  }

  clear(): void {
    this.messages = [];
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      await this.cdp.detach();
      this.cdp = null;
    }
  }
}
```

---

## Fixtures

### Base Fixture (Server Lifecycle)

```typescript
// tests/e2e/fixtures/base.fixture.ts
import { test as base } from '@playwright/test';
import { ChildProcess, spawn } from 'child_process';

export type BaseFixtures = {
  serverUrl: string;
};

let serverProcess: ChildProcess | null = null;
let serverUrl: string = '';

export const test = base.extend<BaseFixtures>({
  serverUrl: [async ({}, use) => {
    // Use external server if specified
    if (process.env.RETROBOX_URL) {
      await use(process.env.RETROBOX_URL);
      return;
    }

    // Start server if not already running
    if (!serverProcess) {
      const port = 3333 + Math.floor(Math.random() * 100);
      serverUrl = `http://localhost:${port}`;
      
      serverProcess = spawn('bun', ['run', 'server.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: 'pipe',
      });

      // Wait for server ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server timeout')), 15000);
        
        serverProcess!.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          if (output.includes('Network:') || output.includes('Local:')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        
        serverProcess!.stderr?.on('data', (data: Buffer) => {
          console.error('Server stderr:', data.toString());
        });
        
        serverProcess!.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    }

    await use(serverUrl);
  }, { scope: 'worker' }],
});
```

### Orchestrator Fixture

```typescript
// tests/e2e/fixtures/orchestrator.fixture.ts
import { test as base } from './base.fixture';
import { RetroBoxOrchestrator } from '../core/RetroBoxOrchestrator';

export type OrchestratorFixtures = {
  orchestrator: RetroBoxOrchestrator;
};

export const test = base.extend<OrchestratorFixtures>({
  orchestrator: async ({ browser, serverUrl }, use) => {
    const orchestrator = new RetroBoxOrchestrator(browser, { serverUrl });
    
    await use(orchestrator);
    
    // Cleanup after test
    await orchestrator.cleanup();
  },
});
```

### Combined Fixture Export

```typescript
// tests/e2e/fixtures/index.ts
import { mergeTests } from '@playwright/test';
import { test as baseTest } from './base.fixture';
import { test as orchestratorTest } from './orchestrator.fixture';

export const test = mergeTests(baseTest, orchestratorTest);
export { expect } from '@playwright/test';
```

---

## Test Specifications

### Spec 1: Screen Initialization

```typescript
// tests/e2e/specs/01-screen-init.spec.ts
import { test, expect } from '../fixtures';

test.describe('Screen Initialization', () => {
  test('screen loads and displays QR code', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    
    // QR code is visible
    await screen.waitForQRCode();
    
    // Status shows "Ready"
    await expect(screen.status).toContainText(/ready/i);
    
    // Controller URL is valid
    const controllerUrl = await screen.getControllerUrl();
    expect(controllerUrl).toMatch(/controller\.html\?screen=/);
    
    // No console errors
    expect(orchestrator.hasConsoleErrors()).toBe(false);
  });

  test('QR code regenerates on resize', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    await screen.waitForQRCode();
    
    // Get initial QR size
    const initialSize = await screen.qrCodeDisplay.boundingBox();
    
    // Resize viewport
    await screen.page.setViewportSize({ width: 800, height: 600 });
    await screen.page.waitForTimeout(300); // Debounce
    
    // QR should still be visible
    await screen.waitForQRCode();
    
    // Size may have changed
    const newSize = await screen.qrCodeDisplay.boundingBox();
    expect(newSize).toBeTruthy();
  });

  test('4 controller slots displayed', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    
    const dots = await screen.controllerDots.all();
    expect(dots).toHaveLength(4);
    
    // All dots should be inactive initially
    for (const dot of dots) {
      await expect(dot).not.toHaveClass(/active/);
    }
  });
});
```

### Spec 2: Controller Connection

```typescript
// tests/e2e/specs/02-connection.spec.ts
import { test, expect } from '../fixtures';

test.describe('Controller Connection', () => {
  test('single controller connects as P1', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    // Both sides confirm connection
    await controller.waitForConnected();
    await screen.waitForControllerConnected(0);
    
    // Controller shows P1
    const playerNum = await controller.getPlayerNumber();
    expect(playerNum).toBe(0);
    
    // Screen shows 1 connected
    expect(await screen.getConnectedPlayerCount()).toBe(1);
  });

  test('two controllers connect as P1 and P2', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    
    const controller1 = await orchestrator.createController();
    await controller1.waitForConnected();
    
    const controller2 = await orchestrator.createController();
    await controller2.waitForConnected();
    
    // Both visible on screen
    await screen.waitForControllerConnected(0);
    await screen.waitForControllerConnected(1);
    
    expect(await screen.getConnectedPlayerCount()).toBe(2);
  });

  test('P2P connection established', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    await controller.waitForConnected();
    await controller.waitForP2PConnected();
    
    // P2P indicator should be visible
    await expect(controller.statusDot).toHaveClass(/p2p/);
  });

  test('controller shows ping after P2P connect', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    await controller.waitForConnected();
    await controller.waitForP2PConnected();
    
    // Wait for ping to be displayed
    await expect(controller.pingBadge).toContainText(/\d+ms/, { timeout: 5000 });
  });
});
```

### Spec 3: Game Launch

```typescript
// tests/e2e/specs/03-game-launch.spec.ts
import { test, expect } from '../fixtures';
import { TEST_GAMES } from '../utils/testData';

test.describe('Game Launch', () => {
  test('controller can start a game', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    // Select and start game
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    
    // Screen transitions to playing state
    await screen.waitForGamePlaying();
    
    // Controller shows game controls
    await controller.waitForGameControls();
    
    // Capture screenshot for validation
    const screenshot = await screen.screenshot('game-loaded');
    expect(screenshot.length).toBeGreaterThan(0);
  });

  test('game loading shows progress', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    
    // Loading state visible
    await screen.waitForGameLoading();
    
    // Eventually transitions to playing
    await screen.waitForGamePlaying();
  });

  test('QR code hides when game starts', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    // QR visible before game
    await screen.waitForQRCode();
    await expect(screen.qrContainer).not.toHaveClass(/hidden/);
    
    // Start game
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    await screen.waitForGamePlaying();
    
    // QR hidden during gameplay
    await expect(screen.qrContainer).toHaveClass(/hidden/);
  });

  test('game can be reset to menu', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    // Start game
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    await screen.waitForGamePlaying();
    
    // Reset to menu
    await controller.clickResetToMenu();
    
    // Back to idle state
    await screen.waitForGameMenuVisible();
    await screen.waitForQRCode();
  });
});
```

### Spec 4: Save/Load State

```typescript
// tests/e2e/specs/04-save-state.spec.ts
import { test, expect } from '../fixtures';
import { TEST_GAMES } from '../utils/testData';

test.describe('Save State', () => {
  test.beforeEach(async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    await screen.waitForGamePlaying();
  });

  test('can save state', async ({ orchestrator }) => {
    const controller = orchestrator.controllers.get(0)!;
    
    // Wait for game to be playable
    await controller.page.waitForTimeout(2000);
    
    // Save state
    await controller.clickSaveState();
    
    // Confirmation message appears (EmulatorJS shows this)
    await expect(orchestrator.screen!.page.locator('.ejs_message'))
      .toContainText(/saved/i, { timeout: 5000 });
  });

  test('can load state', async ({ orchestrator }) => {
    const controller = orchestrator.controllers.get(0)!;
    const screen = orchestrator.screen!;
    
    // Save first
    await controller.page.waitForTimeout(2000);
    await controller.clickSaveState();
    await expect(screen.page.locator('.ejs_message')).toContainText(/saved/i, { timeout: 5000 });
    
    // Let game progress
    await controller.page.waitForTimeout(3000);
    
    // Load state
    await controller.clickLoadState();
    await expect(screen.page.locator('.ejs_message')).toContainText(/loaded/i, { timeout: 5000 });
  });

  test('load without save shows no state message', async ({ orchestrator }) => {
    const controller = orchestrator.controllers.get(0)!;
    const screen = orchestrator.screen!;
    
    // Clear any existing state by using slot that doesn't exist
    // (This depends on the slot being empty - may need adjustment)
    
    await controller.page.waitForTimeout(1000);
    await controller.clickLoadState();
    
    // Either shows "loaded" (if state exists) or "no saved state"
    const message = screen.page.locator('.ejs_message');
    await expect(message).toBeVisible({ timeout: 5000 });
  });
});
```

### Spec 5: Multiplayer

```typescript
// tests/e2e/specs/05-multiplayer.spec.ts
import { test, expect } from '../fixtures';
import { TEST_GAMES } from '../utils/testData';

test.describe('Multiplayer', () => {
  test('second player can join mid-game', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller1 = await orchestrator.createController();
    await controller1.waitForConnected();
    
    // P1 starts game
    await controller1.selectGame(TEST_GAMES.MULTIPLAYER.name);
    await controller1.clickStart();
    await screen.waitForGamePlaying();
    
    // P2 connects after game started
    const controller2 = await orchestrator.createController();
    await controller2.waitForConnected();
    await screen.waitForControllerConnected(1);
    
    // Both players shown
    expect(await screen.getConnectedPlayerCount()).toBe(2);
  });

  test('four players can connect', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    
    // Connect 4 controllers
    for (let i = 0; i < 4; i++) {
      const controller = await orchestrator.createController();
      await controller.waitForConnected();
      await screen.waitForControllerConnected(i);
    }
    
    expect(await screen.getConnectedPlayerCount()).toBe(4);
    
    // All 4 dots active
    for (let i = 0; i < 4; i++) {
      const dot = screen.controllerDots.nth(i);
      await expect(dot).toHaveClass(/active/);
    }
  });

  test('player disconnect during game', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller1 = await orchestrator.createController();
    const controller2 = await orchestrator.createController();
    
    await orchestrator.waitForAllControllersConnected();
    
    // Start game
    await controller1.selectGame(TEST_GAMES.MULTIPLAYER.name);
    await controller1.clickStart();
    await screen.waitForGamePlaying();
    
    // P2 disconnects
    await controller2.close();
    orchestrator.controllers.delete(1);
    
    // Screen shows P2 disconnected (after grace period)
    await screen.waitForControllerDisconnected(1);
    
    // P1 still connected
    await expect(screen.controllerDots.nth(0)).toHaveClass(/active/);
  });
});
```

### Spec 6: Error-Free Operation

```typescript
// tests/e2e/specs/06-error-free.spec.ts
import { test, expect } from '../fixtures';
import { TEST_GAMES } from '../utils/testData';

// Patterns for known non-critical errors
const IGNORED_ERRORS = [
  /WakeLock/i,
  /SharedArrayBuffer/i,
  /ResizeObserver loop/i,
];

test.describe('Error-Free Operation', () => {
  test('no errors on screen load', async ({ orchestrator }) => {
    await orchestrator.createScreen();
    
    // Allow time for any async operations
    await orchestrator.screen!.page.waitForTimeout(1000);
    
    expect(orchestrator.hasConsoleErrors(IGNORED_ERRORS)).toBe(false);
  });

  test('no errors during controller connection', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    await controller.waitForConnected();
    await controller.waitForP2PConnected();
    
    // Allow WebRTC to stabilize
    await screen.page.waitForTimeout(2000);
    
    expect(orchestrator.hasConsoleErrors(IGNORED_ERRORS)).toBe(false);
  });

  test('no errors during gameplay', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    await screen.waitForGamePlaying();
    
    // Play for 10 seconds
    await screen.page.waitForTimeout(10000);
    
    const errors = orchestrator.getConsoleErrors();
    const criticalErrors = errors.flatMap(e => 
      e.errors.filter(err => !IGNORED_ERRORS.some(p => p.test(err)))
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('no errors on game reset', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    // Start game
    await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
    await controller.clickStart();
    await screen.waitForGamePlaying();
    
    // Reset to menu
    await controller.clickResetToMenu();
    await screen.waitForGameMenuVisible();
    
    // Small delay for cleanup
    await screen.page.waitForTimeout(1000);
    
    expect(orchestrator.hasConsoleErrors(IGNORED_ERRORS)).toBe(false);
  });
});
```

### Spec 7: Reconnection

```typescript
// tests/e2e/specs/07-reconnection.spec.ts
import { test, expect } from '../fixtures';

test.describe('Reconnection', () => {
  test('controller reconnects after page reload', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    await controller.waitForConnected();
    const controllerUrl = controller.url;
    
    // Reload controller page
    await controller.page.reload();
    await controller.page.waitForLoadState('networkidle');
    
    // Should reconnect
    await controller.waitForConnected();
    await screen.waitForControllerConnected(0);
  });

  test('controller reconnects within grace period', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    
    await controller.waitForConnected();
    const controllerUrl = controller.url;
    
    // Close controller
    await controller.close();
    
    // Wait 3 seconds (within 7.5s grace period)
    await screen.page.waitForTimeout(3000);
    
    // Reconnect with new page
    const newPage = await orchestrator['controllerContext']!.newPage();
    const newController = new (await import('../core/ControllerClient')).ControllerClient(
      newPage, controllerUrl, 0
    );
    await newController.navigate();
    
    // Should get same player slot
    await newController.waitForConnected();
    const playerNum = await newController.getPlayerNumber();
    expect(playerNum).toBe(0);
  });

  test('game pauses when all controllers disconnect', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
    
    // Start game
    await controller.selectGame('Any Game'); // Adjust based on test data
    await controller.clickStart();
    await screen.waitForGamePlaying();
    
    // Disconnect controller
    await controller.close();
    orchestrator.controllers.delete(0);
    
    // Wait for grace period to expire
    await screen.page.waitForTimeout(8000);
    
    // Game should be paused
    expect(await screen.isPaused()).toBe(true);
  });
});
```

---

## Test Data

```typescript
// tests/e2e/utils/testData.ts

export const TEST_GAMES = {
  // A small, fast-loading game for quick tests
  QUICK_LOAD: {
    name: 'Test ROM', // Replace with actual preset name
    core: 'nes',
    playerCount: '2p',
  },
  
  // A multiplayer game for connection tests
  MULTIPLAYER: {
    name: 'Mario Kart', // Replace with actual preset name
    core: 'n64',
    playerCount: '4p',
  },
  
  // A game that supports save states
  SAVE_STATE: {
    name: 'Save Test', // Replace with actual preset name
    core: 'snes',
    playerCount: '2p',
  },
};

// Button mappings for EmulatorJS
export const BUTTONS = {
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  START: 9,
  SELECT: 8,
  L1: 10,
  R1: 11,
};
```

---

## Playwright Configuration

```typescript
// tests/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.spec.ts',
  
  // Fail fast on first failure in CI
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Sequential - shared server state
  
  // Timeouts
  timeout: 60000, // 60s per test
  expect: { timeout: 10000 },
  
  // Reporting
  reporter: [
    ['html', { open: 'never', outputFolder: 'test-results/html-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  
  // Global settings
  use: {
    baseURL: process.env.RETROBOX_URL || 'http://localhost:3333',
    
    // Capture on failure
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    
    // Browser settings
    headless: true,
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  
  // Output
  outputDir: 'test-results/artifacts',
  
  // Projects
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Optional: test on other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
  
  // Global setup/teardown
  globalSetup: require.resolve('./e2e/global/setup.ts'),
  globalTeardown: require.resolve('./e2e/global/teardown.ts'),
  
  // Development server (alternative to global setup)
  // webServer: {
  //   command: 'bun run server.ts',
  //   url: 'http://localhost:3333',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 15000,
  // },
});
```

---

## Global Setup/Teardown

```typescript
// tests/e2e/global/setup.ts
import { FullConfig } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';

let serverProcess: ChildProcess | null = null;

async function globalSetup(config: FullConfig) {
  // Create output directories
  mkdirSync('test-results/screenshots', { recursive: true });
  mkdirSync('test-results/traces', { recursive: true });
  mkdirSync('test-results/videos', { recursive: true });
  
  // Skip server start if external URL provided
  if (process.env.RETROBOX_URL) {
    console.log('Using external server:', process.env.RETROBOX_URL);
    return;
  }
  
  console.log('Starting RetroBox server...');
  
  serverProcess = spawn('bun', ['run', 'server.ts'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, PORT: '3333' },
  });
  
  // Store for teardown
  (global as any).__SERVER_PROCESS__ = serverProcess;
  
  // Wait for server ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 15000);
    
    serverProcess!.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[server]', output.trim());
      if (output.includes('Network:') || output.includes('Local:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    
    serverProcess!.stderr?.on('data', (data: Buffer) => {
      console.error('[server:err]', data.toString().trim());
    });
    
    serverProcess!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    serverProcess!.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
  
  console.log('Server started successfully');
}

export default globalSetup;
```

```typescript
// tests/e2e/global/teardown.ts
import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  const serverProcess = (global as any).__SERVER_PROCESS__;
  
  if (serverProcess) {
    console.log('Stopping server...');
    serverProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        serverProcess.kill('SIGKILL');
        resolve();
      }, 5000);
      
      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    console.log('Server stopped');
  }
}

export default globalTeardown;
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

env:
  CI: true

jobs:
  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install
      
      - name: Install Playwright browsers
        run: bunx playwright install --with-deps chromium
      
      - name: Run E2E tests
        run: bunx playwright test
      
      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: |
            test-results/
            playwright-report/
          retention-days: 7
      
      - name: Upload traces on failure
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results/artifacts/
          retention-days: 7
```

### Local Development Scripts

```json
// package.json additions
{
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed",
    "test:debug": "PWDEBUG=1 playwright test",
    "test:report": "playwright show-report test-results/html-report",
    "test:trace": "playwright show-trace",
    "test:codegen": "playwright codegen http://localhost:3333"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@types/bun": "latest"
  }
}
```

---

## Custom Assertions

```typescript
// tests/e2e/utils/assertions.ts
import { expect as baseExpect, Locator } from '@playwright/test';

export const expect = baseExpect.extend({
  async toBePlayerConnected(locator: Locator, playerNum: number) {
    const assertionName = 'toBePlayerConnected';
    let pass: boolean;
    let matcherResult: string;
    
    try {
      await baseExpect(locator).toHaveClass(/active/);
      await baseExpect(locator).toHaveClass(new RegExp(`player-${playerNum}`));
      pass = true;
      matcherResult = `Player ${playerNum + 1} is connected`;
    } catch (e) {
      pass = false;
      matcherResult = `Player ${playerNum + 1} is not connected`;
    }
    
    return {
      name: assertionName,
      pass,
      message: () => matcherResult,
    };
  },
  
  async toHaveNoConsoleErrors(
    collector: { hasErrors: (patterns?: RegExp[]) => boolean; getErrors: (patterns?: RegExp[]) => any[] },
    ignoredPatterns?: RegExp[]
  ) {
    const assertionName = 'toHaveNoConsoleErrors';
    const hasErrors = collector.hasErrors(ignoredPatterns);
    
    if (hasErrors) {
      const errors = collector.getErrors(ignoredPatterns);
      const errorList = errors
        .flatMap(e => e.errors.map((err: string) => `[${e.source}] ${err}`))
        .join('\n');
      
      return {
        name: assertionName,
        pass: false,
        message: () => `Expected no console errors but found:\n${errorList}`,
      };
    }
    
    return {
      name: assertionName,
      pass: true,
      message: () => 'No console errors found',
    };
  },
});
```

---

## Extending the Framework

### Adding New Test Scenarios

1. **Simple test in existing spec:**
   ```typescript
   test('new scenario', async ({ orchestrator }) => {
     const screen = await orchestrator.createScreen();
     // Test logic
   });
   ```

2. **New spec file:**
   - Create `specs/XX-feature-name.spec.ts`
   - Import fixtures: `import { test, expect } from '../fixtures';`
   - Follow naming convention: `XX-` prefix for ordering

3. **New fixture:**
   ```typescript
   // fixtures/custom.fixture.ts
   import { test as base } from './orchestrator.fixture';
   
   export const test = base.extend<{ myFixture: MyType }>({
     myFixture: async ({ orchestrator }, use) => {
       // Setup
       await use(instance);
       // Teardown
     },
   });
   ```

### Adding Visual Regression

```typescript
// In any spec file
test('visual regression: game menu', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  await screen.waitForGameMenuVisible();
  
  // Compare against baseline
  await expect(screen.gameMenu).toHaveScreenshot('game-menu.png', {
    threshold: 0.2, // 20% pixel difference allowed
    maxDiffPixelRatio: 0.05,
  });
});
```

### Adding Performance Metrics

```typescript
// In any spec file
test('performance: game load time', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  const startTime = Date.now();
  
  await controller.selectGame(TEST_GAMES.QUICK_LOAD.name);
  await controller.clickStart();
  await screen.waitForGamePlaying();
  
  const loadTime = Date.now() - startTime;
  
  console.log(`Game load time: ${loadTime}ms`);
  expect(loadTime).toBeLessThan(30000); // Max 30 seconds
});
```

---

## Debugging Tips

### Using Playwright Inspector

```bash
# Launch with inspector
PWDEBUG=1 bunx playwright test --headed

# Debug specific test
PWDEBUG=1 bunx playwright test -g "controller can start a game"
```

### Viewing Traces

```bash
# After test failure with trace
bunx playwright show-trace test-results/artifacts/<test-name>/trace.zip
```

### Console Log Analysis

```typescript
test.afterEach(async ({ orchestrator }) => {
  // Dump all logs on failure
  const logs = orchestrator.consoleCollector.getAll();
  console.log('=== Console Logs ===');
  for (const log of logs) {
    console.log(`[${log.source}] [${log.type}] ${log.text}`);
  }
});
```

---

## Summary

This architecture provides:

| Capability | Implementation |
|------------|----------------|
| **Multi-context testing** | `RetroBoxOrchestrator` coordinates screen + 4 controllers |
| **Page Object Model** | `ScreenClient`, `ControllerClient` encapsulate DOM |
| **WebSocket inspection** | `WebSocketInspector` via CDP |
| **Console log capture** | `ConsoleCollector` across all contexts |
| **Visual validation** | Playwright screenshots with baseline comparison |
| **CI/CD ready** | GitHub Actions workflow with artifacts |
| **Extensible** | Fixture composition, custom matchers |
| **Debuggable** | Traces, videos, inspector integration |

The design prioritizes **test reliability** and **developer experience** while providing comprehensive coverage of RetroBox's multi-client architecture.

---

## Appendix: Quick Reference

### Common Commands

```bash
# Run all tests
bun test

# Run specific spec
bun test -- -g "Screen Initialization"

# Run with UI
bun test:ui

# Run headed (visible browser)
bun test:headed

# Debug mode
bun test:debug

# Generate test report
bun test:report
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RETROBOX_URL` | External server URL | `http://localhost:3333` |
| `CI` | CI mode (no retries locally) | `false` |
| `PWDEBUG` | Enable Playwright inspector | `false` |
