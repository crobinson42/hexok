import type { Queue, QueueDisposition } from '@hexok/queue';
import { CodedError } from 'hexok';

/**
 * One constructed event handler. `handle` is typed `never` so a mixed array
 * still passes. The cast stays in {@link subscribeHandler}.
 */
export type QueueEventHandler = {
  readonly token: string;
  readonly event: {
    readonly token: string;
  };
  handle(event: never): Promise<void> | void;
};

/**
 * Subscribe one handler. The topic is the event token. The consumer group is
 * a static `group` on the class, or the handler token. A payload the event
 * schema rejects is `drop`. A throw from `handle` propagates so the queue
 * can retry.
 */
/**
 * Throw when two different handler classes would compete on one topic.
 * Same class twice is left to the queue. Different topics do not interact.
 */
export function assertDistinctHandlerGroups(
  handlers: readonly QueueEventHandler[],
): void {
  const seen = new Map<string, QueueEventHandler>();
  for (const handler of handlers) {
    const topic = handler.event.token;
    const group = groupOf(handler);
    const key = `${topic}\0${group}`;
    const previous = seen.get(key);
    if (
      previous !== undefined &&
      previous.constructor !== handler.constructor
    ) {
      throw new Error(
        `${label(previous)} and ${label(handler)} both consume topic "${topic}" group "${group}"`,
      );
    }
    seen.set(key, handler);
  }
}

/**
 * Subscribe one handler. The topic is the event token. The consumer group is
 * a static `group` on the class, or the handler token. A payload the event
 * schema rejects is `drop`. A throw from `handle` propagates so the queue
 * can retry.
 * @param queue
 * @param handler
 */
export async function subscribeHandler(
  queue: Queue,
  handler: QueueEventHandler,
): Promise<{ topic: string; group: string }> {
  const topic = handler.event.token;
  const group = groupOf(handler);
  await queue.subscribe(topic, {
    consumerGroup: group,
    handler: (message) => deliver(handler, message.payload),
  });
  return { topic, group };
}

export async function deliver(
  handler: QueueEventHandler,
  payload: unknown,
): Promise<QueueDisposition> {
  let event: object;
  try {
    event = parseEvent(handler, payload);
  } catch (error) {
    if (error instanceof CodedError) return 'drop';
    throw error;
  }
  await handler.handle(event as never);
  return 'ack';
}

function parseEvent(handler: QueueEventHandler, payload: unknown): object {
  const event = handler.event as unknown as {
    parse(value: unknown): object;
  };
  return event.parse(payload);
}

function label(handler: QueueEventHandler): string {
  const name = handler.constructor.name;
  return `${name === '' ? 'handler' : name} (${handler.token})`;
}

function groupOf(handler: { readonly token: string }): string {
  const ctor: unknown = handler.constructor;
  if (typeof ctor !== 'function' || !('group' in ctor)) return handler.token;
  const group = ctor.group;
  if (typeof group !== 'string' || group === '') return handler.token;
  return group;
}
