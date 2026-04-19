/**
 * CacheProvider — abstract caching interface.
 * MVP: implemented with NATS JetStream KV store.
 * Growth: swap to Redis/Valkey without application changes.
 */
export interface CacheProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
