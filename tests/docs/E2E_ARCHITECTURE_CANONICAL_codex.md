# RetroBox E2E Testing Architecture (Canonical)

> **Version:** 3.1.0-canonical  \
> **Author:** OpenClaw AI + Codex Merge  \
> **Date:** 2026-02-03  \
> **Status:** Canonical Design

---

## Executive Summary

This document defines the canonical end-to-end (E2E) testing architecture for RetroBox. It uses the v2 production-ready framework as the foundation, adds v3 determinism and multi-browser strategy, and includes v1 lightweight quick-start patterns to keep onboarding easy.

The system validates the full user journey: screen initialization -> QR display -> controller connections -> game selection -> gameplay -> save/load state -> multiplayer -> log hygiene, with deterministic screenshot validation at game start.

---

## Design Principles

1. **Deterministic**: Repeatable results across environments and runs.
2. **Isolated**: Each test begins with clean state.
3. **Observable**: Full visibility into console, WebSocket, and WebRTC state.
4. **Fast**: Parallel where possible, minimize fixed waits.
5. **Debuggable**: Traces, videos, and logs on failure.
6. **Scalable**: Multi-controller orchestration with a single abstraction.

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Test Framework | Playwright Test | Multi-context orchestration, TypeScript native, built-in reporters |
| Runtime | Bun | Matches production server, fast startup |
| Assertions | Playwright Expect + Custom Matchers | Async-aware, extendable |
| Visual Validation | Playwright Screenshots | Built-in comparison and baselines |
| CI Runner | GitHub Actions | Native Playwright workflow + artifacts |

---

## Directory Structure

```
retrobox/
├── tests/
│   ├── e2e/
│   │   ├── core/
│   │   │   ├── RetroBoxOrchestrator.ts
│   │   │   ├── ScreenClient.ts
│   │   │   ├── ControllerClient.ts
│   │   │   ├── ConsoleCollector.ts
│   │   │   ├── WebSocketInspector.ts
│   │   │   ├── WebRtcInspector.ts
│   │   │   └── types.ts
│   │   ├── fixtures/
│   │   │   ├── base.fixture.ts
│   │   │   ├── screen.fixture.ts
│   │   │   ├── controller.fixture.ts
│   │   │   ├── orchestrator.fixture.ts
│   │   │   └── index.ts
│   │   ├── specs/
│   │   │   ├── 01-screen-init.spec.ts
│   │   │   ├── 02-connection.spec.ts
│   │   │   ├── 03-game-launch.spec.ts
│   │   │   ├── 04-save-state.spec.ts
│   │   │   ├── 05-multiplayer.spec.ts
│   │   │   ├── 06-error-free.spec.ts
│   │   │   └── 07-reconnection.spec.ts
│   │   ├── utils/
│   │   │   ├── waitFor.ts
│   │   │   ├── screenshots.ts
│   │   │   ├── assertions.ts
│   │   │   └── testData.ts
│   │   └── global/
│   │       ├── setup.ts
│   │       └── teardown.ts
│   └── playwright.config.ts
├── test-results/
│   ├── screenshots/
│   ├── traces/
│   └── videos/
└── docs/testing/
```

---

## Core Abstractions

### 1. RetroBoxOrchestrator

A single coordinator that manages:
- Screen context and page
- Controller context(s) and pages
- Console log aggregation
- Shared synchronization helpers
- Cleanup after each test

Key responsibilities:
- `createScreen()` must be called before any controllers
- `createController()` creates a mobile controller page and maps it to a player slot
- `waitForAllControllersConnected()` synchronizes screen + controller readiness
- `captureScreenshot()` provides deterministic artifact capture

### 2. ScreenClient

Encapsulates the kiosk screen:
- `navigate()`, `waitForQRCode()`
- `waitForGameLoading()`, `waitForGamePlaying()`
- `waitForControllerConnected(playerNum)`
- `getControllerUrl()`
- `screenshot(name)`

### 3. ControllerClient

Encapsulates controller UI:
- `waitForConnected()`, `waitForP2PConnected()`
- `selectGame()` and `selectGameByCore()`
- `clickStart()`, `clickSaveState()`, `clickLoadState()`, `clickResetToMenu()`
- `pressButton()` and `releaseButton()`

