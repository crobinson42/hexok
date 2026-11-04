import { EventCatalog } from 'hexok';
import { PostPublishedEvent } from './post-published.js';
import { PostUnpublishedEvent } from './post-unpublished.js';
import { SubscriberJoinedEvent } from './subscriber-joined.js';

/** Facts the API records and the worker handles. */
export class DomainEvents extends EventCatalog('domain-events', {
  postPublished: PostPublishedEvent,
  postUnpublished: PostUnpublishedEvent,
  subscriberJoined: SubscriberJoinedEvent,
}) {}
