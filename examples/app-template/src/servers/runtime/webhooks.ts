import type { Logger } from '@hexok/logger';
import { RedisQueue } from '@hexok/queue-redis';
import { Webhooks } from '@hexok/webhooks';
import type { EventInstance } from 'hexok';
import type { SubscriberRepository } from '../../app/ports/repos/subscriber-repository.js';
import {
  BLOG_ORGANIZATION,
  WebhookEvents,
} from '../../domain/events/webhook-events.js';
import { BlogWebhookEndpoints } from '../../infra/webhooks/blog-webhook-endpoints.js';
import { MemoryWebhookEndpoints } from '../../infra/webhooks/memory-webhook-endpoints.js';
import { requiredEnvVar } from './env.js';

export interface WebhooksRuntime {
  readonly queue: RedisQueue;
  readonly endpoints: BlogWebhookEndpoints;
  readonly webhooks: Webhooks<EventInstance<typeof WebhookEvents>>;
  /** Stops the sender, then its queue. */
  stop(): Promise<void>;
}

/**
 * The webhook sender on its own queue. Only the worker sends.
 * `WEBHOOK_URL` and `WEBHOOK_SECRET` register one product endpoint for `post.published`.
 * Webhook subscribers are read from the subscriber store, not from that endpoint.
 * `WEBHOOKS_ALLOW_PRIVATE=1` allows plain http and private addresses, for a receiver on this machine.
 */
export function createWebhooks(runtime: {
  redisUrl: string;
  logger: Logger;
  subscribers: SubscriberRepository;
}): WebhooksRuntime {
  const logger = runtime.logger.child({ component: 'webhooks' });
  const queue = new RedisQueue({
    redis: runtime.redisUrl,
    keyPrefix: 'webhooks:',
    delayedPrefix: 'webhooks-delayed:',
    // Acknowledged entries count against maxLen until the age trim. Size maxLen as peak entries per second times retention.
    retentionMs: 3_600_000,
    maxLen: 100_000,
    // The 15 s send deadline plus two 10 s hooks.
    stopTimeoutMs: 35_000,
    logger,
  });
  const product = new MemoryWebhookEndpoints();
  const url = process.env.WEBHOOK_URL;
  if (url !== undefined && url !== '') {
    product.add(
      BLOG_ORGANIZATION,
      { id: 'env', url, secrets: [requiredEnvVar('WEBHOOK_SECRET')] },
      ['post.published'],
    );
  }
  const endpoints = new BlogWebhookEndpoints({
    product,
    subscribers: runtime.subscribers,
  });
  const webhooks = new Webhooks(
    {
      events: WebhookEvents,
      queue,
      endpoints,
      logger,
      hooks: {
        onWebhookSuccess: (call, result) => {
          logger.info('webhook delivered', {
            deliveryId: call.deliveryId,
            endpointId: call.endpoint.id,
            attempt: call.attempt,
            status: result.status,
            durationMs: result.durationMs,
          });
        },
        onWebhookFailure: async (call, result, info) => {
          logger.warn('webhook failed', {
            deliveryId: call.deliveryId,
            endpointId: call.endpoint.id,
            attempt: info.attempt,
            status: result.status,
            error: result.error,
            exhausted: info.exhausted,
            nextAttemptAt: info.nextAttemptAt?.toISOString(),
          });
          if (info.gone) {
            await endpoints.disable(call.organizationId, call.endpoint.id);
          }
        },
      },
    },
    webhookSendOptions(),
  );
  return {
    queue,
    endpoints,
    webhooks,
    async stop() {
      await webhooks.stop();
      await queue.stop();
    },
  };
}

/**
 * HTTP checks a subscribe URL with the worker's SSRF options. The queue is not started.
 * `checkUrl` does not use it.
 */
export function createWebhookUrlChecker(runtime: {
  redisUrl: string;
  logger: Logger;
}): (url: string) => Promise<void> {
  const logger = runtime.logger.child({ component: 'webhooks' });
  const webhooks = new Webhooks(
    {
      events: WebhookEvents,
      queue: new RedisQueue({ redis: runtime.redisUrl, logger }),
      endpoints: new MemoryWebhookEndpoints(),
      logger,
    },
    webhookSendOptions(),
  );
  return (url) => webhooks.checkUrl(url);
}

function webhookSendOptions(): { httpsOnly: boolean; allowPrivate: boolean } {
  const allowPrivate = process.env.WEBHOOKS_ALLOW_PRIVATE === '1';
  return { httpsOnly: !allowPrivate, allowPrivate };
}
