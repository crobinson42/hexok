import { randomUUID } from 'node:crypto';
import { generateSecret, WebhookError } from '@hexok/webhooks';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { SubscriberEntity } from '../../../../../domain/entities/subscriber.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { SubscriberJoinedEvent } from '../../../../../domain/events/subscriber-joined.js';
import {
  type NotificationChannel,
  notificationChannelSchema,
  notificationChannels,
} from '../../../../../domain/schemas/subscriber.js';
import type { DomainEventPublisher } from '../../../../ports/events/domain-event-publisher.js';
import type { OrganizationRepository } from '../../../../ports/repos/organization-repository.js';
import type { SubscriberRepository } from '../../../../ports/repos/subscriber-repository.js';
import { PublicApiUseCase } from '../../../context.js';

/** Omitted `channels` means email. Channel rules are checked in `execute`. */
export const subscribeToPostsInput = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  url: z.string().optional(),
  channels: z.array(notificationChannelSchema).optional(),
});

export type SubscribeToPostsInput = z.infer<typeof subscribeToPostsInput>;

/** The worker's URL check. HTTP does not start the sender. */
export type CheckWebhookUrl = (url: string) => Promise<void>;

export class SubscribeToPosts extends PublicApiUseCase('subscriber.subscribe', {
  input: subscribeToPostsInput,
}) {
  constructor(
    private readonly deps: {
      subscribers: SubscriberRepository;
      organizations: OrganizationRepository;
      domainEvents: DomainEventPublisher;
      checkWebhookUrl: CheckWebhookUrl;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof PublicApiUseCase>,
    input: SubscribeToPostsInput,
  ): Promise<SubscriberEntity> {
    const organization = await this.deps.organizations.get(
      input.organizationId,
    );
    if (organization === null) {
      throw DomainError.OrganizationNotFound({ id: input.organizationId });
    }
    const existing = await this.deps.subscribers.getByEmail(
      input.organizationId,
      input.email,
    );
    if (existing !== null) {
      return existing;
    }
    const channels = normalizeChannels(input.channels);
    const phone = input.phone?.trim();
    if (channels.includes('sms') && (phone === undefined || phone === '')) {
      throw DomainError.SmsRequiresPhone();
    }
    const webhookUrl = webhookUrlOf(channels, input.url);
    if (webhookUrl !== undefined) {
      await rejectUnsafeUrl(this.deps.checkWebhookUrl, webhookUrl);
    }
    const subscriber = SubscriberEntity.create({
      id: randomUUID(),
      organizationId: input.organizationId,
      email: input.email,
      channels,
      ...(phone === undefined || phone === '' ? {} : { phone }),
      ...(webhookUrl === undefined
        ? {}
        : { webhookUrl, webhookSecret: generateSecret() }),
    });
    await this.deps.subscribers.save(subscriber);
    await this.deps.domainEvents.publish(
      new SubscriberJoinedEvent({
        subscriberId: subscriber.props.id,
        organizationId: subscriber.props.organizationId,
        email: subscriber.props.email,
        channels: [...subscriber.props.channels],
        ...(subscriber.props.phone === undefined
          ? {}
          : { phone: subscriber.props.phone }),
      }),
    );
    return subscriber;
  }
}

function webhookUrlOf(
  channels: readonly NotificationChannel[],
  url: string | undefined,
): string | undefined {
  if (!channels.includes('webhook')) return undefined;
  const trimmed = url?.trim() ?? '';
  if (trimmed === '') throw DomainError.WebhookRequiresUrl();
  return trimmed;
}

async function rejectUnsafeUrl(
  check: CheckWebhookUrl,
  url: string,
): Promise<void> {
  try {
    await check(url);
  } catch (error) {
    if (WebhookError.is(error) && error.code === 'UnsafeUrl') {
      throw DomainError.WebhookUrlRejected({ reason: error.data.reason });
    }
    throw error;
  }
}

function normalizeChannels(
  channels: NotificationChannel[] | undefined,
): NotificationChannel[] {
  if (channels === undefined) return ['email'];
  if (channels.length === 0) throw DomainError.ChannelsRequired();
  if (
    channels.some((channel) => !notificationChannels.includes(channel)) ||
    new Set(channels).size !== channels.length
  ) {
    throw DomainError.ChannelsInvalid();
  }
  return channels;
}
