import { test as base } from './base.fixture';
import { RetroBoxOrchestrator } from '../core/RetroBoxOrchestrator';

export type OrchestratorFixtures = {
  orchestrator: RetroBoxOrchestrator;
};

export const test = base.extend<OrchestratorFixtures>({
  orchestrator: async ({ browser, serverUrl }, use) => {
    const orchestrator = new RetroBoxOrchestrator(browser, { serverUrl });
    await use(orchestrator);
    await orchestrator.cleanup();
  },
});
