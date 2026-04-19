import type { KV } from 'nats';
import { getNatsConnection } from './nats-client';
import type { CacheProvider } from '@wisdomworks/shared';

/**
 * CacheProvider implementation using NATS JetStream KV store.
 * Swappable to Redis at Growth without application changes.
 */
export class NatsKVCache implements CacheProvider {
  private kv: KV | null = null;
  private bucketName: string;

  constructor(bucketName = 'wisdomworks_cache') {
    this.bucketName = bucketName;
  }

  private async getKV(): Promise<KV> {
    if (!this.kv) {
      const nc = await getNatsConnection();
      const js = nc.jetstream();
      try {
        this.kv = await js.views.kv(this.bucketName);
      } catch {
        this.kv = await js.views.kv(this.bucketName, { history: 1 });
      }
    }
    return this.kv;
  }

  async get(key: string): Promise<string | null> {
    const kv = await this.getKV();
    try {
      const entry = await kv.get(key);
      if (!entry || entry.operation === 'DEL' || entry.operation === 'PURGE') {
        return null;
      }
      return new TextDecoder().decode(entry.value);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      console.warn(
        `[NatsKVCache] Per-key TTL (${ttlSeconds}s) requested but NATS KV only supports bucket-level TTL. Entry will not auto-expire. Use Redis CacheProvider at Growth for per-key TTL.`,
      );
    }
    const kv = await this.getKV();
    await kv.put(key, new TextEncoder().encode(value));
  }

  async delete(key: string): Promise<void> {
    const kv = await this.getKV();
    await kv.delete(key);
  }
}
