import { randomUUID } from 'node:crypto';
import type { UseCase } from 'hexok';
import { SubscriberEntity } from '../entities/subscriber.js';
import type { SubscriberRepository } from '../ports/subscriber-repository.js';
import { AppUseCase } from './context.js';

export class SubscribeToPosts extends AppUseCase('subscriber.subscribe') {
  constructor(private readonly subscribers: SubscriberRepository) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { email: string },
  ): Promise<SubscriberEntity> {
    const existing = await this.subscribers.getByEmail(input.email);
    if (existing !== null) {
      return existing;
    }
    const subscriber = SubscriberEntity.create({
      id: randomUUID(),
      email: input.email,
    });
    await this.subscribers.save(subscriber);
    return subscriber;
  }
}
