import { test, expect } from '../fixtures';
import { TEST_GAMES } from '../utils/testData';
import { expectNoConsoleErrors } from '../utils/assertions';

test.describe('Game Launch', () => {
  test('controller can start a game and screen plays', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();

    await controller.waitForConnected();

    await controller.selectGameByCore(
      TEST_GAMES.QUICK_LOAD.core,
      TEST_GAMES.QUICK_LOAD.playerCount,
      TEST_GAMES.QUICK_LOAD.name
    );
    await controller.clickStart();

    await screen.waitForGamePlaying();
    await controller.waitForGameControls();

    await expect(screen.qrContainer).toHaveClass(/hidden/);

    const screenshot = await screen.screenshot('game-launch');
    expect(screenshot.length).toBeGreaterThan(0);

    expectNoConsoleErrors(orchestrator, [
      /WakeLock/i,
      /SharedArrayBuffer/i,
      /Cross-Origin-Opener-Policy/i,
      /DataChannel error/i,
      /WebRTC/i,
      /has already been declared/i,  // EmulatorJS duplicate declarations on re-init
    ]);
  });
});
