import type { Adapter } from '@auth/core/adapters';

/**
 * Creates a lazy Drizzle adapter that only connects to the database
 * when an actual auth operation is performed — not at import/config time.
 * This prevents crashes during Next.js static build when DATABASE_URL is unavailable.
 */
export function createDrizzleAdapter(): Adapter {
  let _adapter: Adapter | null = null;

  function getAdapter(): Adapter {
    if (!_adapter) {
      const { DrizzleAdapter } = require('@auth/drizzle-adapter');
      const { getDb } = require('@wisdomworks/db');
      _adapter = DrizzleAdapter(getDb()) as Adapter;
    }
    return _adapter;
  }

  return new Proxy({} as Adapter, {
    get(_, prop: string) {
      const adapter = getAdapter();
      const value = (adapter as any)[prop];
      if (typeof value === 'function') {
        return value.bind(adapter);
      }
      return value;
    },
  });
}
