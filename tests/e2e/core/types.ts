import type { BrowserContext, Page } from '@playwright/test';

export type ScreenState = 'idle' | 'loading' | 'playing';

export type Viewport = { width: number; height: number };

export type OrchestratorConfig = {
  serverUrl: string;
  screenViewport?: Viewport;
  controllerViewport?: Viewport;
};

export type LogEntry = {
  source: string;
  type: string;
  text: string;
  timestamp: number;
};

export type ConsoleErrorSummary = {
  source: string;
  errors: string[];
};

export type WSMessage = {
  direction: 'sent' | 'received';
  data: any;
  timestamp: number;
};

export type PageSource = {
  page: Page;
  source: string;
};

export type OrchestratorContexts = {
  screenContext: BrowserContext | null;
  controllerContext: BrowserContext | null;
};
