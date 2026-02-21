# Writing E2E Tests for RetroBox

> A practical guide for developers adding new tests to the RetroBox E2E suite.

---

## Quick Start

### 1. Setup

```bash
cd /home/pi/retrobox

# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install chromium
```

### 2. Run Existing Tests

```bash
# Run all tests
bun test

# Run with visible browser
bun test:headed

# Run specific test file
bunx playwright test specs/01-screen-init.spec.ts

# Run tests matching pattern
bunx playwright test -g "controller connects"
```

### 3. Write Your First Test

```typescript
// tests/e2e/specs/my-feature.spec.ts
import { test, expect } from '../fixtures';

test('my feature works', async ({ orchestrator }) => {
  // Create screen
  const screen = await orchestrator.createScreen();
  
  // Create controller
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Your test logic here
  await expect(screen.status).toContainText(/ready/i);
});
```

---

## Core Concepts

### The Orchestrator Pattern

Every test uses the `orchestrator` fixture. It manages:
- Screen browser context
- Controller browser contexts (up to 4)
- Console log collection
- Cleanup after each test

```typescript
test('example', async ({ orchestrator }) => {
  // Always create screen first
  const screen = await orchestrator.createScreen();
  
  // Then create controllers
  const p1 = await orchestrator.createController(); // Gets player 0
  const p2 = await orchestrator.createController(); // Gets player 1
  
  // Wait for connections
  await p1.waitForConnected();
  await p2.waitForConnected();
  
  // Or wait for all at once
  await orchestrator.waitForAllControllersConnected();
});
```

### Screen Client API

```typescript
const screen = await orchestrator.createScreen();

// Navigation & State
await screen.navigate();                    // Go to screen URL
await screen.waitForQRCode();               // QR code visible
await screen.waitForGameMenuVisible();      // Game menu visible
await screen.waitForGameLoading();          // Game is loading
await screen.waitForGamePlaying();          // Game is playing

// Controller Connections
await screen.waitForControllerConnected(0); // P1 connected
await screen.waitForControllerDisconnected(1); // P2 disconnected
const count = await screen.getConnectedPlayerCount();

// Game State
const state = await screen.getCurrentState(); // 'idle' | 'loading' | 'playing'
const paused = await screen.isPaused();

// URLs
const url = await screen.getControllerUrl(); // For manual inspection

// Screenshots
await screen.screenshot('my-screenshot');   // Saves to test-results/screenshots/
```

### Controller Client API

```typescript
const controller = await orchestrator.createController();

// Connection
await controller.waitForConnected();        // WebSocket connected
await controller.waitForP2PConnected();     // WebRTC P2P established
const connected = await controller.isConnected();
const playerNum = await controller.getPlayerNumber(); // 0-3

// Game Selection
await controller.selectGame('Game Name');   // From "All Games" dropdown
await controller.selectGameByCore('n64', '4p', 'Game Name'); // Filtered selection
await controller.clickStart();              // Start button

// Gameplay
await controller.waitForGameControls();     // EmulatorJS loaded
await controller.pressButton(0);            // Press A button
await controller.releaseButton(0);          // Release A button

// Save States
await controller.clickSaveState();
await controller.clickLoadState();
await controller.clickResetToMenu();
```

---

## Common Patterns

### Testing a Full Game Session

