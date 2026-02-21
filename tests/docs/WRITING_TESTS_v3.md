# Writing E2E Tests for RetroBox (v3)

> Practical guidance for adding new tests to the RetroBox E2E suite.

---

## Quick Start

```bash
cd /home/pi/retrobox

# Install dependencies
bun install

# Install Playwright browsers (example)
bunx playwright install
```

Run tests:

```bash
# Run full E2E suite
bun test

# Run with visible browser
bun test:headed

# Run one spec
bunx playwright test tests/e2e/specs/01-save-load.spec.ts

# Run matching test name
bunx playwright test -g "load state"
```

---

## Core Concepts

### The Orchestrator

All tests should use the `orchestrator` fixture to manage screen + controllers and shared logging.

Key principles:

- **Create the screen first**
- **Then create controllers**
- **Always wait for connections**
- **Use shared helpers for repeated tasks**

Example:

```typescript
import { test, expect } from '../fixtures';

test('start game and load state', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();

  await orchestrator.waitForAllControllersConnected();

  await controller.selectGame('Test ROM');
  await controller.clickStart();
  await screen.waitForGamePlaying();

  await controller.clickLoadState();
  await expect(screen.page.locator('.ejs_message'))
    .toContainText(/loaded/i, { timeout: 5000 });
});
```

---

## Writing New Tests

### 1. Pick the Right Spec File

- Scenario-based: `01-save-load.spec.ts`
- Multiplayer: `02-multiplayer.spec.ts`
- Visual validation: `04-game-start-visual.spec.ts`

### 2. Use the Fixtures

Use `tests/e2e/fixtures/index.ts` as the entry import.

```typescript
import { test, expect } from '../fixtures';
```

### 3. Always Wait for Readiness

Do not interact with the UI until:

- Controller shows connected state
- Screen reports player connected
- Game menu or emulator controls are visible

### 4. Keep Tests Deterministic

- Use the same test ROM for screenshots
- Avoid random UI interactions
- Disable animations in test mode
- Wait for a specific game start signal

---

## Screenshot Tests

Recommended pattern:

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

Notes:

- Run screenshot tests only in stable environments.
- Update baselines explicitly when you intend to change visuals.
- Prefer a dedicated ROM with a static title screen.

---

## Save/Load State Tests

### Save State

```typescript
await controller.clickSaveState();
await expect(screen.page.locator('.ejs_message'))
  .toContainText(/saved/i, { timeout: 5000 });
```

### Load State

```typescript
await controller.clickLoadState();
await expect(screen.page.locator('.ejs_message'))
  .toContainText(/loaded/i, { timeout: 5000 });
```

---

## Multiplayer Tests

```typescript
const screen = await orchestrator.createScreen();
const p1 = await orchestrator.createController();
const p2 = await orchestrator.createController();

await orchestrator.waitForAllControllersConnected();

expect(await screen.getConnectedPlayerCount()).toBe(2);
```

---

## Log Hygiene Tests

We treat console errors as failures by default.

```typescript
expect(orchestrator.hasConsoleErrors()).toBe(false);
```

If needed, pass an allowlist of known errors:

```typescript
expect(orchestrator.hasConsoleErrors([/SomeKnownWarning/])).toBe(false);
```

---

## Multi-Browser Guidance

- Prefer `screen-chromium + controller-webkit` for quick feedback.
- Use a nightly run for the full browser matrix.
- If a feature is unsupported in a browser, use conditional skips.

Example conditional skip:

```typescript
import { test } from '../fixtures';

test('webrtc only', async ({ browserName }) => {
  test.skip(browserName === 'firefox', 'WebRTC behavior differs');
  // ...
});
```

---

## Debugging Tips

- Use `--headed` for visual debugging
- Capture traces on failure
- Inspect WebSocket frames via `WebSocketInspector`

---

## Checklist for New Tests

- Test is deterministic and stable
- Uses orchestrator fixture
- Waits for connections and game-ready state
- Cleans up after itself
- Includes log hygiene checks
- Adds screenshot validation only when needed

---

## Suggested Next Specs to Add

- Controller disconnect/reconnect handling
- State persistence across reloads
- WebRTC renegotiation handling

