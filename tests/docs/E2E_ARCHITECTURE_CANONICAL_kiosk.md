# RetroBox E2E Testing Architecture (Canonical)

> **Version:** 1.0.0  
> **Author:** Kiosk (merged from v1/v2/v3)  
> **Date:** 2026-02-03  
> **Status:** Production-Ready

---

## Executive Summary

This document specifies the end-to-end testing architecture for RetroBox, an EmulatorJS-based retro gaming kiosk. The architecture validates the complete user journey: screen initialization → controller connections → game selection → gameplay → save/load states → multiplayer.

### Design Principles

1. **Deterministic** — Tests produce identical results across runs
2. **Multi-Browser** — Verify behavior across Chromium, WebKit, Firefox
3. **Multi-Client** — Orchestrate screen + up to 4 controllers
4. **Observable** — Full visibility into console, WebSocket, WebRTC
5. **Extensible** — Easy to add new test scenarios

---

## High-Level Topology

```
┌────────────────────────────────────────────────────────────┐
│                    Playwright Worker                        │
│                                                            │
│  ┌──────────────┐         ┌──────────────────────────┐    │
│  │ Screen Page  │◄──HTTP──►│    RetroBox Server      │    │
│  │ (Desktop)    │         │    (local or CI)         │    │
│  └──────┬───────┘         │    /         (screen)    │    │
│         │                 │    /controller           │    │
│         │ WebRTC          └──────────────────────────┘    │
│         │                              ▲                   │
│  ┌──────┴───────┐                      │                   │
│  │ Controller 1 │◄────── WebSocket ────┘                   │
│  │ (Mobile)     │                                          │
│  └──────────────┘                                          │
│  ┌──────────────┐                                          │
│  │ Controller 2 │◄────── WebSocket ────────────────────────│
│  │ (Mobile)     │                                          │
│  └──────────────┘                                          │
└────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Test Framework | Playwright Test | Multi-browser, multi-context, built-in reporters |
| Runtime | Bun | Matches production server |
| Language | TypeScript | Consistent with codebase |
| Visual Validation | `toHaveScreenshot()` | Built-in baseline comparison |
| Observability | `page.on('console')`, `page.on('websocket')` | Native Playwright events |
| CI Runner | GitHub Actions | Native Playwright action |

---

## Multi-Browser Strategy

### Role-Based Projects

Treat screen and controllers as distinct device classes:

```typescript
// playwright.config.ts projects
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

- **Fast CI (PR checks):** `screen-chromium + controller-webkit`
- **Nightly:** Full matrix of all combinations

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
  
  async cleanup(): Promise<void>;
}
```

### 2. ScreenClient

Page object for kiosk display:

```typescript
export class ScreenClient {
  async navigate(): Promise<void>;
  async waitForQRCode(): Promise<void>;
  async getControllerUrl(): Promise<string>;
  async waitForControllerConnected(playerNum: number): Promise<void>;
  async waitForGamePlaying(): Promise<void>;
  async getConnectedPlayerCount(): Promise<number>;
  async isPaused(): Promise<boolean>;
  async screenshot(name: string): Promise<Buffer>;
}
```

### 3. ControllerClient

Page object for mobile controller:

```typescript
export class ControllerClient {
  async navigate(): Promise<void>;
  async waitForConnected(): Promise<void>;
  async waitForP2PConnected(): Promise<void>;
  async getPlayerNumber(): Promise<number | null>;
  async selectGame(gameName: string): Promise<void>;
  async clickStart(): Promise<void>;
  async clickSaveState(): Promise<void>;
  async clickLoadState(): Promise<void>;
}
```

### 4. ConsoleCollector

Aggregates console logs across all contexts:

```typescript
export class ConsoleCollector {
  attach(page: Page, source: string): void;
  getErrors(ignoredPatterns?: RegExp[]): { source: string; errors: string[] }[];
  hasErrors(ignoredPatterns?: RegExp[]): boolean;
  clear(): void;
}
```

### 5. WebSocketInspector (Optional)

CDP-based WebSocket frame capture:

```typescript
export class WebSocketInspector {
  async attach(page: Page): Promise<void>;
  getMessages(): WSMessage[];
  waitForMessage(predicate: (msg: any) => boolean, timeout?: number): Promise<WSMessage>;
}
```

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

- Use dedicated test ROM with static title screen
- Run screenshots in stable environments (same OS/browser version)
- Use `reducedMotion` media feature

### Environment Controls

- Fixed viewports per role
- Known test ROM (small, fast-loading)
- Seeded randomness where possible

---

## Test Scenarios

### Scenario 1: Screen Initialization
- Screen loads, QR code visible
- 4 controller slots displayed (inactive)
- No console errors

### Scenario 2: Controller Connection
- Single controller connects as P1
- Two controllers connect as P1, P2
- P2P (WebRTC) established
- Ping displayed

### Scenario 3: Game Launch
- Controller starts game
- Screen transitions to playing
- QR code hides
- Screenshot validation

### Scenario 4: Save/Load State
- Save state, confirmation shown
- Load state, game restored
- Screenshot comparison (optional)

### Scenario 5: Multiplayer
- P2 joins mid-game
- 4 players connect
- Player disconnect during game

### Scenario 6: Error Hygiene
- No console errors during connection
- No console errors during gameplay
- Ignored patterns for known warnings

### Scenario 7: Reconnection
- Controller reconnects after reload
- Reconnect within grace period preserves slot
- Game pauses when all disconnect

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
          path: test-results/
```

---

## Summary

This architecture combines:

- ✅ **v2's production-ready infrastructure** — Orchestrator, ConsoleCollector, full specs
- ✅ **v3's multi-browser strategy** — Role-based projects, CI matrix
- ✅ **v3's determinism guidance** — Test mode flag, screenshot stability
- ✅ **v1's simplicity** — Clear patterns, approachable code

The result is a robust, maintainable E2E suite that catches regressions across browsers while remaining easy to extend.
