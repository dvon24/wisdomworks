import { sql } from 'drizzle-orm';
import { db } from './client';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const start = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      status: 'healthy',
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (e) {
    return {
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
