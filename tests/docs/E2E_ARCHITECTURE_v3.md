# RetroBox E2E Testing Architecture v3

> **Version:** 3.0.0  \
> **Author:** OpenClaw AI  \
> **Date:** 2026-02-03  \
> **Status:** Design Spec

---

## Executive Summary

This document specifies a multi-browser end-to-end testing architecture for RetroBox, an EmulatorJS-based retro gaming kiosk. The design validates the complete path from kiosk screen boot → controller pairing → game start → save/load state → multiplayer → log hygiene, including deterministic screenshot validation when a game starts.

### Primary Goals

1. **Deterministic**: Repeatable results across environments
2. **Multi-Client**: Orchestrate the kiosk screen and multiple controllers
3. **Multi-Browser**: Verify behavior across Chromium, WebKit, Firefox where practical
4. **Observable**: Full visibility into console, WebSocket, WebRTC, and emulator state
5. **Extensible**: Easy to add new test cases with clear fixtures and helpers

---

## Key System Facts

- Kiosk screen runs at the root URL (`/`), rendering the game output.
- Controller(s) connect via the controller URL and identify as players.
- Controllers connect to the screen via WebSocket and WebRTC.
- Player 1 can start a game.
- On game start, we must validate a screenshot to ensure correct rendering.

---

## Architecture Overview

### High-Level Topology

```
+--------------------+           +---------------------+
|  Playwright Worker |           |  RetroBox Server    |
|                    |           |  (local or CI)      |
|  +--------------+  |  HTTP     |  / (screen)         |
|  | Screen Page  |<------------>|  /controller        |
|  +--------------+  |           +---------------------+
|      ^  ^          |
|      |  | WebRTC   |
|      |  +-----------------+
|      |                    |
|  +--------------+          |
|  | Controller 1|<---WS---->|
|  +--------------+          |
|  +--------------+          |
|  | Controller 2|<---WS---->|
|  +--------------+          |
+----------------------------+
```

### Why Playwright

- Native **multi-browser** support via projects
- Strong **multi-page orchestration** within a single worker
- Built-in **tracing**, **video**, and **screenshot comparison**
- Reliable **auto-waiting** for async UI and network state

---

## Recommended Tooling

| Layer | Choice | Notes |
|------|--------|-------|
| Test Runner | Playwright Test | Multi-browser projects, fixtures, reporters |
| Language | TypeScript | Keeps parity with current TS codebase |
| Visual Validation | `expect(page).toHaveScreenshot()` | Built-in snapshot workflow |
| Logs/Errors | `page.on('console')`, `page.on('pageerror')` | Catch runtime errors and console failures |
| WebSocket Observability | `page.on('websocket')` | Inspect frame events |

---

## Multi-Browser Strategy (Best Practices)

### Principles

- **Separate roles by project**: treat the screen and controller as distinct device classes.
- **Minimize matrix size**: test the screen in desktop browsers and controllers in mobile browsers.
- **Avoid flaky mixes**: WebRTC behavior differs across engines; isolate engine-specific expectations.

### Projects Strategy

Recommended projects in `playwright.config.ts`:

- `screen-chromium` (Desktop Chrome emulation)
- `screen-firefox` (Desktop Firefox)
- `screen-webkit` (Desktop Safari)
- `controller-webkit` (Mobile Safari emulation)
- `controller-chromium` (Mobile Chrome emulation)

Then pair the roles inside the orchestrator:

- **Default CI**: `screen-chromium + controller-webkit`
- **Full nightly**: all screen + controller combinations

### Role-Specific Overrides

- Screen: large viewport, no touch
- Controller: mobile viewport, touch, mobile user agent

---

## Test Harness Structure

