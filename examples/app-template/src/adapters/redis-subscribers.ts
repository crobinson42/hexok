import { Adapter } from 'hexok';
import { SubscriberEntity } from '../entities/subscriber.js';
import { SubscriberRepository } from '../ports/subscriber-repository.js';
import type { RedisClient } from './redis-client.js';

type SubscriberProps = ConstructorParameters<typeof SubscriberEntity>[0];

export class RedisSubscribers extends Adapter(SubscriberRepository) {
  readonly #redis: RedisClient;

  constructor(redis: RedisClient) {
    super();
    this.#redis = redis;
  }

  override async save(subscriber: SubscriberEntity): Promise<void> {
    const props = subscriber.toProps();
    const rows = await this.#load();
    const next = rows.filter((row) => row.email !== props.email);
    next.push(props);
    await this.#redis.set('subscribers', JSON.stringify(next));
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
    const raw = await this.#redis.get('subscribers');
    if (raw === null) return [];
    return JSON.parse(raw) as SubscriberProps[];
  }
}
