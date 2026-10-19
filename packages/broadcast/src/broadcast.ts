import { Port } from 'hexok';

export type BroadcastHandler<T> = (message: {
  readonly channel: string;
  readonly payload: T;
}) => void | Promise<void>;

export abstract class Broadcast extends Port('Broadcast') {
  abstract publish(channel: string, payload: unknown): Promise<void>;
  abstract subscribe<T>(
    channel: string,
    handler: BroadcastHandler<T>,
  ): Promise<void>;
  abstract unsubscribe(
    channel: string,
    handler: BroadcastHandler<unknown>,
  ): Promise<void>;
}