```
retrobox/
├── tests/
│   └── e2e/
│       ├── core/
│       │   ├── RetroBoxOrchestrator.ts
│       │   ├── ScreenClient.ts
│       │   ├── ControllerClient.ts
│       │   ├── ConsoleCollector.ts
│       │   ├── WebSocketInspector.ts
│       │   ├── WebRtcInspector.ts
│       │   └── types.ts
│       ├── fixtures/
│       │   ├── base.fixture.ts
│       │   ├── screen.fixture.ts
│       │   ├── controller.fixture.ts
│       │   ├── orchestrator.fixture.ts
│       │   └── index.ts
│       ├── specs/
│       │   ├── 01-save-load.spec.ts
│       │   ├── 02-multiplayer.spec.ts
│       │   ├── 03-log-hygiene.spec.ts
│       │   └── 04-game-start-visual.spec.ts
│       └── utils/
│           ├── assert.ts
│           ├── screenshots.ts
│           ├── testData.ts
│           └── waitFor.ts
└── docs/testing/
    ├── E2E_ARCHITECTURE_v3.md
    └── WRITING_TESTS_v3.md
```

---

## Core Abstractions

### 1. RetroBoxOrchestrator

A single class coordinating the entire test flow:

- Creates the **screen page** (desktop context)
- Creates **controller pages** (mobile context)
- Tracks **connected players** and their IDs
- Exposes **shared waits** (all controllers connected)
- Captures **console, pageerror, and WebSocket events**

### 2. ScreenClient

Encapsulates the kiosk screen (root URL):

- `navigate()`
- `waitForGameMenuVisible()`
- `waitForGamePlaying()`
- `waitForControllerConnected(playerIndex)`
- `getControllerUrl()`
- `takeStartScreenshot()`

### 3. ControllerClient

Encapsulates controller UI:

- `navigate()`
- `waitForConnected()`
- `waitForP2PConnected()`
- `selectGame()`
- `clickStart()`
- `clickSaveState()`
- `clickLoadState()`

### 4. Observability Utilities

- `ConsoleCollector` to capture logs and filter errors
- `WebSocketInspector` to capture WS frames
- `WebRtcInspector` to monitor connection state

---

## Determinism and Stability

### Environment Controls

- Fixed viewports
- Known test ROM (small, fast-loading, stable rendering)
- Seeded randomness and disabled animations
- Disable automatic updates or overlays when in test mode

### Test Mode Recommendation

Introduce a **test-only flag** (e.g., `?e2e=1`) to:

- Disable non-deterministic visual effects
- Skip audio initialization
- Expose a small `window.__retroboxTest` API for status
- Provide a reliable `gameStarted` signal for screenshots

---

## Screenshot Validation Workflow

1. Start the game
2. Wait for **game started** signal
3. Capture kiosk screen screenshot
4. Compare against baseline using `toHaveScreenshot`

Key stability practices:

- **Run screenshots only in stable environments** (same OS and browser version where baselines were created)
- Use `reducedMotion` and block CSS animations
- Keep a **dedicated test ROM** to minimize frame drift

---

## Log and Error Hygiene

We treat console errors or page errors as test failures unless explicitly allowed.

Minimum captured sources:

- `page.on('console')` (screen + controllers)
- `page.on('pageerror')`
- WebSocket frame errors

Provide a configurable `ignoredErrors` list for known third-party warnings.

---

## Test Scenarios Supported

### Scenario 1: Start Game + Load State

- Screen boot
- Controller P1 connect
- Start game
- Click **Load State**
- Validate UI confirmation
- Screenshot check

### Scenario 2: Start Game + Save State

- Screen boot
- Controller P1 connect
- Start game
- Click **Save State**
- Validate UI confirmation

### Scenario 3: Connect Another Player

- Screen boot
- Controller P1 connect
- Controller P2 connect
- Verify screen shows two players

### Scenario 4: Log Hygiene

- All above flows with `ConsoleCollector`
- Assert no errors on screen or controllers

---

## Coordination Pattern for Multi-Page Tests

- Each test runs in a **single Playwright worker**.
- The test creates **multiple contexts** (screen + controllers).
- Controllers share one mobile context to simulate same device type.
- Tests should be **serial** when they share a single server instance.

---

## CI and Local Execution

- **Fast path**: `screen-chromium + controller-webkit`
- **Extended path**: full browser matrix nightly
- Always store: screenshots, traces, videos, and console logs on failure

---

## Summary

This architecture gives RetroBox a reliable, scalable E2E suite with strong multi-browser coverage and deterministic screenshot validation. It supports multi-client orchestration and ensures clean observability for WebSocket and WebRTC events. The result is a resilient testing foundation that makes it easy to add new scenarios while keeping core kiosk functionality stable.
