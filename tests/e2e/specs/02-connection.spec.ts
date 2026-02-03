import { test, expect } from '../fixtures';
import { expectConnectedPlayers, expectNoConsoleErrors } from '../utils/assertions';

test.describe('Controller Connection', () => {
  test('controller connects as P1', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();
    const controller = await orchestrator.createController();

    await controller.waitForConnected();
    await screen.waitForControllerConnected(0);

    const playerNum = await controller.getPlayerNumber();
    expect(playerNum).toBe(0);

    await expectConnectedPlayers(screen, 1);

    expectNoConsoleErrors(orchestrator, [/WakeLock/i]);
  });

  test('P2P connection establishes and reports ping', async ({ orchestrator }) => {
    await orchestrator.createScreen();
    const controller = await orchestrator.createController();

    await controller.waitForConnected();
    await controller.waitForP2PConnected();

    await expect(controller.statusDot).toHaveClass(/p2p/);
    await expect(controller.pingBadge).toContainText(/\d+ms/, { timeout: 10000 });
  });

  test('second controller connects as P2 after P1', async ({ orchestrator }) => {
    const screen = await orchestrator.createScreen();

    // Connect first controller as P1
    const controller1 = await orchestrator.createController(0);
    await controller1.waitForConnected();
    await screen.waitForControllerConnected(0);

    // Verify P1 indicator on controller 1
    const p1Num = await controller1.getPlayerNumber();
    expect(p1Num).toBe(0);
    await expect(controller1.statusDot).toHaveClass(/player-0/);

    // Connect second controller as P2
    const controller2 = await orchestrator.createController(1);
    await controller2.waitForConnected();
    await screen.waitForControllerConnected(1);

    // Verify P2 indicator on controller 2
    const p2Num = await controller2.getPlayerNumber();
    expect(p2Num).toBe(1);
    await expect(controller2.statusDot).toHaveClass(/player-1/);

    // Verify screen shows both controllers connected
    await expectConnectedPlayers(screen, 2);

    // Verify both controller dots are active on screen
    const dot0 = screen.controllerDots.nth(0);
    const dot1 = screen.controllerDots.nth(1);
    await expect(dot0).toHaveClass(/active/);
    await expect(dot0).toHaveClass(/player-0/);
    await expect(dot1).toHaveClass(/active/);
    await expect(dot1).toHaveClass(/player-1/);

    expectNoConsoleErrors(orchestrator, [/WakeLock/i]);
  });
});
