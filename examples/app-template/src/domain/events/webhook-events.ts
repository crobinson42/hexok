import { Event, EventCatalog } from 'hexok';
import { z } from 'zod';

/** The blog has one organization. A multi-tenant product passes the tenant that owns the post. */
export const BLOG_ORGANIZATION = 'blog';

/** What a customer's endpoint receives when a post goes live. */
export class PostPublishedWebhook extends Event(
  'post.published',
  z.object({ postId: z.string().min(1), title: z.string().min(1) }),
) {}

/** What a webhook subscriber receives when a post goes live. Not the product event: a shared `eventId` would make a receiver dedupe one against the other. */
export class SubscriberPostPublishedWebhook extends Event(
  'subscriber.post.published',
  z.object({ postId: z.string().min(1), title: z.string().min(1) }),
) {}

/** What a webhook subscriber receives when a live post is removed. */
export class SubscriberPostUnpublishedWebhook extends Event(
  'subscriber.post.unpublished',
  z.object({ postId: z.string().min(1), title: z.string().min(1) }),
) {}

/** What a webhook subscriber receives when they join. One endpoint, not a fan-out. */
export class SubscriberWelcomeWebhook extends Event(
  'subscriber.welcome',
  z.object({ subscriberId: z.string().min(1) }),
) {}

/** What a webhook subscriber receives from the daily reminder. */
export class SubscriberReminderWebhook extends Event(
  'subscriber.reminder',
  z.object({ day: z.string().min(1) }),
) {}

/**
 * Events the blog offers to customer endpoints. Kept apart from `DomainEvents`, so internal fields such as `emailSubscribers` never leave.
 * Subscriber events are the notification channel. `post.published` is the product endpoint, registered from the environment.
 */
export class WebhookEvents extends EventCatalog('webhooks', {
  postPublished: PostPublishedWebhook,
  subscriberPostPublished: SubscriberPostPublishedWebhook,
  subscriberPostUnpublished: SubscriberPostUnpublishedWebhook,
  subscriberWelcome: SubscriberWelcomeWebhook,
  subscriberReminder: SubscriberReminderWebhook,
}) {}

/** Event tokens a webhook subscriber receives. The env endpoint is not in this list. */
export const subscriberWebhookEventTypes = [
  SubscriberPostPublishedWebhook.token,
  SubscriberPostUnpublishedWebhook.token,
  SubscriberWelcomeWebhook.token,
  SubscriberReminderWebhook.token,
] as const;

export function isSubscriberWebhookEvent(eventType: string): boolean {
  return (subscriberWebhookEventTypes as readonly string[]).includes(eventType);
}
