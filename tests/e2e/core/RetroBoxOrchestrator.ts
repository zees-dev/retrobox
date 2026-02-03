import type { Browser, BrowserContext } from '@playwright/test';
import { ConsoleCollector } from './ConsoleCollector';
import { ControllerClient } from './ControllerClient';
import { ScreenClient } from './ScreenClient';
import type { OrchestratorConfig } from './types';

export class RetroBoxOrchestrator {
  private browser: Browser;
  private config: OrchestratorConfig;

  public screen: ScreenClient | null = null;
  public controllers: Map<number, ControllerClient> = new Map();
  public consoleCollector: ConsoleCollector;

  private screenContext: BrowserContext | null = null;
  private controllerContext: BrowserContext | null = null;

  constructor(browser: Browser, config: OrchestratorConfig) {
    this.browser = browser;
    this.config = config;
    this.consoleCollector = new ConsoleCollector();
  }

  async createScreen(): Promise<ScreenClient> {
    if (this.screen) return this.screen;

    this.screenContext = await this.browser.newContext({
      viewport: this.config.screenViewport ?? { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await this.screenContext.newPage();
    this.consoleCollector.attach(page, 'screen');

    this.screen = new ScreenClient(page, this.config.serverUrl);
    await this.screen.navigate();

    return this.screen;
  }

  async createController(playerNum?: number): Promise<ControllerClient> {
    if (!this.screen) {
      throw new Error('Screen must be created before controllers');
    }

    if (!this.controllerContext) {
      this.controllerContext = await this.browser.newContext({
        viewport: this.config.controllerViewport ?? { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      });
    }

    const page = await this.controllerContext.newPage();
    const baseControllerUrl = await this.screen.getControllerUrl();

    const nextPlayerNum = playerNum ?? this.controllers.size;
    const controllerUrl = this.withPlayer(baseControllerUrl, nextPlayerNum);

    this.consoleCollector.attach(page, `controller-${nextPlayerNum}`);
    const controller = new ControllerClient(page, controllerUrl, nextPlayerNum);
    await controller.navigate();

    this.controllers.set(nextPlayerNum, controller);
    return controller;
  }

  async waitForAllControllersConnected(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [playerNum, controller] of this.controllers) {
      promises.push(controller.waitForConnected());
      promises.push(this.screen!.waitForControllerConnected(playerNum));
    }

    await Promise.all(promises);
  }

  getConsoleErrors(ignoredPatterns?: RegExp[]): { source: string; errors: string[] }[] {
    return this.consoleCollector.getErrors(ignoredPatterns);
  }

  hasConsoleErrors(ignoredPatterns?: RegExp[]): boolean {
    return this.consoleCollector.hasErrors(ignoredPatterns);
  }

  async captureScreenshot(name: string): Promise<Buffer> {
    if (!this.screen) throw new Error('No screen available');
    return this.screen.screenshot(name);
  }

  async cleanup(): Promise<void> {
    for (const controller of this.controllers.values()) {
      await controller.close();
    }
    this.controllers.clear();

    if (this.screen) {
      await this.screen.close();
      this.screen = null;
    }

    if (this.screenContext) {
      await this.screenContext.close();
      this.screenContext = null;
    }

    if (this.controllerContext) {
      await this.controllerContext.close();
      this.controllerContext = null;
    }

    this.consoleCollector.clear();
  }

  private withPlayer(url: string, playerNum: number): string {
    try {
      const target = new URL(url);
      if (!target.searchParams.has('p')) {
        target.searchParams.set('p', String(playerNum + 1));
      }
      return target.toString();
    } catch {
      return url;
    }
  }
}
