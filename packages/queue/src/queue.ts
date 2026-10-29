import { Port } from 'hexok';

export type QueueDisposition = 'ack' | 'retry' | 'drop';

/** A positive integer, or `'unlimited'` to retry without a ceiling. */
export type QueueMaxDeliveries = number | 'unlimited';

export interface QueueMessage<T> {
  readonly id: string;
  readonly topic: string;
  readonly payload: T;
  /**
   * 1-based count of handoffs of this entry, including this one.
   * Includes a handoff a crashed consumer never acknowledged.
   * Stored with the entry, not in the process.
   */
  readonly deliveries: number;
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
  /** Positive integer, or `'unlimited'`. No default. */
  readonly maxDeliveries: QueueMaxDeliveries;
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

/** Throws `queue: maxDeliveries must be a positive integer or "unlimited"`. */
export function assertMaxDeliveries(value: QueueMaxDeliveries): void {
  if (value === 'unlimited') return;
  if (Number.isSafeInteger(value) && value >= 1) return;
  throw new Error(
    'queue: maxDeliveries must be a positive integer or "unlimited"',
  );
}

/** This handoff may run. `'unlimited'` is always true. */
export function deliveryAllowed(
  deliveries: number,
  maxDeliveries: QueueMaxDeliveries,
): boolean {
  return maxDeliveries === 'unlimited' || deliveries <= maxDeliveries;
}

/** A `'retry'` on this handoff is the last one. */
export function retryExhausted(
  deliveries: number,
  maxDeliveries: QueueMaxDeliveries,
): boolean {
  return maxDeliveries !== 'unlimited' && deliveries >= maxDeliveries;
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
