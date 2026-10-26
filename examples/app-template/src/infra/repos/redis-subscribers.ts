import { Adapter } from 'hexok';
import { SubscriberRepository } from '../../app/ports/repos/subscriber-repository.js';
import { SubscriberEntity } from '../../domain/entities/subscriber.js';
import type { RedisClient } from '../clients/redis-client.js';

type SubscriberProps = ConstructorParameters<typeof SubscriberEntity>[0];

export class RedisSubscribers extends Adapter(SubscriberRepository) {
  constructor(private readonly deps: { redis: RedisClient }) {
    super();
  }

  override async save(subscriber: SubscriberEntity): Promise<void> {
    const props = subscriber.toProps();
    const rows = await this.#load();
    const next = rows.filter((row) => row.email !== props.email);
    next.push({ ...props, channels: [...props.channels] });
    await this.deps.redis.set('subscribers', JSON.stringify(next));
    subscriber.commit();
  }

  override async getByEmail(email: string): Promise<SubscriberEntity | null> {
    const row = (await this.#load()).find((item) => item.email === email);
    return row === undefined ? null : SubscriberEntity.restore(row);
  }

  override async list(): Promise<readonly SubscriberEntity[]> {
    return (await this.#load()).map((row) => SubscriberEntity.restore(row));
  }

  async #load(): Promise<SubscriberProps[]> {
    const raw = await this.deps.redis.get('subscribers');
    if (raw === null) return [];
    return JSON.parse(raw) as SubscriberProps[];
  }
}
