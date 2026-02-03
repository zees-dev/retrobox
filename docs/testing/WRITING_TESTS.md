# Writing E2E Tests for RetroBox

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
- Automatic cleanup after each test

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

---

## API Reference

### Screen Client

```typescript
const screen = await orchestrator.createScreen();

// Navigation & State
await screen.waitForQRCode();                    // QR visible
await screen.waitForGameMenuVisible();           // Menu ready
await screen.waitForGameLoading();               // Game loading
await screen.waitForGamePlaying();               // Game running
const state = await screen.getCurrentState();    // 'idle' | 'loading' | 'playing'

// Controller Management
const url = await screen.getControllerUrl();
await screen.waitForControllerConnected(0);      // P1 connected
await screen.waitForControllerDisconnected(1);   // P2 disconnected
const count = await screen.getConnectedPlayerCount();

// Game State
const paused = await screen.isPaused();
await screen.screenshot('my-screenshot');
```

### Controller Client

```typescript
const controller = await orchestrator.createController();

// Connection
await controller.waitForConnected();             // WebSocket ready
await controller.waitForP2PConnected();          // WebRTC ready
const connected = await controller.isConnected();
const playerNum = await controller.getPlayerNumber();

// Game Selection
await controller.selectGame('Game Name');
await controller.selectGameByCore('n64', '4p', 'Game Name');
await controller.clickStart();

// Gameplay
await controller.waitForGameControls();
await controller.pressButton(BUTTONS.A);
await controller.releaseButton(BUTTONS.A);

// Save States
await controller.clickSaveState();
await controller.clickLoadState();
await controller.clickResetToMenu();
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
  
  // Return to menu
  await controller.clickResetToMenu();
  await screen.waitForGameMenuVisible();
  
  // Verify no errors
  expect(orchestrator.hasConsoleErrors()).toBe(false);
});
```

### Multiplayer

```typescript
test('4-player game', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  
  // Connect all 4 players
  for (let i = 0; i < 4; i++) {
    const c = await orchestrator.createController();
    await c.waitForConnected();
    await screen.waitForControllerConnected(i);
  }
  
  expect(await screen.getConnectedPlayerCount()).toBe(4);
  
  // P1 starts game
  const p1 = orchestrator.controllers.get(0)!;
  await p1.selectGame('4-Player Game');
  await p1.clickStart();
  await screen.waitForGamePlaying();
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
  
  // ... do stuff ...
  
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
  
  // Should reconnect to same slot
  await controller.waitForConnected();
  expect(await controller.getPlayerNumber()).toBe(0);
});
```

---

## Test Organization

### File Naming

```
specs/
├── 01-screen-init.spec.ts     # Numbered for execution order
├── 02-connection.spec.ts
├── 03-game-launch.spec.ts
├── 04-save-state.spec.ts
├── 05-multiplayer.spec.ts
├── 06-error-free.spec.ts
└── 07-reconnection.spec.ts
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

test('webrtc behavior', async ({ browserName, orchestrator }) => {
  test.skip(browserName === 'firefox', 'WebRTC differs in Firefox');
  // ...
});
```

### Browser-Specific Timeouts

```typescript
test('p2p connection', async ({ browserName, orchestrator }) => {
  const timeout = browserName === 'firefox' ? 15000 : 10000;
  await controller.waitForP2PConnected({ timeout });
});
```

---

## Determinism Rules

Determinism is non-negotiable for stable E2E tests.

1. **Use dedicated test ROM** for screenshot tests (static title screen)
2. **Disable animations** via `animations: 'disabled'` in screenshot options
3. **Avoid random interactions** — same inputs every run
4. **Wait for signals, not time** — use `waitForGamePlaying()`, not `waitForTimeout()`
5. **Use test mode flag** (`?e2e=1`) if app supports it

---

## Debugging

### Playwright Inspector

```bash
PWDEBUG=1 bun test:headed
```

### Headed Mode with Slowdown

```bash
bunx playwright test --headed --slowmo=500
```

### View Traces

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

## Avoiding Tight Coupling

The codebase will change. Tests should validate **behaviors**, not **implementation**.

### Test the Contract

| Core Contract | How to Test |
|---------------|-------------|
| Screen displays | Page loads, content renders |
| Controller can connect | Connection succeeds, player assigned |
| Game can load | EmulatorJS starts, ROM loads |
| Input works | Controller actions affect game |
| Save/Load works | State persists and restores |

### Selector Strategy

```typescript
// ❌ Brittle — tied to DOM structure
await page.locator('div.container > section:nth-child(2) > button.start');

// ✅ Better — semantic selector
await page.getByRole('button', { name: /start/i });

// ✅ Best — data-testid (if available)
await page.locator('[data-testid="start-button"]');
```

### Page Objects Absorb Change

When HTML changes, update the page object — not every test:

```typescript
// ScreenClient.ts — update selector here once
async waitForGamePlaying(): Promise<void> {
  // Implementation can change; tests don't care
  await this.page.waitForFunction(() => window.EJS_emulator?.started);
}
```

---

## Best Practices

### ✅ Do

- Wait for specific state, not time
- Use orchestrator for all multi-client tests
- Check console errors at end of test
- Use meaningful assertions (`toBe(2)` not `toBeTruthy()`)
- Keep tests independent
- Create screen before controllers

### ❌ Don't

- Use `page.waitForTimeout()` except for debugging
- Depend on previous test state
- Forget to wait for connections before interacting
- Ignore console errors
- Share state between tests

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
| `bunx playwright show-trace <path>` | View trace file |

---

## Troubleshooting

### Timeouts

**Symptom:** `Test timeout of 60000ms exceeded`

**Solutions:**
- Increase timeout: `test.setTimeout(120000)`
- Check if waiting for wrong condition
- View trace to see where it stalled

### Element Not Found

**Symptom:** `locator.click: Target closed`

**Solutions:**
- Check if page navigated away
- Use `await expect(locator).toBeVisible()` before interacting
- Check for shadow DOM

### Flaky Tests

**Symptom:** Test passes sometimes, fails others

**Solutions:**
- Add explicit waits for state
- Use `toPass()` for retry logic:
  ```typescript
  await expect(async () => {
    expect(await getValue()).toBe(expected);
  }).toPass({ timeout: 10000 });
  ```
- Check for race conditions in async operations

---

## Checklist for New Tests

- [ ] Uses orchestrator fixture
- [ ] Creates screen before controllers
- [ ] Waits for connections before interacting
- [ ] Checks console errors at end
- [ ] Has meaningful assertions
- [ ] Follows naming conventions (`XX-name.spec.ts`)
- [ ] No hardcoded timeouts (use waits)
- [ ] Independent — doesn't rely on other tests

---

*Happy testing! 🎮*
