import { Adapter } from 'hexok';
import { PostRepository } from '../../app/ports/repos/post-repository.js';
import { PostEntity } from '../../domain/entities/post.js';
import type { RedisClient } from '../clients/redis-client.js';

const SCHEDULED_KEY = 'posts:scheduled';

export class RedisPosts extends Adapter(PostRepository) {
  constructor(private readonly deps: { redis: RedisClient }) {
    super();
  }

  override async get(id: string): Promise<PostEntity | null> {
    const raw = await this.deps.redis.get(`post:${id}`);
    if (raw === null) return null;
    return PostEntity.restore(
      JSON.parse(raw) as ConstructorParameters<typeof PostEntity>[0],
    );
  }

  override async save(post: PostEntity): Promise<void> {
    const props = post.toProps();
    const key = `post:${props.id}`;
    const multi = this.deps.redis.multi();
    multi.set(key, JSON.stringify(props));
    if (props.status === 'scheduled' && props.publishAt !== null) {
      multi.zAdd(SCHEDULED_KEY, {
        score: Date.parse(props.publishAt),
        value: props.id,
      });
    } else {
      multi.zRem(SCHEDULED_KEY, props.id);
    }
    await multi.exec();
    post.commit();
  }

  override async listDue(now: Date): Promise<readonly PostEntity[]> {
    const ids = await this.deps.redis.zRangeByScore(
      SCHEDULED_KEY,
      '-inf',
      now.getTime(),
    );
    const posts: PostEntity[] = [];
    for (const id of ids) {
      const post = await this.get(String(id));
      if (
        post !== null &&
        post.props.status === 'scheduled' &&
        post.props.publishAt !== null &&
        Date.parse(post.props.publishAt) <= now.getTime()
      ) {
        posts.push(post);
      }
    }
    return posts;
  }
}