```typescript
test('complete game session', async ({ orchestrator }) => {
  // Setup
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Start game
  await controller.selectGame('My Game');
  await controller.clickStart();
  await screen.waitForGamePlaying();
  
  // Play
  await controller.pressButton(BUTTONS.START);
  await controller.releaseButton(BUTTONS.START);
  
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

### Testing Multiplayer

```typescript
test('4-player game', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  
  // Create all 4 controllers
  const controllers = [];
  for (let i = 0; i < 4; i++) {
    const c = await orchestrator.createController();
    await c.waitForConnected();
    await screen.waitForControllerConnected(i);
    controllers.push(c);
  }
  
  // Verify all connected
  expect(await screen.getConnectedPlayerCount()).toBe(4);
  
  // P1 starts game
  await controllers[0].selectGame('4-Player Game');
  await controllers[0].clickStart();
  await screen.waitForGamePlaying();
  
  // All controllers show game controls
  for (const c of controllers) {
    await c.waitForGameControls();
  }
});
```

### Testing Disconnection/Reconnection

```typescript
test('controller reconnects', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();
  
  // Store URL for reconnection
  const controllerUrl = controller.url;
  
  // Simulate disconnect via page reload
  await controller.page.reload();
  await controller.page.waitForLoadState('networkidle');
  
  // Should automatically reconnect
  await controller.waitForConnected();
  
  // Same player slot
  expect(await controller.getPlayerNumber()).toBe(0);
});
```

### Checking Console Errors

```typescript
test('no console errors', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  
  // ... do stuff ...
  
  // Check for errors (with optional ignore patterns)
  const ignoredPatterns = [
    /WakeLock/i,           // Expected on some browsers
    /SharedArrayBuffer/i,  // Expected without proper headers
  ];
  
  expect(orchestrator.hasConsoleErrors(ignoredPatterns)).toBe(false);
  
  // Or get detailed error list
  const errors = orchestrator.getConsoleErrors();
  console.log('Errors by source:', errors);
});
```

### Taking Screenshots

```typescript
test('visual validation', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  
  // Take screenshot of game container
  await screen.screenshot('game-menu-idle');
  
  // Or full page screenshot
  await screen.page.screenshot({
    path: 'test-results/screenshots/full-page.png',
    fullPage: true,
  });
  
  // Visual comparison (requires baseline)
  await expect(screen.gameMenu).toHaveScreenshot('game-menu.png');
});
```

---

## Test Organization

### Naming Conventions

```
specs/
├── 01-screen-init.spec.ts    # Numbered for execution order
├── 02-connection.spec.ts
├── 03-game-launch.spec.ts
└── regression/               # Optional subfolder for regression tests
    └── bug-123.spec.ts
```

### Test Structure

```typescript
import { test, expect } from '../fixtures';
import { TEST_GAMES, BUTTONS } from '../utils/testData';

test.describe('Feature Name', () => {
  // Runs before each test in this describe block
  test.beforeEach(async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();
    await controller.waitForConnected();
  });

  test('scenario 1', async ({ orchestrator }) => {
    // orchestrator already has screen and controller from beforeEach
    const controller = orchestrator.controllers.get(0)!;
    // ...
  });

  test('scenario 2', async ({ orchestrator }) => {
    // Fresh setup from beforeEach
    // ...
  });
});
```

---

## Debugging

### Playwright Inspector

```bash
# Launch with step-through debugger
PWDEBUG=1 bun test:headed
```

This opens Playwright Inspector where you can:
- Step through each action
- Inspect selectors
- View console logs
- Generate selectors by clicking

### Headed Mode

```bash
# See the browser while tests run
bun test:headed

# Slow down for visibility
bunx playwright test --headed --slowmo=500
```

### Traces

When a test fails, a trace is automatically saved. View it with:

```bash
bunx playwright show-trace test-results/artifacts/my-test/trace.zip
```

Traces include:
- Timeline of actions
- Network requests
- Console logs
- Screenshots at each step
- DOM snapshots

### Logging

```typescript
test('debug example', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  
  // Log current state
  console.log('Screen state:', await screen.getCurrentState());
  console.log('QR URL:', await screen.getControllerUrl());
  
  // Pause for manual inspection
  await screen.page.pause(); // Opens inspector
});
```

### Dump Console Logs

```typescript
test.afterEach(async ({ orchestrator }) => {
  // Print all console logs after test
  const logs = orchestrator.consoleCollector.getAll();
  for (const log of logs) {
    console.log(`[${log.source}] ${log.type}: ${log.text}`);
  }
});
```

---

## Configuration

### Timeouts

```typescript
// In test file
test.setTimeout(120000); // 2 minutes for this test

