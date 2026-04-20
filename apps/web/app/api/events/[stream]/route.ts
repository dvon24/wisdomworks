import { connect, DeliverPolicy, type NatsConnection } from 'nats';
import { auth } from '@wisdomworks/auth';

export const dynamic = 'force-dynamic';

// Shared NATS connection for SSE bridge — avoids per-request connection leak
let _sseConnection: NatsConnection | null = null;
async function getSSEConnection(): Promise<NatsConnection> {
  if (!_sseConnection || _sseConnection.isClosed()) {
    _sseConnection = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
  }
  return _sseConnection;
}

const ALLOWED_STREAMS = new Set(['signals', 'ontology', 'governance', 'agents']);
const STREAM_MAP: Record<string, string> = {
  signals: 'SIGNALS',
  ontology: 'ONTOLOGY',
  governance: 'GOVERNANCE',
  agents: 'AGENTS',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stream: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const tenantId = (session as any).tenantId;
  if (!tenantId) {
    return new Response('No tenant', { status: 403 });
  }

  const { stream } = await params;
  if (!ALLOWED_STREAMS.has(stream)) {
    return new Response('Invalid stream', { status: 400 });
  }

  const subject = `${stream}.${tenantId}.>`;
  const streamName = STREAM_MAP[stream]!;
  const consumerName = `sse-${tenantId}-${stream}-${Date.now()}`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let nc: NatsConnection | null = null;
      let messages: { stop: () => void; [Symbol.asyncIterator]: () => AsyncIterator<any> } | null = null;
      try {
        nc = await getSSEConnection();
        const js = nc.jetstream();
        const jsm = await nc.jetstreamManager();

        // Create ephemeral consumer for this SSE session
        await jsm.consumers.add(streamName, {
          name: consumerName,
          filter_subject: subject,
          deliver_policy: DeliverPolicy.New,
          inactive_threshold: 30_000_000_000, // 30s — auto-cleanup on disconnect
        });

        const consumer = await js.consumers.get(streamName, consumerName);
        messages = await consumer.consume();

        request.signal.addEventListener('abort', () => {
          messages?.stop();
        });

        for await (const msg of messages) {
          const text = new TextDecoder().decode(msg.data);
          controller.enqueue(encoder.encode(`data: ${text}\n\n`));
          msg.ack();
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Stream connection failed' })}\n\n`),
        );
      } finally {
        messages?.stop();
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
