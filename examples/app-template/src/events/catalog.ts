import { EventCatalog } from 'hexok';
import { PostPublishedEvent } from './post-published.js';

export class BlogEvents extends EventCatalog('blog', {
  postPublished: PostPublishedEvent,
}) {}