// In specific expect
await expect(locator).toBeVisible({ timeout: 30000 });
```

### Test Annotations

```typescript
// Skip test
test.skip('broken feature', async () => {});

// Skip on condition
test('platform specific', async () => {
  test.skip(process.platform === 'darwin', 'Mac-specific issue');
});

// Mark as flaky (will retry)
test.describe('flaky tests', () => {
  test.describe.configure({ retries: 3 });
  
  test('sometimes fails', async () => {});
});

// Run only this test
test.only('focus on this', async () => {});
```

### Environment Variables

| Variable | Usage |
|----------|-------|
| `RETROBOX_URL=http://192.168.1.100:3333` | Test against external server |
| `PWDEBUG=1` | Enable Playwright inspector |
| `CI=true` | Enable CI mode (stricter) |

---

## Best Practices

### 1. Wait for State, Not Time

```typescript
// ❌ Bad: arbitrary timeout
await page.waitForTimeout(5000);

// ✅ Good: wait for specific condition
await screen.waitForGamePlaying();
await expect(locator).toBeVisible();
```

### 2. Use Locators, Not Selectors

```typescript
// ❌ Bad: fragile selector
await page.$('#app > div:nth-child(2) > button');

// ✅ Good: semantic locator
await page.getByRole('button', { name: 'Start' });
await page.locator('#startButton');
```

### 3. Clean Up State

```typescript
// Orchestrator handles cleanup automatically
test('my test', async ({ orchestrator }) => {
  // ... test code ...
  // No manual cleanup needed!
});
```

### 4. Test Independence

Each test should work independently:

```typescript
// ❌ Bad: depends on previous test state
test('step 1', async () => { /* creates something */ });
test('step 2', async () => { /* expects step 1 ran */ });

// ✅ Good: self-contained
test('complete flow', async ({ orchestrator }) => {
  // Setup, action, verify - all in one test
});
```

### 5. Meaningful Assertions

```typescript
// ❌ Bad: checking truthy
expect(await screen.getConnectedPlayerCount()).toBeTruthy();

// ✅ Good: specific expectation
expect(await screen.getConnectedPlayerCount()).toBe(2);
```

---

## Troubleshooting

### Test Timeouts

```
Error: Test timeout of 60000ms exceeded
```

**Solutions:**
- Increase timeout: `test.setTimeout(120000)`
- Check if waiting for wrong condition
- Look at trace to see where it stalled

### Element Not Found

```
Error: locator.click: Target closed
```

**Solutions:**
- Ensure page hasn't navigated away
- Check if element is in shadow DOM
- Use `await expect(locator).toBeVisible()` first

### Flaky Tests

**Common causes:**
- Race conditions in WebSocket/WebRTC setup
- Animation timing
- Network latency

**Solutions:**
- Add explicit waits for state
- Use `toPass()` for retry logic
- Mark as flaky with retries

```typescript
// Retry assertion until it passes
await expect(async () => {
  const count = await screen.getConnectedPlayerCount();
  expect(count).toBe(2);
}).toPass({ timeout: 10000 });
```

### Browser Crashes

**Solutions:**
- Reduce parallel workers
- Check for memory leaks in test
- Update Playwright: `bunx playwright install`

---

## Quick Reference

### Fixture

```typescript
import { test, expect } from '../fixtures';

test('name', async ({ orchestrator, serverUrl }) => {
  // orchestrator: RetroBoxOrchestrator instance
  // serverUrl: string (e.g., "http://localhost:3333")
});
```

### Test Data

```typescript
import { TEST_GAMES, BUTTONS } from '../utils/testData';

// TEST_GAMES.QUICK_LOAD.name
// BUTTONS.A, BUTTONS.START, etc.
```

### Commands

```bash
bun test              # Run all
bun test:ui           # Playwright UI mode
bun test:headed       # Visible browser
bun test:debug        # With inspector
bun test:report       # View HTML report
```

---

*Happy testing! 🎮*
