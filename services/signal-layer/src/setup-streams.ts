import { AckPolicy, RetentionPolicy } from 'nats';
import { getJetStreamManager } from './nats-client';

const STREAMS = [
  { name: 'SIGNALS', subjects: ['signals.>'] },
  { name: 'ONTOLOGY', subjects: ['ontology.>'] },
  { name: 'GOVERNANCE', subjects: ['governance.>'] },
  { name: 'AGENTS', subjects: ['agents.>'] },
  { name: 'DEADLETTER', subjects: ['deadletter.>'] },
];

/**
 * Create JetStream streams for all event domains.
 * Idempotent — safe to call on every startup.
 */
export async function setupStreams(): Promise<void> {
  const jsm = await getJetStreamManager();

  for (const stream of STREAMS) {
    try {
      await jsm.streams.info(stream.name);
      // Stream exists — update subjects if needed
      await jsm.streams.update(stream.name, {
        subjects: stream.subjects,
      });
    } catch {
      // Stream doesn't exist — create it
      await jsm.streams.add({
        name: stream.name,
        subjects: stream.subjects,
        retention: RetentionPolicy.Limits,
        max_msgs: 100_000,
        max_bytes: 100 * 1024 * 1024, // 100MB
        duplicate_window: 5 * 60 * 1_000_000_000, // 5 minutes in nanoseconds
      });
    }
  }
}
