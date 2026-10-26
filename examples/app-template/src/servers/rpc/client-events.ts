import type { Broadcast, BroadcastHandler } from '@hexok/broadcast';
import { createPushQueue } from '@ts-pf/message';
import type { EventMessage } from 'hexok';
import { ClientEvents } from '../../domain/events/client-events.js';
import { clientEventsChannel } from '../../infra/events/broadcasters/client-events-channel.js';

/** `{ key, payload }`. `key` narrows `payload`. */
export type ClientEventMessage = EventMessage<typeof ClientEvents>;

export type ClientEventKey = ClientEventMessage['key'];

export const clientEventKeys = Object.keys(ClientEvents.events) as [
  ClientEventKey,
  ...ClientEventKey[],
];

/**
 * Client events from the broadcast channel, from now until the reader stops.
 * Omit `keys` to receive the whole catalog. ts-pf calls `return()` when the
 * client cancels or disconnects, which unsubscribes.
 */
export function clientEventStream(
  broadcast: Broadcast,
  keys?: readonly ClientEventKey[],
): AsyncIterableIterator<ClientEventMessage> {
  const messages = createPushQueue<ClientEventMessage>();
  const handler: BroadcastHandler<ClientEventMessage> = ({ payload }) => {
    // Throws on a message the catalog rejects. The broadcast logs it.
    ClientEvents.parse(payload);
    // An audience check, such as rooms, tenants, or per-user rules, goes here.
    if (keys === undefined || keys.includes(payload.key)) {
      messages.push(payload);
    }
  };
  const subscribed = broadcast.subscribe(clientEventsChannel, handler);
  const pull = messages[Symbol.asyncIterator]();

  return {
    async next() {
      await subscribed;
      return pull.next();
    },
    // Ends the queue, so a pending `next()` settles. An async generator
    // would wait for the next event before it could return.
    async return() {
      messages.end();
      await broadcast.unsubscribe(clientEventsChannel, handler);
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
