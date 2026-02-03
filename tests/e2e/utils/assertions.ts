import { expect } from '@playwright/test';
import type { RetroBoxOrchestrator } from '../core/RetroBoxOrchestrator';
import type { ScreenClient } from '../core/ScreenClient';

export function expectNoConsoleErrors(
  orchestrator: RetroBoxOrchestrator,
  ignoredPatterns?: RegExp[]
): void {
  const errors = orchestrator.getConsoleErrors(ignoredPatterns);
  const formatted = errors
    .map((entry) => `${entry.source}: ${entry.errors.join('\n')}`)
    .join('\n');
  expect(errors.length, formatted || 'No console errors').toBe(0);
}

export async function expectConnectedPlayers(
  screen: ScreenClient,
  count: number
): Promise<void> {
  const actual = await screen.getConnectedPlayerCount();
  expect(actual).toBe(count);
}
