import { Port } from 'hexok';
import type { PostEntity } from '../../../domain/entities/post.js';

export abstract class PostRepository extends Port('PostRepository') {
  abstract get(id: string): Promise<PostEntity | null>;
  abstract save(post: PostEntity): Promise<void>;
  /** Scheduled posts whose `publishAt` is at or before `now`. */
  abstract listDue(now: Date): Promise<readonly PostEntity[]>;
}
