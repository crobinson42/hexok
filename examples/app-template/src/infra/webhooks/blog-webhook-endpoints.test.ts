import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { SubscriberRepository } from '../../app/ports/repos/subscriber-repository.js';
import { SubscriberEntity } from '../../domain/entities/subscriber.js';
import { SubscriberPostPublishedWebhook } from '../../domain/events/webhook-events.js';
import { demoOrganization } from '../auth/demo-tenancy.js';
import { BlogWebhookEndpoints } from './blog-webhook-endpoints.js';
import { MemoryWebhookEndpoints } from './memory-webhook-endpoints.js';

class Rows extends Adapter(SubscriberRepository) {
  readonly #rows = new Map<string, SubscriberEntity>();

  override async getByEmail(
    organizationId: string,
    email: string,
  ): Promise<SubscriberEntity | null> {
    for (const row of this.#rows.values()) {
      if (
        row.props.organizationId === organizationId &&
        row.props.email === email
      ) {
        return row;
      }
    }
    return null;
  }

  override async getById(id: string): Promise<SubscriberEntity | null> {
    return this.#rows.get(id) ?? null;
  }

  override async list(): Promise<readonly SubscriberEntity[]> {
    return [...this.#rows.values()];
  }

  override async listByOrganization(
    organizationId: string,
  ): Promise<readonly SubscriberEntity[]> {
    return [...this.#rows.values()].filter(
      (row) => row.props.organizationId === organizationId,
    );
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
    product.add(demoOrganization.id, env, ['post.published']);
    const subscribers = new Rows();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['webhook'],
        webhookUrl: 'https://ada.example/hooks',
        webhookSecret: 'whsec_ada',
      }),
    );
    const endpoints = new BlogWebhookEndpoints({ product, subscribers });

    expect(
      await endpoints.subscribed(demoOrganization.id, 'post.published'),
    ).toEqual([env]);
    expect(
      await endpoints.subscribed(
        demoOrganization.id,
        SubscriberPostPublishedWebhook.token,
      ),
    ).toEqual([
      {
        id: 'sub-1',
        url: 'https://ada.example/hooks',
        secrets: ['whsec_ada'],
      },
    ]);
    expect(await endpoints.get(demoOrganization.id, 'sub-1')).toEqual({
      id: 'sub-1',
      url: 'https://ada.example/hooks',
      secrets: ['whsec_ada'],
    });
    expect(
      await endpoints.subscribed('other', SubscriberPostPublishedWebhook.token),
    ).toEqual([]);
  });

  it('returns null from get after a 410, and omits the subscriber from subscribed', async () => {
    const subscribers = new Rows();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
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

    await endpoints.disable(demoOrganization.id, 'sub-1');

    expect(await endpoints.get(demoOrganization.id, 'sub-1')).toBeNull();
    expect(
      await endpoints.subscribed(
        demoOrganization.id,
        SubscriberPostPublishedWebhook.token,
      ),
    ).toEqual([]);
    expect((await subscribers.getById('sub-1'))?.props.webhookDisabled).toBe(
      true,
    );
  });
});
