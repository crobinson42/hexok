import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import {
  BLOG_ORGANIZATION,
  SubscriberPostPublishedWebhook,
} from '../../../../domain/events/webhook-events.js';
import type { WebhookPublisher } from '../../../ports/events/webhook-publisher.js';

/**
 * One publish when subscribers should be told. The endpoint port fans out to webhook subscribers.
 * The `eventId` is not the product webhook's id, so a receiver does not dedupe one against the other.
 */
export class SubscriberPostPublishedWebhookHandler extends EventHandler(
  'webhooks.subscriber-post-published',
  PostPublishedEvent,
) {
  constructor(private readonly deps: { webhooks: WebhookPublisher }) {
    super();
  }

  async handle(event: PostPublishedEvent): Promise<void> {
    if (!event.payload.emailSubscribers) return;
    await this.deps.webhooks.publish({
      organizationId: BLOG_ORGANIZATION,
      eventId: `${SubscriberPostPublishedWebhook.token}:${event.payload.postId}`,
      event: new SubscriberPostPublishedWebhook({
        postId: event.payload.postId,
        title: event.payload.title,
      }),
    });
  }
}
