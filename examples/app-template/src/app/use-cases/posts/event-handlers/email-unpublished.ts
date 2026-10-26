import { EventHandler } from 'hexok';
import { PostUnpublishedEvent } from '../../../../domain/events/post-unpublished.js';
import { internalCall } from '../../context.js';
import type { EmailSubscribers } from '../internal/email-subscribers.js';

export class EmailUnpublishedHandler extends EventHandler(
  'email.unpublished',
  PostUnpublishedEvent,
) {
  constructor(private readonly deps: { emailSubscribers: EmailSubscribers }) {
    super();
  }

  async handle(event: PostUnpublishedEvent): Promise<void> {
    await this.deps.emailSubscribers.execute(internalCall(), {
      subject: 'Post removed',
      body: event.payload.title,
    });
  }
}
