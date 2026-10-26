import { Port } from 'hexok';

declare const payload: unique symbol;

/**
 * Named broadcast channel. `Payload` is not stored. It types `publish` and `subscribe`.
 *
 * ```ts
 * const news = channel<{ id: string }>('news');
 * await broadcast.publish(news, { id: '1' });
 * ```
 */
export interface Channel<Name extends string, Payload> {
  readonly name: Name;
  /** Phantom. Not present at runtime. */
  readonly [payload]?: Payload;
}

/**
 * Channel token. `Name` is the broker name. `Payload` is what `publish` accepts
 * and what a subscriber receives. Two modules share a channel by importing the same token.
 */
export function channel<Payload = unknown, const Name extends string = string>(
  name: Name,
): Channel<Name, Payload> {
  return { name };
}

export type BroadcastHandler<T, Name extends string = string> = (message: {
  readonly channel: Name;
  readonly payload: T;
}) => void | Promise<void>;

export abstract class Broadcast extends Port('Broadcast') {
  abstract publish<Name extends string, T>(
    channel: Channel<Name, T>,
    payload: T,
  ): Promise<void>;

  abstract subscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void>;

  abstract unsubscribe<Name extends string, T>(
    channel: Channel<Name, T>,
    handler: BroadcastHandler<T, Name>,
  ): Promise<void>;
}
