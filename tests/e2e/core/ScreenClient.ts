import { expect, type Locator, type Page } from '@playwright/test';
import type { ScreenState } from './types';

export class ScreenClient {
  readonly page: Page;
  readonly baseUrl: string;

  readonly qrContainer: Locator;
  readonly qrCodeDisplay: Locator;
  readonly qrUrl: Locator;
  readonly controllerDots: Locator;
  readonly gameContainer: Locator;
  readonly pauseOverlay: Locator;
  readonly status: Locator;
  readonly gameMenu: Locator;
  readonly gameMenuContainer: Locator;
  readonly gameMenuLoading: Locator;

  constructor(page: Page, baseUrl: string) {
    this.page = page;
    this.baseUrl = baseUrl;

    this.qrContainer = page.locator('#qrContainer');
    this.qrCodeDisplay = page.locator('#qrCodeDisplay');
    this.qrUrl = page.locator('#qrUrl');
    this.controllerDots = page.locator('.controller-dot');
    this.gameContainer = page.locator('.game-container');
    this.pauseOverlay = page.locator('#pauseOverlay');
    this.status = page.locator('#status');
    this.gameMenu = page.locator('#gameMenu');
    this.gameMenuContainer = this.gameMenu.locator('.game-controls');
    this.gameMenuLoading = this.gameMenu.locator('#loadingOverlay');
  }

  async navigate(): Promise<void> {
    const url = this.withE2EFlag(this.baseUrl);
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  async getControllerUrl(): Promise<string> {
    // Wait for actual controller URL, not just any href (initial is "#")
    await expect(this.qrUrl).toHaveAttribute('href', /controller\.html/, { timeout: 15000 });
    const href = await this.qrUrl.getAttribute('href');
    if (!href) throw new Error('Controller URL not found');
    return this.withE2EFlag(href);
  }

  async waitForQRCode(): Promise<void> {
    // Wait for status to show connected/ready first
    await expect(this.status).toContainText(/Ready/i, { timeout: 15000 });
    // Ensure QR container is not hidden
    await expect(this.qrContainer).not.toHaveClass(/hidden/, { timeout: 5000 });
    await expect(this.qrCodeDisplay).toBeVisible();
    // QR code is rendered as canvas or img - check it exists, not necessarily visible
    const qrElement = this.qrCodeDisplay.locator('canvas, img, svg').first();
    await expect(qrElement).toBeAttached({ timeout: 10000 });
  }

  async waitForControllerConnected(playerNum: number): Promise<void> {
    const dot = this.controllerDots.nth(playerNum);
    await expect(dot).toHaveClass(/active/, { timeout: 15000 });
    await expect(dot).toHaveClass(new RegExp(`player-${playerNum}`));
  }

  async waitForControllerDisconnected(playerNum: number): Promise<void> {
    const dot = this.controllerDots.nth(playerNum);
    await expect(dot).not.toHaveClass(/active/, { timeout: 15000 });
  }

  async getConnectedPlayerCount(): Promise<number> {
    const dots = await this.controllerDots.all();
    let count = 0;
    for (const dot of dots) {
      const classes = await dot.getAttribute('class');
      if (classes?.includes('active')) count += 1;
    }
    return count;
  }

  async waitForGameMenuVisible(): Promise<void> {
    await expect(this.gameMenuContainer).toBeVisible();
    await expect(this.gameMenuContainer).not.toHaveClass(/hidden/);
  }

  async waitForGameLoading(): Promise<void> {
    await expect(this.gameMenuLoading).toHaveClass(/active/, { timeout: 15000 });
  }

  async waitForGamePlaying(): Promise<void> {
    await this.page.waitForFunction(
      () => (window as any).EJS_emulator?.started === true,
      { timeout: 60000 }
    );
  }

  async getCurrentState(): Promise<ScreenState> {
    const emulatorStarted = await this.page.evaluate(
      () => (window as any).EJS_emulator?.started === true
    );
    if (emulatorStarted) return 'playing';

    const qrHidden = await this.qrContainer.evaluate((el) =>
      el.classList.contains('hidden')
    );

    return qrHidden ? 'loading' : 'idle';
  }

  async isPaused(): Promise<boolean> {
    return this.pauseOverlay.evaluate((el) => el.classList.contains('visible'));
  }

  async screenshot(name: string): Promise<Buffer> {
    const path = `test-results/screenshots/${name}.png`;
    return this.gameContainer.screenshot({ path });
  }

  async close(): Promise<void> {
    await this.page.close();
  }

  private withE2EFlag(url: string): string {
    try {
      const target = new URL(url);
      if (!target.searchParams.has('e2e')) {
        target.searchParams.set('e2e', '1');
      }
      return target.toString();
    } catch {
      return url;
    }
  }
}
