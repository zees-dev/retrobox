import type { ConsoleMessage, Page } from '@playwright/test';
import type { ConsoleErrorSummary, LogEntry } from './types';

export class ConsoleCollector {
  private logs: LogEntry[] = [];
  private attachedPages: Map<Page, string> = new Map();

  attach(page: Page, source: string): void {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.set(page, source);

    page.on('console', (msg: ConsoleMessage) => {
      this.logs.push({
        source,
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });

    page.on('pageerror', (error: Error) => {
      this.logs.push({
        source,
        type: 'pageerror',
        text: error.stack ? `${error.message}\n${error.stack}` : error.message,
        timestamp: Date.now(),
      });
    });
  }

  getAll(): LogEntry[] {
    return [...this.logs];
  }

  getBySource(source: string): LogEntry[] {
    return this.logs.filter((log) => log.source === source);
  }

  getErrors(ignoredPatterns?: RegExp[]): ConsoleErrorSummary[] {
    const errorTypes = new Set(['error', 'pageerror']);
    const errorsBySource = new Map<string, string[]>();

    for (const log of this.logs) {
      if (!errorTypes.has(log.type)) continue;
      if (ignoredPatterns?.some((pattern) => pattern.test(log.text))) continue;

      if (!errorsBySource.has(log.source)) {
        errorsBySource.set(log.source, []);
      }
      errorsBySource.get(log.source)!.push(log.text);
    }

    return Array.from(errorsBySource.entries()).map(([source, errors]) => ({
      source,
      errors,
    }));
  }

  hasErrors(ignoredPatterns?: RegExp[]): boolean {
    return this.getErrors(ignoredPatterns).some((entry) => entry.errors.length > 0);
  }

  clear(): void {
    this.logs = [];
    this.attachedPages.clear();
  }
}
