import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { SubscriberRepository } from '../../app/ports/repos/subscriber-repository.js';
import { SubscriberEntity } from '../../domain/entities/subscriber.js';
import {
  BLOG_ORGANIZATION,
  SubscriberPostPublishedWebhook,
} from '../../domain/events/webhook-events.js';
import { BlogWebhookEndpoints } from './blog-webhook-endpoints.js';
import { MemoryWebhookEndpoints } from './memory-webhook-endpoints.js';

class Rows extends Adapter(SubscriberRepository) {
  readonly #rows = new Map<string, SubscriberEntity>();

  override async getByEmail(email: string): Promise<SubscriberEntity | null> {
    for (const row of this.#rows.values()) {
      if (row.props.email === email) return row;
    }
    return null;
  }

  override async getById(id: string): Promise<SubscriberEntity | null> {
    return this.#rows.get(id) ?? null;
  }

  override async list(): Promise<readonly SubscriberEntity[]> {
    return [...this.#rows.values()];
  }

  override async save(subscriber: SubscriberEntity): Promise<void> {
    this.#rows.set(subscriber.props.id, subscriber);
    subscriber.commit();
  }
}

describe('BlogWebhookEndpoints', () => {
  it('returns webhook subscribers for subscriber events, and not for the product event', async () => {
    const product = new MemoryWebhookEndpoints();
    const env = {
      id: 'env',
      url: 'https://product.example/in',
      secrets: ['whsec_env'],
    };
    product.add(BLOG_ORGANIZATION, env, ['post.published']);
    const subscribers = new Rows();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        channels: ['webhook'],
        webhookUrl: 'https://ada.example/hooks',
        webhookSecret: 'whsec_ada',
      }),
    );
    const endpoints = new BlogWebhookEndpoints({ product, subscribers });

    expect(
      await endpoints.subscribed(BLOG_ORGANIZATION, 'post.published'),
    ).toEqual([env]);
    expect(
      await endpoints.subscribed(
        BLOG_ORGANIZATION,
        SubscriberPostPublishedWebhook.token,
      ),
    ).toEqual([
      {
        id: 'sub-1',
        url: 'https://ada.example/hooks',
        secrets: ['whsec_ada'],
      },
    ]);
    expect(await endpoints.get(BLOG_ORGANIZATION, 'sub-1')).toEqual({
      id: 'sub-1',
      url: 'https://ada.example/hooks',
      secrets: ['whsec_ada'],
    });
  });

  it('returns null from get after a 410, and omits the subscriber from subscribed', async () => {
    const subscribers = new Rows();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        channels: ['webhook'],
        webhookUrl: 'https://ada.example/hooks',
        webhookSecret: 'whsec_ada',
      }),
    );
    const endpoints = new BlogWebhookEndpoints({
      product: new MemoryWebhookEndpoints(),
      subscribers,
    });

    await endpoints.disable(BLOG_ORGANIZATION, 'sub-1');

    expect(await endpoints.get(BLOG_ORGANIZATION, 'sub-1')).toBeNull();
    expect(
      await endpoints.subscribed(
        BLOG_ORGANIZATION,
        SubscriberPostPublishedWebhook.token,
      ),
    ).toEqual([]);
    expect((await subscribers.getById('sub-1'))?.props.webhookDisabled).toBe(
      true,
    );
  });
});
