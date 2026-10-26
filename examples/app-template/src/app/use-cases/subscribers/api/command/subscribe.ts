import { randomUUID } from 'node:crypto';
import type { UseCase } from 'hexok';
import { SubscriberEntity } from '../../../../../domain/entities/subscriber.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { SubscriberJoinedEvent } from '../../../../../domain/events/subscriber-joined.js';
import {
  type NotificationChannel,
  notificationChannels,
} from '../../../../../domain/schemas/subscriber.js';
import type { DomainEventPublisher } from '../../../../ports/events/domain-event-publisher.js';
import type { SubscriberRepository } from '../../../../ports/repos/subscriber-repository.js';
import { ApiUseCase } from '../../../context.js';

export class SubscribeToPosts extends ApiUseCase('subscriber.subscribe') {
  constructor(
    private readonly deps: {
      subscribers: SubscriberRepository;
      domainEvents: DomainEventPublisher;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: { email: string; phone?: string; channels?: NotificationChannel[] },
  ): Promise<SubscriberEntity> {
    const existing = await this.deps.subscribers.getByEmail(input.email);
    if (existing !== null) {
      return existing;
    }
    const channels = normalizeChannels(input.channels);
    const phone = input.phone?.trim();
    if (channels.includes('sms') && (phone === undefined || phone === '')) {
      throw DomainError.SmsRequiresPhone();
    }
    const subscriber = SubscriberEntity.create({
      id: randomUUID(),
      email: input.email,
      channels,
      ...(phone === undefined || phone === '' ? {} : { phone }),
    });
    await this.deps.subscribers.save(subscriber);
    await this.deps.domainEvents.publish(
      new SubscriberJoinedEvent({
        subscriberId: subscriber.props.id,
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
