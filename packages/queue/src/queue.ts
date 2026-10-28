import { Port } from 'hexok';

export type QueueDisposition = 'ack' | 'retry' | 'drop';

export interface QueueMessage<T> {
  readonly id: string;
  readonly topic: string;
  readonly payload: T;
}

export type QueueHandler<T> = (
  message: QueueMessage<T>,
) => Promise<QueueDisposition | void>;

export type QueueStartFrom =
  | 'earliest'
  | 'now'
  | { readonly afterTimestampMs: number }
  | { readonly afterStreamId: string };

export interface QueueSubscribeOptions<T> {
  readonly consumerGroup: string;
  readonly startFrom?: QueueStartFrom;
  readonly onError?: QueueDisposition;
  readonly handler: QueueHandler<T>;
}

/** `sensitive` keeps the payload out of quarantine and logs. Use it for one-time codes and reset links. */
export interface QueuePublishOptions {
  readonly sensitive?: boolean;
}

export abstract class Queue extends Port('Queue') {
  abstract publish(
    topic: string,
    payload: unknown,
    options?: QueuePublishOptions,
  ): Promise<string>;
  abstract subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void>;
  abstract unsubscribe(
    topic: string,
    options: { readonly consumerGroup: string },
  ): Promise<void>;
}

/** Returned value wins. `void` acknowledges. A throw uses `onError`, default `retry`. */
export function dispositionOf(
  returned: QueueDisposition | void,
  thrown: boolean,
  onError: QueueDisposition = 'retry',
): QueueDisposition {
  if (thrown) return onError;
  if (returned === undefined) return 'ack';
  return returned;
}
