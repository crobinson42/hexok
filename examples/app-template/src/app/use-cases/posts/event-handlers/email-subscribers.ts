import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import { internalCall } from '../../context.js';
import type { EmailSubscribers } from '../internal/email-subscribers.js';

export class EmailSubscribersHandler extends EventHandler(
  'email.subscribers',
  PostPublishedEvent,
) {
  constructor(private readonly deps: { emailSubscribers: EmailSubscribers }) {
    super();
  }

  async handle(event: PostPublishedEvent): Promise<void> {
    if (!event.payload.emailSubscribers) return;
    await this.deps.emailSubscribers.execute(internalCall(), {
      subject: 'New post',
      body: event.payload.title,
    });
  }
}
