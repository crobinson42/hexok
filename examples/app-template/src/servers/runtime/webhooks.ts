import type { Logger } from '@hexok/logger';
import { RedisQueue } from '@hexok/queue-redis';
import { Webhooks } from '@hexok/webhooks';
import { BLOG_ORGANIZATION } from '../../app/use-cases/posts/event-handlers/post-published-webhook.js';
import {
  type PostPublishedWebhook,
  WebhookEvents,
} from '../../domain/events/webhook-events.js';
import { MemoryWebhookEndpoints } from '../../infra/webhooks/memory-webhook-endpoints.js';
import { requiredEnvVar } from './env.js';

export interface WebhooksRuntime {
  readonly queue: RedisQueue;
  readonly endpoints: MemoryWebhookEndpoints;
  readonly webhooks: Webhooks<PostPublishedWebhook>;
  /** Stops the sender, then its queue. */
  stop(): Promise<void>;
}

/**
 * The webhook sender on its own queue. Only the worker sends.
 * `WEBHOOK_URL` and `WEBHOOK_SECRET` register one endpoint for `post.published`.
 * `WEBHOOKS_ALLOW_PRIVATE=1` allows plain http and private addresses, for a receiver on this machine.
 */
export function createWebhooks(runtime: {
  redisUrl: string;
  logger: Logger;
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
  const endpoints = new MemoryWebhookEndpoints();
  const url = process.env.WEBHOOK_URL;
  if (url !== undefined && url !== '') {
    endpoints.add(
      BLOG_ORGANIZATION,
      { id: 'env', url, secrets: [requiredEnvVar('WEBHOOK_SECRET')] },
      ['post.published'],
    );
  }
  const allowPrivate = process.env.WEBHOOKS_ALLOW_PRIVATE === '1';
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
        onWebhookFailure: (call, result, info) => {
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
            endpoints.disable(call.organizationId, call.endpoint.id);
          }
        },
      },
    },
    { httpsOnly: !allowPrivate, allowPrivate },
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
