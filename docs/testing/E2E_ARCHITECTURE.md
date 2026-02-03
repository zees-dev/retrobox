# RetroBox E2E Testing Architecture

> **Version:** 1.0.0  
> **Date:** 2026-02-03  
> **Status:** Canonical

---

## Executive Summary

This document defines the end-to-end testing architecture for RetroBox, an EmulatorJS-based retro gaming kiosk. The architecture validates the complete user journey: screen initialization → QR display → controller connections → game selection → gameplay → save/load states → multiplayer.

### Design Principles

1. **Deterministic** — Repeatable results across environments and runs
2. **Multi-Browser** — Verify behavior across Chromium, WebKit, Firefox
3. **Multi-Client** — Orchestrate screen + up to 4 controllers
4. **Observable** — Full visibility into console, WebSocket, WebRTC
5. **Extensible** — Easy to add new test scenarios
6. **Debuggable** — Traces, videos, and logs on failure

---

## High-Level Topology

```
┌─────────────────────────────────────────────────────────────┐
│                     Playwright Worker                        │
│                                                             │
│   ┌──────────────┐          ┌─────────────────────────┐    │
│   │ Screen Page  │◄──HTTP──►│    RetroBox Server      │    │
│   │ (Desktop)    │          │    (local or CI)        │    │
│   └──────┬───────┘          │    /         (screen)   │    │
│          │                  │    /controller          │    │
│          │ WebRTC (P2P)     └─────────────────────────┘    │
│          │                             ▲                    │
│   ┌──────┴───────┐                     │                    │
│   │ Controller 1 │◄───── WebSocket ────┘                    │
│   │ (Mobile)     │                                          │
│   └──────────────┘                                          │
│   ┌──────────────┐                                          │
│   │ Controller 2 │◄───── WebSocket ─────────────────────────│
│   │ (Mobile)     │       + WebRTC (P2P to Screen)           │
│   └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘

Note: Each controller has its own WebRTC P2P connection to the screen (star topology).
```

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Test Framework | Playwright Test | Multi-browser, multi-context, built-in reporters |
| Runtime | Bun | Matches production server, fast startup |
| Language | TypeScript | Consistent with codebase |
| Visual Validation | `toHaveScreenshot()` | Built-in baseline comparison |
| Observability | `page.on('console')`, `page.on('websocket')` | Native Playwright events |
| CI Runner | GitHub Actions | Native Playwright action + artifacts |

---

## Multi-Browser Strategy

### Role-Based Projects

Screen and controllers are distinct device roles with different browser/viewport needs:

```typescript
// playwright.config.ts
projects: [
  // Screen projects (desktop browsers)
  { name: 'screen-chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'screen-firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'screen-webkit', use: { ...devices['Desktop Safari'] } },
  
  // Controller projects (mobile browsers)
  { name: 'controller-chromium', use: { ...devices['Pixel 5'] } },
  { name: 'controller-webkit', use: { ...devices['iPhone 14'] } },
]
```

### CI Matrix

| Environment | Browser Combination |
|-------------|---------------------|
| **PR Checks** | `screen-chromium + controller-webkit` |
| **Nightly** | Full matrix of all combinations |

### Why This Matters

- WebRTC behavior differs across engines
- Controllers are mobile-first; screen is desktop
- Isolates engine-specific failures

---

## Directory Structure

```
retrobox/
├── tests/
│   └── e2e/
│       ├── core/
│       │   ├── RetroBoxOrchestrator.ts   # Multi-client coordinator
│       │   ├── ScreenClient.ts           # Screen page object
│       │   ├── ControllerClient.ts       # Controller page object
│       │   ├── ConsoleCollector.ts       # Log aggregation
│       │   ├── WebSocketInspector.ts     # WS frame capture (CDP)
│       │   ├── WebRtcInspector.ts        # P2P state monitoring
│       │   └── types.ts
│       │
│       ├── fixtures/
│       │   ├── base.fixture.ts           # Server lifecycle
│       │   ├── orchestrator.fixture.ts   # Full orchestrator
│       │   └── index.ts                  # Combined export
│       │
│       ├── specs/
│       │   ├── 01-screen-init.spec.ts
│       │   ├── 02-connection.spec.ts
│       │   ├── 03-game-launch.spec.ts
│       │   ├── 04-save-state.spec.ts
│       │   ├── 05-multiplayer.spec.ts
│       │   ├── 06-error-free.spec.ts
│       │   └── 07-reconnection.spec.ts
│       │
│       ├── utils/
│       │   ├── testData.ts               # Test ROMs, button constants
│       │   ├── assertions.ts             # Custom matchers
│       │   └── waitFor.ts
│       │
│       └── global/
│           ├── setup.ts
│           └── teardown.ts
│
├── playwright.config.ts
├── test-results/
│   ├── screenshots/
│   ├── traces/
│   └── videos/
└── docs/testing/
```

