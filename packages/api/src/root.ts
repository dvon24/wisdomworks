import { router } from './trpc';
import { testSeedRouter } from './routers/test-seed';

export const appRouter = router({
  testSeed: testSeedRouter,
  // Routers added by later stories:
  // entities, relationships, signals, agents, governance, search, audit, metering
});

export type AppRouter = typeof appRouter;
