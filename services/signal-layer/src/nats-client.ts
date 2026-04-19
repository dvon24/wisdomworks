import { connect, NatsConnection, JetStreamManager, JetStreamClient, headers } from 'nats';
import type { DomainEvent } from '@wisdomworks/shared';

let _connectionPromise: Promise<NatsConnection> | null = null;
let _connection: NatsConnection | null = null;
let _jsm: JetStreamManager | null = null;
let _js: JetStreamClient | null = null;

export async function getNatsConnection(): Promise<NatsConnection> {
  if (_connection && !_connection.isClosed()) {
    return _connection;
  }

  // Reset derived references when reconnecting
  _jsm = null;
  _js = null;

  // Race-safe: reuse the same connection promise if one is in-flight
  if (!_connectionPromise) {
    _connectionPromise = connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' })
      .then((nc) => {
        _connection = nc;
        _connectionPromise = null;
        return nc;
      })
      .catch((err) => {
        _connectionPromise = null;
        throw err;
      });
  }

  return _connectionPromise;
}

export async function getJetStreamManager(): Promise<JetStreamManager> {
  if (!_jsm) {
    const nc = await getNatsConnection();
    _jsm = await nc.jetstreamManager();
  }
  return _jsm;
}

export async function getJetStream(): Promise<JetStreamClient> {
  if (!_js) {
    const nc = await getNatsConnection();
    _js = nc.jetstream();
  }
  return _js;
}

/**
 * Publish a DomainEvent to NATS JetStream.
 * Sets Nats-Msg-Id header for built-in duplicate detection.
 */
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  const js = await getJetStream();
  const hdrs = headers();
  hdrs.set('Nats-Msg-Id', event.id); // dedup key

  const payload = JSON.stringify(event);
  await js.publish(event.type, new TextEncoder().encode(payload), { headers: hdrs });
}

export async function closeConnection(): Promise<void> {
  if (_connection) {
    await _connection.drain();
    _connection = null;
    _jsm = null;
    _js = null;
    _connectionPromise = null;
  }
}
