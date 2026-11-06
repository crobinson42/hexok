import { EventHandler } from 'hexok';
import { PostUnpublishedEvent } from '../../../../domain/events/post-unpublished.js';
import {
  BLOG_ORGANIZATION,
  SubscriberPostUnpublishedWebhook,
} from '../../../../domain/events/webhook-events.js';
import type { WebhookPublisher } from '../../../ports/events/webhook-publisher.js';

/** One publish. The endpoint port fans out to webhook subscribers. */
export class SubscriberPostUnpublishedWebhookHandler extends EventHandler(
  'webhooks.subscriber-post-unpublished',
  PostUnpublishedEvent,
) {
  constructor(private readonly deps: { webhooks: WebhookPublisher }) {
    super();
  }

  async handle(event: PostUnpublishedEvent): Promise<void> {
    await this.deps.webhooks.publish({
      organizationId: BLOG_ORGANIZATION,
      eventId: `${SubscriberPostUnpublishedWebhook.token}:${event.payload.postId}`,
      event: new SubscriberPostUnpublishedWebhook({
        postId: event.payload.postId,
        title: event.payload.title,
      }),
    });
  }
}
