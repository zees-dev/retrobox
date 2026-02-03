import { expect, type Locator, type Page } from '@playwright/test';

export class ControllerClient {
  readonly page: Page;
  readonly url: string;
  readonly expectedPlayerNum: number;

  readonly statusDot: Locator;
  readonly pingBadge: Locator;
  readonly gameMenu: Locator;
  readonly playerStatus: Locator;

  constructor(page: Page, url: string, expectedPlayerNum: number) {
    this.page = page;
    this.url = url;
    this.expectedPlayerNum = expectedPlayerNum;

    // Use .first() to avoid strict mode violations if multiple elements exist
    this.statusDot = page.locator('#statusDot').first();
    this.pingBadge = page.locator('#pingBadge').first();
    this.gameMenu = page.locator('#gameMenu').first();
    this.playerStatus = page.locator('#playerStatus').first();
  }

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
    await this.page.waitForLoadState('networkidle');
  }

  async waitForConnected(): Promise<void> {
    // Wait for WebSocket connection - statusDot gets 'connected' class
    await expect(this.statusDot).toHaveClass(/connected/, { timeout: 20000 });
    // Wait for player number assignment
    await expect(this.statusDot).toHaveClass(
      new RegExp(`player-${this.expectedPlayerNum}`),
      { timeout: 10000 }
    );
    // Verify playerStatus is visible (opacity: 1)
    await expect(this.playerStatus).toBeVisible({ timeout: 5000 });
  }

  async waitForP2PConnected(timeout: number = 20000): Promise<void> {
    await expect(this.statusDot).toHaveClass(/p2p/, { timeout });
  }

  async isConnected(): Promise<boolean> {
    const classes = await this.statusDot.getAttribute('class');
    return classes?.includes('connected') ?? false;
  }

  async getPlayerNumber(): Promise<number | null> {
    const text = await this.statusDot.textContent();
    const match = text?.match(/P(\d)/);
    return match ? parseInt(match[1], 10) - 1 : null;
  }

  async selectGame(gameName: string): Promise<void> {
    const allGamesSelect = this.gameMenu.locator('#allGamesSelect');
    await allGamesSelect.selectOption({ label: gameName });
  }

  async selectGameByCore(core: string, playerCount: string, gameName: string): Promise<void> {
    const coreSelect = this.gameMenu.locator('#coreSelect');
    const playerCountSelect = this.gameMenu.locator('#playerCountSelect');
    const gameSelect = this.gameMenu.locator('#gameSelect');

    await coreSelect.selectOption(core);
    await playerCountSelect.selectOption(playerCount);
    await gameSelect.selectOption({ label: gameName });
  }

  async clickStart(): Promise<void> {
    const startButton = this.gameMenu.locator('#startButton');
    await expect(startButton).toBeEnabled();
    await startButton.click();
  }

  async waitForGameControls(): Promise<void> {
    await this.page.waitForFunction(
      () => !!(window as any).EJS_emulator,
      { timeout: 60000 }
    );
  }

  async pressButton(button: number): Promise<void> {
    await this.page.evaluate((btn) => {
      const emulator = (window as any).EJS_emulator;
      emulator?.handler?.exec('input.simulate', {
        button: btn,
        state: 'pressed',
        player: 0,
      });
    }, button);
  }

  async releaseButton(button: number): Promise<void> {
    await this.page.evaluate((btn) => {
      const emulator = (window as any).EJS_emulator;
      emulator?.handler?.exec('input.simulate', {
        button: btn,
        state: 'released',
        player: 0,
      });
    }, button);
  }

  async clickSaveState(): Promise<void> {
    const saveButton = this.page.locator('[data-btn="remoteSave"]');
    await saveButton.click();
  }

  async clickLoadState(): Promise<void> {
    const loadButton = this.page.locator('[data-btn="remoteLoad"]');
    await loadButton.click();
  }

  async clickResetToMenu(): Promise<void> {
    const menuButton = this.page.locator('[data-btn="home"]');
    await menuButton.click();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
