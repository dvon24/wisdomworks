import { router } from './trpc';

// Conditionally import testSeedRouter only in test environment to prevent
// test utilities from shipping to production.
const testSeedRouter =
  process.env.NODE_ENV === 'test'
    ? require('./routers/test-seed').testSeedRouter
    : undefined;

export const appRouter = router({
  ...(testSeedRouter ? { testSeed: testSeedRouter } : {}),
  // Routers added by later stories:
  // entities, relationships, signals, agents, governance, search, audit, metering
});

export type AppRouter = typeof appRouter;
