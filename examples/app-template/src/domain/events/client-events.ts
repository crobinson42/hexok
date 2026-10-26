import { EventCatalog } from 'hexok';
import { PostPublishedClientEvent } from './post-published-client.js';

// Events published to connected clients, ie: via websocket gateway
export class ClientEvents extends EventCatalog('client-events', {
  postPublished: PostPublishedClientEvent,
}) {}
