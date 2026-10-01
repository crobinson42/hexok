import { Adapter } from 'hexok';
import { PostEntity } from '../entities/post.js';
import { PostRepository } from '../ports/post-repository.js';
import type { RedisClient } from './redis-client.js';

export class RedisPosts extends Adapter(PostRepository) {
  readonly #redis: RedisClient;

  constructor(redis: RedisClient) {
    super();
    this.#redis = redis;
  }

  override async get(id: string): Promise<PostEntity | null> {
    const raw = await this.#redis.get(`post:${id}`);
    if (raw === null) return null;
    return PostEntity.restore(
      JSON.parse(raw) as ConstructorParameters<typeof PostEntity>[0],
    );
  }

  override async save(post: PostEntity): Promise<void> {
    await this.#redis.set(
      `post:${post.props.id}`,
      JSON.stringify(post.toProps()),
    );
    post.commit();
  }
}
