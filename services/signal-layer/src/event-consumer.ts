import { AckPolicy, DeliverPolicy, type JsMsg } from 'nats';
import { v7 as uuid7 } from 'uuid';
import { getJetStream, getJetStreamManager } from './nats-client';
import type { DomainEvent } from '@wisdomworks/shared';
import { domainEventSchema } from '@wisdomworks/shared';
import { publishEvent } from './nats-client';

const MAX_DELIVER = 3;
const BACKOFF_BASE_MS = 1000;

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

/**
 * Subscribe to events on a NATS subject with durable consumer.
 * Handles ack/nak with exponential backoff and dead letter routing.
 */
export async function subscribeToEvents(
  streamName: string,
  subject: string,
  consumerName: string,
  handler: EventHandler,
): Promise<{ unsubscribe: () => Promise<void> }> {
  const jsm = await getJetStreamManager();
  const js = await getJetStream();

  // Create or update durable consumer
  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      filter_subject: subject,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: MAX_DELIVER,
    });
  }

  const consumer = await js.consumers.get(streamName, consumerName);
  const messages = await consumer.consume();

  const processMessages = async () => {
    for await (const msg of messages) {
      try {
        const event = parseMessage(msg);
        await handler(event);
        msg.ack();
      } catch (error) {
        const deliveryCount = msg.info.redeliveryCount ?? 0;

        if (deliveryCount >= MAX_DELIVER - 1) {
          // Max retries exceeded — route to dead letter
          await routeToDeadLetter(msg, error);
          msg.term();
        } else {
          // NAK with exponential backoff
          const delayMs = BACKOFF_BASE_MS * Math.pow(2, deliveryCount);
          msg.nak(delayMs);
        }
      }
    }
  };

  // Start processing in background
  processMessages().catch(console.error);

  return {
    unsubscribe: async () => {
      messages.stop();
    },
  };
}

function parseMessage(msg: JsMsg): DomainEvent {
  const text = new TextDecoder().decode(msg.data);
  const parsed = JSON.parse(text);
  return domainEventSchema.parse(parsed) as DomainEvent;
}

async function routeToDeadLetter(msg: JsMsg, error: unknown): Promise<void> {
  const text = new TextDecoder().decode(msg.data);
  const deadLetterEvent: DomainEvent = {
    id: uuid7(),
    type: `deadletter.${msg.subject}`,
    tenantId: 'system',
    timestamp: new Date().toISOString(),
    source: 'event-consumer',
    data: {
      originalSubject: msg.subject,
      originalPayload: text,
      error: error instanceof Error ? error.message : String(error),
      deliveryCount: msg.info.redeliveryCount,
    },
  };

  try {
    await publishEvent(deadLetterEvent);
  } catch (dlError) {
    console.error('Failed to route to dead letter queue:', dlError);
  }
}