---

## Core Abstractions

### 1. RetroBoxOrchestrator

Central coordinator for multi-client scenarios:

```typescript
export class RetroBoxOrchestrator {
  public screen: ScreenClient | null = null;
  public controllers: Map<number, ControllerClient> = new Map();
  public consoleCollector: ConsoleCollector;

  async createScreen(): Promise<ScreenClient>;
  async createController(playerNum?: number): Promise<ControllerClient>;
  async waitForAllControllersConnected(): Promise<void>;
  
  hasConsoleErrors(ignoredPatterns?: RegExp[]): boolean;
  getConsoleErrors(): { source: string; errors: string[] }[];
  
  async captureScreenshot(name: string): Promise<Buffer>;
  async cleanup(): Promise<void>;
}
```

**Key responsibilities:**
- `createScreen()` must be called before any controllers
- `createController()` creates a mobile controller page and maps it to a player slot
- `waitForAllControllersConnected()` synchronizes screen + controller readiness
- Automatic cleanup after each test

### 2. ScreenClient

Page object for kiosk display:

```typescript
export class ScreenClient {
  // Navigation & State
  async navigate(): Promise<void>;
  async waitForQRCode(): Promise<void>;
  async waitForGameMenuVisible(): Promise<void>;
  async waitForGameLoading(): Promise<void>;
  async waitForGamePlaying(): Promise<void>;
  async getCurrentState(): Promise<'idle' | 'loading' | 'playing'>;
  
  // Controller Management
  async getControllerUrl(): Promise<string>;
  async waitForControllerConnected(playerNum: number): Promise<void>;
  async waitForControllerDisconnected(playerNum: number): Promise<void>;
  async getConnectedPlayerCount(): Promise<number>;
  
  // Game State
  async isPaused(): Promise<boolean>;
  async screenshot(name: string): Promise<Buffer>;
}
```

### 3. ControllerClient

Page object for mobile controller:

```typescript
export class ControllerClient {
  // Connection
  async navigate(): Promise<void>;
  async waitForConnected(): Promise<void>;
  async waitForP2PConnected(): Promise<void>;
  async isConnected(): Promise<boolean>;
  async getPlayerNumber(): Promise<number | null>;
  
  // Game Selection
  async selectGame(gameName: string): Promise<void>;
  async selectGameByCore(core: string, playerCount: string, gameName: string): Promise<void>;
  async clickStart(): Promise<void>;
  
  // Gameplay
  async waitForGameControls(): Promise<void>;
  async pressButton(button: number): Promise<void>;
  async releaseButton(button: number): Promise<void>;
  
  // Save States
  async clickSaveState(): Promise<void>;
  async clickLoadState(): Promise<void>;
  async clickResetToMenu(): Promise<void>;
}
```

### 4. ConsoleCollector

Aggregates console logs across all contexts:

```typescript
export class ConsoleCollector {
  attach(page: Page, source: string): void;
  getAll(): LogEntry[];
  getBySource(source: string): LogEntry[];
  getErrors(ignoredPatterns?: RegExp[]): { source: string; errors: string[] }[];
  hasErrors(ignoredPatterns?: RegExp[]): boolean;
  clear(): void;
}
```

### 5. WebSocketInspector

CDP-based WebSocket frame capture:

```typescript
export class WebSocketInspector {
  async attach(page: Page): Promise<void>;
  getMessages(): WSMessage[];
  getSentMessages(): WSMessage[];
  getReceivedMessages(): WSMessage[];
  findMessage(predicate: (msg: any) => boolean): WSMessage | undefined;
  waitForMessage(predicate: (msg: any) => boolean, timeout?: number): Promise<WSMessage>;
  async detach(): Promise<void>;
}
```

---

## Test Coupling & Stability Contract

