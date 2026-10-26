import { EventCatalog } from 'hexok';
import { PostPublishedEvent } from './post-published.js';
import { PostUnpublishedEvent } from './post-unpublished.js';
import { SubscriberJoinedEvent } from './subscriber-joined.js';

// Events published and consumed internally on the backend, ie: moving a work/task to another consumer machine/process to be handled
export class DomainEvents extends EventCatalog('domain-events', {
  postPublished: PostPublishedEvent,
  postUnpublished: PostUnpublishedEvent,
  subscriberJoined: SubscriberJoinedEvent,
}) {}
