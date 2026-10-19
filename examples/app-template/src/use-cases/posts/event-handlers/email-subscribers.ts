import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../../../events/post-published.js';
import { internalCall } from '../../context.js';
import type { EmailSubscribers } from '../internal/email-subscribers.js';

export class EmailSubscribersHandler extends EventHandler(
  'email.subscribers',
  PostPublishedEvent,
) {
  constructor(private readonly emailSubscribers: EmailSubscribers) {
    super();
  }

  async handle(event: PostPublishedEvent): Promise<void> {
    if (!event.payload.emailSubscribers) return;
    await this.emailSubscribers.execute(internalCall(), {
      subject: 'New post',
      body: event.payload.title,
    });
  }
}
