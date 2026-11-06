import { type WebhookEndpoint, WebhookEndpoints } from '@hexok/webhooks';
import { Adapter } from 'hexok';
import type { SubscriberRepository } from '../../app/ports/repos/subscriber-repository.js';
import type { SubscriberEntity } from '../../domain/entities/subscriber.js';
import {
  BLOG_ORGANIZATION,
  isSubscriberWebhookEvent,
} from '../../domain/events/webhook-events.js';
import type { MemoryWebhookEndpoints } from './memory-webhook-endpoints.js';

/**
 * The env endpoint, plus webhook subscribers read from the subscriber store.
 * HTTP saves the subscriber. The worker reads it here, so a restart does not drop the URL.
 * The queue entry carries the subscriber id. The secret stays on the subscriber record.
 */
export class BlogWebhookEndpoints extends Adapter(WebhookEndpoints) {
  constructor(
    private readonly deps: {
      product: MemoryWebhookEndpoints;
      subscribers: SubscriberRepository;
    },
  ) {
    super();
  }

  override async subscribed(
    organizationId: string,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    const product = await this.deps.product.subscribed(
      organizationId,
      eventType,
    );
    if (
      organizationId !== BLOG_ORGANIZATION ||
      !isSubscriberWebhookEvent(eventType)
    ) {
      return product;
    }
    const listed = await this.deps.subscribers.list();
    const subscribers = listed.flatMap((subscriber) => {
      const endpoint = endpointOf(subscriber);
      return endpoint === null ? [] : [endpoint];
    });
    return [...product, ...subscribers];
  }

  override async get(
    organizationId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint | null> {
    const product = await this.deps.product.get(organizationId, endpointId);
    if (product !== null) return product;
    if (organizationId !== BLOG_ORGANIZATION) return null;
    const subscriber = await this.deps.subscribers.getById(endpointId);
    return subscriber === null ? null : endpointOf(subscriber);
  }

  /** The hooks call this when an endpoint answers 410. */
  async disable(organizationId: string, endpointId: string): Promise<void> {
    this.deps.product.disable(organizationId, endpointId);
    if (organizationId !== BLOG_ORGANIZATION) return;
    const subscriber = await this.deps.subscribers.getById(endpointId);
    if (
      subscriber === null ||
      !subscriber.props.channels.includes('webhook') ||
      subscriber.props.webhookDisabled === true
    ) {
      return;
    }
    await this.deps.subscribers.save(subscriber.disableWebhook());
  }
}

function endpointOf(subscriber: SubscriberEntity): WebhookEndpoint | null {
  if (
    subscriber.props.webhookDisabled === true ||
    !subscriber.props.channels.includes('webhook')
  ) {
    return null;
  }
  const url = subscriber.props.webhookUrl;
  const secret = subscriber.props.webhookSecret;
  if (url === undefined || secret === undefined) return null;
  return { id: subscriber.props.id, url, secrets: [secret] };
}
