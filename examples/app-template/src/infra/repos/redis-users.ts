import { Adapter } from 'hexok';
import { UserRepository } from '../../app/ports/repos/user-repository.js';
import { UserEntity } from '../../domain/entities/user.js';
import type { RedisClient } from '../clients/redis-client.js';

export class RedisUsers extends Adapter(UserRepository) {
  constructor(private readonly deps: { redis: RedisClient }) {
    super();
  }

  override async get(id: string): Promise<UserEntity | null> {
    const raw = await this.deps.redis.get(`user:${id}`);
    if (raw === null) return null;
    return UserEntity.restore(
      JSON.parse(raw) as ConstructorParameters<typeof UserEntity>[0],
    );
  }

  override async save(user: UserEntity): Promise<void> {
    const props = user.toProps();
    await this.deps.redis.set(`user:${props.id}`, JSON.stringify(props));
    user.commit();
  }
}
