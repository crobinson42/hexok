import { Port } from 'hexok';
import type { PostEntity } from '../entities/post.js';

export abstract class PostRepository extends Port('PostRepository') {
  abstract get(id: string): Promise<PostEntity | null>;
  abstract save(post: PostEntity): Promise<void>;
}
