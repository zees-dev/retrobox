import { test, expect } from '../fixtures';
import { expectNoConsoleErrors } from '../utils/assertions';

test.describe('Screen Initialization', () => {
  test('screen loads and displays QR code', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();

    // Wait for WebSocket connection and QR code
    await screen.waitForQRCode();

    // Verify controller URL is available
    const controllerUrl = await screen.getControllerUrl();
    expect(controllerUrl).toContain('/controller.html');
    expect(controllerUrl).toMatch(/screen=/);

    expectNoConsoleErrors(orchestrator, [
      /WakeLock/i,
      /SharedArrayBuffer/i,
      /Cross-Origin-Opener-Policy/i,
      /DataChannel error/i,
    ]);
  });

  test('4 controller slots are displayed', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();

    const dots = await screen.controllerDots.all();
    expect(dots).toHaveLength(4);

    for (const dot of dots) {
      await expect(dot).not.toHaveClass(/active/);
    }
  });
});