### 4. Observability Utilities

- **ConsoleCollector**: collects `console` and `pageerror` for each context
- **WebSocketInspector**: captures WS frames for validation
- **WebRtcInspector**: monitors P2P state (placeholder or implementation)

---

## Determinism and Test Mode

Determinism is a first-class requirement. Tests should be repeatable across runs and environments.

### Recommended Controls

- Fixed viewports for screen and controller contexts
- Dedicated test ROMs with stable rendering
- Reduced motion and animation disabling for screenshots
- Seeded randomness if any random UI behavior exists

### Test-Only Flag

Introduce a test-only flag such as `?e2e=1` to:
- Disable non-deterministic visual effects
- Skip audio initialization
- Expose a `window.__retroboxTest` API
- Provide a reliable `gameStarted` signal

### Screenshot Stability Rules

- Take screenshots only after a deterministic game-start signal
- Use a dedicated ROM with a static title screen
- Update baselines only when visuals intentionally change

---

## Multi-Browser Matrix Strategy

### Roles and Projects

Screen and controller are treated as distinct device roles:
- `screen-chromium` (Desktop Chrome)
- `screen-firefox` (Desktop Firefox)
- `screen-webkit` (Desktop Safari)
- `controller-webkit` (Mobile Safari)
- `controller-chromium` (Mobile Chrome)

### Default Matrix

- **CI default**: `screen-chromium + controller-webkit`
- **Nightly matrix**: all screen + controller combinations

### Role-Specific Overrides

- Screen: large viewport, no touch
- Controller: mobile viewport, touch, mobile user agent

---

## Test Specifications

Baseline suite uses v2 specs as canonical coverage:

- **01-screen-init**: screen loads, QR visible, controller slots present
- **02-connection**: controller connect flow + P2P
- **03-game-launch**: game selection, loading, and start
- **04-save-state**: save and load validations
- **05-multiplayer**: 2-4 controller scenarios
- **06-error-free**: log hygiene across flows
- **07-reconnection**: reconnect and grace period behavior

Add or extend specs using numbered naming and consistent orchestrator setup.

---

## Playwright Configuration

Canonical configuration values:

- `workers: 1` for shared server state
- `trace: on-first-retry`
- `screenshot: only-on-failure`
- `video: on-first-retry`
- `timeout: 60000` per test
- `expect.timeout: 10000`
- Single server lifecycle via global setup/teardown

Multi-browser projects follow the matrix strategy above.

---

## CI/CD Integration

Recommended workflow:

- Install Bun
- Install Playwright browsers
- Run `bunx playwright test`
- Upload `test-results/` and `playwright-report/`

Artifacts required on failure:
- Screenshots
- Traces
- Videos
- Console logs

---

## Quick-Start Patterns (Lightweight)

These are minimal patterns for onboarding (from v1), kept here intentionally for speed.

### Simple Test

```typescript
import { test, expect } from '../fixtures';

test('my new scenario', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();

  await controller.selectGame('Some Game');
  await controller.clickStart();
  await screen.waitForGamePlaying();

  expect(await screen.isPaused()).toBe(false);
});
```

### Error Check Helper

```typescript
test('no console errors during flow', async ({ orchestrator }) => {
  const screen = await orchestrator.createScreen();
  const controller = await orchestrator.createController();
  await controller.waitForConnected();

  // ... flow ...

  expect(orchestrator.hasConsoleErrors()).toBe(false);
});
```

---

## Extensibility Patterns

- Add new spec files in `tests/e2e/specs/` with `XX-` prefix
- Add new fixtures by extending the orchestrator fixture
- Add custom assertions in `tests/e2e/utils/assertions.ts`
- Add new test ROMs or presets in `tests/e2e/utils/testData.ts`

---

## Summary

This canonical architecture provides:

- Multi-context orchestration via a single orchestrator
- Deterministic, observable, and debuggable tests
- Multi-browser strategy with minimal CI default and expanded nightly coverage
- Quick-start patterns for fast onboarding
- CI-ready artifacts and consistent test structure

This is the single source of truth for RetroBox E2E testing architecture.
