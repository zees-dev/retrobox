# Writing E2E Tests for RetroBox (Canonical)

> Practical guide for adding new tests to the RetroBox E2E suite.

---

## Quick Start

### 1. Setup

```bash
cd /home/pi/retrobox

# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install
```

### 2. Run Existing Tests

```bash
# Run all tests
bun test

# Run with visible browser
bun test:headed

# Run specific test file
bunx playwright test tests/e2e/specs/01-screen-init.spec.ts

# Run matching test name
bunx playwright test -g "controller connects"
```

### 3. Write Your First Test

```typescript
// tests/e2e/specs/my-feature.spec.ts
import { test, expect } from '../fixtures';

test('my feature works', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();

  await expect(screen.status).toContainText(/ready/i);
});
```

---

## Core Concepts

### The Orchestrator Pattern

All tests use the `orchestrator` fixture to manage:
- Screen browser context
- Controller browser contexts
- Console log collection
- Cleanup after each test

Example:

```typescript
test('example', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const p1 = await orchestrator.createController();
  const p2 = await orchestrator.createController();

  await p1.waitForConnected();
  await p2.waitForConnected();
  await orchestrator.waitForAllControllersConnected();
});
```

---

## Lightweight Quick-Start Pattern (v1)

This is the smallest useful test flow. Keep it in your back pocket for fast onboarding.

```typescript
import { test, expect } from '../fixtures';

test('simple flow', async ({ screenPage, controller1 }) => {
  await controller1.waitForConnected();
  await controller1.selectGame('Some Game');
  await controller1.clickStart();

  await screenPage.waitForGamePlaying();
  expect(await screenPage.isGamePaused()).toBe(false);
});
```

Note: The canonical suite uses `orchestrator`, but the quick-start pattern shows the minimum flow.

---

## Screen Client API

```typescript
const screen = await orchestrator.createScreen();

await screen.waitForQRCode();
await screen.waitForGameMenuVisible();
await screen.waitForGameLoading();
await screen.waitForGamePlaying();
await screen.waitForControllerConnected(0);
await screen.waitForControllerDisconnected(1);

const count = await screen.getConnectedPlayerCount();
const state = await screen.getCurrentState();
const paused = await screen.isPaused();
const url = await screen.getControllerUrl();

await screen.screenshot('my-screenshot');
```

---

## Controller Client API

```typescript
const controller = await orchestrator.createController();

await controller.waitForConnected();
await controller.waitForP2PConnected();
const connected = await controller.isConnected();
const playerNum = await controller.getPlayerNumber();

await controller.selectGame('Game Name');
await controller.selectGameByCore('n64', '4p', 'Game Name');
await controller.clickStart();

await controller.waitForGameControls();
await controller.pressButton(0);
await controller.releaseButton(0);

await controller.clickSaveState();
await controller.clickLoadState();
await controller.clickResetToMenu();
```

---

## Determinism and Stability (v3)

Determinism is non-negotiable for stable E2E tests.

Rules:
- Use a dedicated test ROM for screenshot tests
- Disable animations and motion where possible
- Avoid random UI interactions
- Wait for a deterministic game-start signal

If the app supports a test flag like `?e2e=1`, use it to:
- Disable non-deterministic UI effects
- Expose a `window.__retroboxTest` API
- Provide a `gameStarted` signal

---

## Screenshot Tests

Use screenshots only in stable environments and only after the game-start signal.

```typescript
test('game start screenshot is stable', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();

  await orchestrator.waitForAllControllersConnected();

  await controller.selectGame('Test ROM');
  await controller.clickStart();
  await screen.waitForGamePlaying();

  await expect(screen.page).toHaveScreenshot('game-start.png', {
    fullPage: true,
    animations: 'disabled',
  });
});
```

---

## Common Patterns

### Full Game Session

```typescript
test('complete game session', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();

  await controller.selectGame('My Game');
  await controller.clickStart();
  await screen.waitForGamePlaying();

  await controller.clickSaveState();
  await expect(screen.page.locator('.ejs_message'))
    .toContainText(/saved/i, { timeout: 5000 });

  await controller.clickResetToMenu();
  await screen.waitForGameMenuVisible();

  expect(orchestrator.hasConsoleErrors()).toBe(false);
});
```

### Multiplayer

```typescript
test('4-player game', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controllers = [] as any[];

  for (let i = 0; i < 4; i++) {
    const c = await orchestrator.createController();
    await c.waitForConnected();
    await screen.waitForControllerConnected(i);
    controllers.push(c);
  }

  expect(await screen.getConnectedPlayerCount()).toBe(4);

  await controllers[0].selectGame('4-Player Game');
  await controllers[0].clickStart();
  await screen.waitForGamePlaying();

  for (const c of controllers) {
    await c.waitForGameControls();
  }
});
```

### Console Error Hygiene

```typescript
test('no console errors', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();

  await controller.waitForConnected();
  // ... flow ...

  const ignoredPatterns = [
    /WakeLock/i,
    /SharedArrayBuffer/i,
  ];

  expect(orchestrator.hasConsoleErrors(ignoredPatterns)).toBe(false);
});
```

---

## Multi-Browser Guidance (v3)

- Prefer `screen-chromium + controller-webkit` for quick feedback.
- Run a nightly matrix for all screen/controller combinations.
- Skip browsers with known unsupported behavior using conditional skips.

Example:

```typescript
import { test } from '../fixtures';

test('webrtc only', async ({ browserName }) => {
  test.skip(browserName === 'firefox', 'WebRTC behavior differs');
  // ...
});
```

---

## Debugging

### Playwright Inspector

```bash
PWDEBUG=1 bun test:headed
```

### Headed Mode

```bash
bun test:headed
bunx playwright test --headed --slowmo=500
```

### Traces

```bash
bunx playwright show-trace test-results/artifacts/<test-name>/trace.zip
```

### Dump Console Logs

```typescript
test.afterEach(async ({ orchestrator }) => {
  const logs = orchestrator.consoleCollector.getAll();
  for (const log of logs) {
    console.log(`[${log.source}] ${log.type}: ${log.text}`);
  }
});
```

---

## Best Practices

1. Wait for state, not time.
2. Use locators, not brittle selectors.
3. Keep tests independent.
4. Make assertions specific and meaningful.
5. Validate log hygiene for critical flows.

---

## Quick Reference

### Fixture Import

```typescript
import { test, expect } from '../fixtures';
```

### Test Data

```typescript
import { TEST_GAMES, BUTTONS } from '../utils/testData';
```

### Commands

```bash
bun test
bun test:ui
bun test:headed
bun test:debug
bun test:report
```

---

## Checklist for New Tests

- Uses orchestrator fixture
- Waits for connections and game-ready state
- Deterministic and stable
- Includes log hygiene checks
- Adds screenshots only when necessary
- Avoids shared state across tests
