import type { Webhooks } from '@hexok/webhooks';
import type { EventInstance } from 'hexok';
import type { WebhookEvents } from '../../../domain/events/webhook-events.js';

/** What a handler needs of the sender. The worker passes the running `Webhooks`. HTTP does not. */
export type WebhookPublisher = Pick<
  Webhooks<EventInstance<typeof WebhookEvents>>,
  'publish'
>;
