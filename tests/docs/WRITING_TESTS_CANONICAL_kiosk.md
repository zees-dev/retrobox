# Writing E2E Tests for RetroBox (Canonical)

> Practical guide for adding new tests to the RetroBox E2E suite.

---

## Quick Start

```bash
cd /home/pi/retrobox

# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install chromium

# Run tests
bun test

# Run with visible browser
bun test:headed

# Run specific test
bunx playwright test -g "controller connects"
```

---

## Your First Test

```typescript
import { test, expect } from '../fixtures';

test('controller can connect', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  
  await controller.waitForConnected();
  await screen.waitForControllerConnected(0);
  
  expect(await screen.getConnectedPlayerCount()).toBe(1);
});
```

---

## Core Concepts

### The Orchestrator

Every test uses the `orchestrator` fixture. It manages:
- Screen browser context (desktop viewport)
- Controller browser contexts (mobile viewport)
- Console log collection
- Automatic cleanup

```typescript
test('example', async ({ orchestrator }) => {
  // Always create screen first
  const screen = await orchestrator.createScreen();
  
  // Then create controllers (auto-assigned player numbers)
  const p1 = await orchestrator.createController();
  const p2 = await orchestrator.createController();
  
  // Wait for all connections
  await orchestrator.waitForAllControllersConnected();
});
```

### Screen Client

```typescript
const screen = await orchestrator.createScreen();

await screen.waitForQRCode();                    // QR visible
await screen.waitForControllerConnected(0);     // P1 connected
await screen.waitForGamePlaying();              // Game running
await screen.screenshot('my-screenshot');       // Save screenshot

const url = await screen.getControllerUrl();
const count = await screen.getConnectedPlayerCount();
const paused = await screen.isPaused();
```

### Controller Client

```typescript
const controller = await orchestrator.createController();

await controller.waitForConnected();            // WebSocket ready
await controller.waitForP2PConnected();         // WebRTC ready
await controller.selectGame('Game Name');       // Pick game
await controller.clickStart();                  // Start button
await controller.clickSaveState();              // Save
await controller.clickLoadState();              // Load

const playerNum = await controller.getPlayerNumber();
```

---

## Common Patterns

### Full Game Session

```typescript
test('complete game session', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Start game
  await controller.selectGame('Test ROM');
  await controller.clickStart();
  await screen.waitForGamePlaying();
  
  // Save state
  await controller.clickSaveState();
  await expect(screen.page.locator('.ejs_message'))
    .toContainText(/saved/i, { timeout: 5000 });
  
  // Verify no errors
  expect(orchestrator.hasConsoleErrors()).toBe(false);
});
```

### Multiplayer

```typescript
test('4-player game', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  
  for (let i = 0; i < 4; i++) {
    const c = await orchestrator.createController();
    await c.waitForConnected();
  }
  
  await orchestrator.waitForAllControllersConnected();
  expect(await screen.getConnectedPlayerCount()).toBe(4);
});
```

### Screenshot Validation

```typescript
test('game start screenshot', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  await controller.selectGame('Test ROM');
  await controller.clickStart();
  await screen.waitForGamePlaying();
  
  await expect(screen.page).toHaveScreenshot('game-start.png', {
    animations: 'disabled',
  });
});
```

### Error Checking

```typescript
test('no console errors', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Do stuff...
  
  // Check errors (with optional ignores)
  const ignored = [/WakeLock/i, /SharedArrayBuffer/i];
  expect(orchestrator.hasConsoleErrors(ignored)).toBe(false);
});
```

### Reconnection

```typescript
test('controller reconnects', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Reload simulates disconnect
  await controller.page.reload();
  await controller.page.waitForLoadState('networkidle');
  
  // Should reconnect
  await controller.waitForConnected();
  expect(await controller.getPlayerNumber()).toBe(0);
});
```

---

## Test Organization

### File Naming

```
specs/
├── 01-screen-init.spec.ts     # Numbered for order
├── 02-connection.spec.ts
├── 03-game-launch.spec.ts
└── ...
```

### Test Structure

```typescript
import { test, expect } from '../fixtures';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ orchestrator }) => {
    // Shared setup
  });

  test('scenario 1', async ({ orchestrator }) => {
    // Test code
  });

  test('scenario 2', async ({ orchestrator }) => {
    // Test code
  });
});
```

---

## Multi-Browser Testing

### Conditional Skips

```typescript
test('webkit-specific', async ({ browserName, orchestrator }) => {
  test.skip(browserName !== 'webkit', 'WebKit only');
  // ...
});
```

### Browser-Specific Expectations

```typescript
test('webrtc behavior', async ({ browserName, orchestrator }) => {
  // WebRTC behaves differently in Firefox
  const timeout = browserName === 'firefox' ? 15000 : 10000;
  await controller.waitForP2PConnected({ timeout });
});
```

---

## Debugging

### Playwright Inspector

```bash
PWDEBUG=1 bun test:headed
```

### Traces

View trace after failure:
```bash
bunx playwright show-trace test-results/artifacts/test-name/trace.zip
```

### Pause for Inspection

```typescript
test('debug', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  await screen.page.pause(); // Opens inspector
});
```

### Log Console Output

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

### ✅ Do

- Wait for specific state, not time
- Use orchestrator for all multi-client tests
- Check console errors at end of test
- Use meaningful assertions (`toBe(2)` not `toBeTruthy()`)
- Keep tests independent

### ❌ Don't

- Use `page.waitForTimeout()` except for debugging
- Depend on previous test state
- Forget to wait for connections before interacting
- Ignore console errors

---

## Timeouts

```typescript
// Test-level timeout
test.setTimeout(120000);

// Assertion timeout
await expect(locator).toBeVisible({ timeout: 30000 });

// Config-level (playwright.config.ts)
timeout: 60000,
expect: { timeout: 10000 },
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `bun test` | Run all tests |
| `bun test:headed` | Run with visible browser |
| `bun test:ui` | Playwright UI mode |
| `bun test:debug` | With inspector |
| `bun test:report` | View HTML report |
| `bunx playwright test -g "pattern"` | Run matching tests |
| `bunx playwright test specs/file.ts` | Run specific file |

---

## Troubleshooting

### Timeouts

- Increase timeout or check if waiting for wrong condition
- View trace to see where it stalled

### Element Not Found

- Check if page navigated away
- Use `await expect(locator).toBeVisible()` before interacting

### Flaky Tests

- Add explicit waits for state
- Use `toPass()` for retry logic:
  ```typescript
  await expect(async () => {
    expect(await getValue()).toBe(expected);
  }).toPass({ timeout: 10000 });
  ```

---

## Checklist for New Tests

- [ ] Uses orchestrator fixture
- [ ] Creates screen before controllers
- [ ] Waits for connections before interacting
- [ ] Checks console errors
- [ ] Has meaningful assertions
- [ ] Cleans up automatically (orchestrator handles this)
- [ ] Follows naming conventions

---

*Happy testing! 🎮*
