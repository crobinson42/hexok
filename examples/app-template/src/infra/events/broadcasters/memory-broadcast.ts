import {
  Broadcast,
  type BroadcastHandler,
  type Channel,
} from '@hexok/broadcast';
import { Adapter } from 'hexok';

/** In-process broadcast for tests and a single process. Handlers run in order. */
export class MemoryBroadcast extends Adapter(Broadcast) {
  readonly #handlers = new Map<string, Set<BroadcastHandler<unknown>>>();

  override async publish<Name extends string, T>(
    channel: Channel<Name, T>,
    payload: T,
  ): Promise<void> {
    for (const handler of this.#handlers.get(channel.name) ?? []) {
      await handler({ channel: channel.name, payload });
    }
  }

  override async subscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    const set = this.#handlers.get(channel.name) ?? new Set();
    set.add(handler as BroadcastHandler<unknown>);
    this.#handlers.set(channel.name, set);
  }

  override async unsubscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void> {
    this.#handlers
      .get(channel.name)
      ?.delete(handler as BroadcastHandler<unknown>);
  }

  /** Handlers on `channel`. */
  count(channel: Channel<string, unknown>): number {
    return this.#handlers.get(channel.name)?.size ?? 0;
  }
}
