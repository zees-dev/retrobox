# Writing E2E Tests for RetroBox

> Quick guide for adding new E2E tests

---

## Quick Start

```typescript
// tests/e2e/specs/my-feature.spec.ts
import { test, expect } from '../fixtures';

test('my new test', async ({ screenPage, controller1 }) => {
  // 1. Wait for connection
  await controller1.waitForConnected();

  // 2. Interact
  await controller1.selectGame('Some Game');
  await controller1.clickStart();

  // 3. Assert
  await screenPage.waitForGamePlaying();
  expect(await screenPage.isGamePaused()).toBe(false);
});
```

---

## Available Fixtures

| Fixture | Type | Description |
|---------|------|-------------|
| `screenPage` | `ScreenPage` | Main kiosk display (1920x1080) |
| `controller1` | `ControllerPage` | First controller (mobile viewport) |
| `controller2` | `ControllerPage` | Second controller |
| `consoleLogs` | `Map<string, ConsoleMessage[]>` | Console logs per context |
| `serverUrl` | `string` | Base URL of RetroBox server |

---

## Page Object Methods

### ScreenPage

```typescript
screenPage.getControllerUrl()           // Get QR code URL
screenPage.waitForControllerConnected(1) // Wait for player N
screenPage.waitForGamePlaying()         // Wait for game start
screenPage.isGamePaused()               // Check pause state
screenPage.captureGameScreenshot(name)  // Save screenshot
```

### ControllerPage

```typescript
controller.waitForConnected()           // Wait for WebSocket + P2P
controller.selectGame('Game Name')      // Select from dropdown
controller.clickStart()                 // Start button
controller.waitForGameControls()        // Wait for EmulatorJS UI
controller.clickSaveState()             // Trigger save
controller.clickLoadState()             // Trigger load
```

---

## Common Patterns

### Test with Error Checking

```typescript
import { assertNoErrors } from '../helpers/logs';

test('no errors during X', async ({ screenPage, controller1, consoleLogs }) => {
  await controller1.waitForConnected();
  // ... do stuff ...
  
  assertNoErrors(consoleLogs); // Throws if any console.error
});
```

### Visual Validation

```typescript
test('game looks correct', async ({ screenPage, controller1 }) => {
  await controller1.waitForConnected();
  await controller1.selectGame('Sonic');
  await controller1.clickStart();
  await screenPage.waitForGamePlaying();

  // Take screenshot
  await screenPage.captureGameScreenshot('sonic-title-screen');

  // Or use snapshot matching (requires baseline)
  await expect(screenPage.gameContainer).toHaveScreenshot('sonic-title.png');
});
```

### Waiting for WebSocket State

```typescript
test('P2P established', async ({ screenPage, controller1 }) => {
  await controller1.waitForConnected();

  // Wait for P2P indicator
  await expect(controller1.statusDot).toHaveClass(/p2p/);

  // Check ping is displayed
  await expect(controller1.pingBadge).toContainText(/\d+ms/);
});
```

---

## Running Tests

```bash
# All tests
bun test

# Specific file
bun test connection.spec.ts

# With browser visible
bun test:headed

# Debug mode (step through)
bun test:debug

# View report
bun test:report
```

---

## Tips

1. **Always await connections** — Don't assume instant WebSocket/P2P
2. **Use page.waitForTimeout sparingly** — Prefer explicit waits
3. **Check consoleLogs at end** — Catch silent errors
4. **Screenshot on key states** — Helps debug failures
5. **One assertion per test** (when possible) — Clearer failures