### Philosophy

Tests should validate **core behaviors**, not implementation details. The codebase will evolve, but these fundamental contracts should remain stable:

### Stable Contracts (Test These)

| Contract | What to Validate |
|----------|------------------|
| **Screen exists** | A display surface renders at root URL |
| **QR/Link to controller** | Screen provides a way for controllers to connect |
| **Controller connects** | Controller can establish connection to screen |
| **Player identification** | Connected controllers are assigned player slots |
| **WebRTC P2P** | Direct connection between controller and screen |
| **Game loading** | ROMs can be loaded via EmulatorJS |
| **Game running** | EmulatorJS renders gameplay |
| **Input forwarding** | Controller inputs reach the emulator |
| **Save/Load states** | EmulatorJS save state functionality works |
| **Multiplayer** | Multiple controllers can connect simultaneously |

### Avoid Tight Coupling

```typescript
// ❌ Brittle — tied to specific HTML structure
await page.locator('#qrCodeDisplay > canvas.qr-canvas').click();

// ✅ Resilient — tests the behavior
const controllerUrl = await screen.getControllerUrl();
expect(controllerUrl).toContain('/controller');
```

```typescript
// ❌ Brittle — assumes specific class names
await expect(dot).toHaveClass(/player-0/);

// ✅ Resilient — tests the outcome
expect(await screen.getConnectedPlayerCount()).toBe(1);
```

### Page Object Abstraction

Page objects (`ScreenClient`, `ControllerClient`) isolate selector changes:

- If HTML structure changes, update **one place** (the page object)
- Tests continue to call `screen.waitForGamePlaying()` regardless of implementation
- Selectors can use `data-testid` attributes for stability

### What Can Change Freely

- UI styling and layout
- Class names and CSS
- HTML structure
- Animation/transition details
- Non-core features

### What Tests Protect

- Controller → Screen connection flow
- EmulatorJS game lifecycle (load → play → save/load)
- Multi-player slot assignment
- WebRTC P2P establishment
- Error-free operation of core paths

---

## Determinism and Stability

### Test Mode Flag

Introduce `?e2e=1` query parameter to:

- Disable non-deterministic visual effects
- Skip audio initialization
- Expose `window.__retroboxTest` API
- Provide reliable `gameStarted` signal

### Screenshot Stability

```typescript
await expect(screen.page).toHaveScreenshot('game-start.png', {
  fullPage: true,
  animations: 'disabled',
  threshold: 0.2,
});
```

**Rules:**
- Use dedicated test ROM with static title screen
- Run screenshots in stable environments (same OS/browser version)
- Use `reducedMotion` media feature
- Update baselines only when visuals intentionally change

### Environment Controls

- Fixed viewports per role (screen: 1920x1080, controller: 390x844)
- Known test ROM (small, fast-loading, stable rendering)
- Seeded randomness where possible

---

## Test Scenarios

| Spec | Description |
|------|-------------|
| **01-screen-init** | Screen loads, QR visible, 4 controller slots displayed |
| **02-connection** | Controller connects, P2P established, ping displayed |
| **03-game-launch** | Game selection, loading, start, screenshot validation |
| **04-save-state** | Save/load state with UI confirmation |
| **05-multiplayer** | P2 joins mid-game, 4 players connect, disconnect handling |
| **06-error-free** | No console errors during connection/gameplay |
| **07-reconnection** | Reconnect after reload, grace period, pause on disconnect |

---

## Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  
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
  
  globalSetup: './tests/e2e/global/setup.ts',
  globalTeardown: './tests/e2e/global/teardown.ts',
  
  projects: [
    {
      name: 'default',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
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

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - run: bun install
      - run: bunx playwright install --with-deps chromium
      - run: bun test
      
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: |
            test-results/
            playwright-report/
          retention-days: 7
```

---

## Summary

This architecture provides:

- ✅ **Multi-context orchestration** via single orchestrator abstraction
- ✅ **Multi-browser strategy** with role-based projects and CI matrix
- ✅ **Deterministic tests** via test mode flag and screenshot stability rules
- ✅ **Full observability** for console, WebSocket, and WebRTC
- ✅ **CI-ready** with artifacts, traces, and videos on failure
- ✅ **Easy to extend** with numbered specs and fixture composition

This is the canonical source of truth for RetroBox E2E testing architecture.
