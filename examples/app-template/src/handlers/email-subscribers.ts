import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../events/post-published.js';
import type { EmailSender } from '../ports/email-sender.js';
import type { SubscriberRepository } from '../ports/subscriber-repository.js';

export class EmailSubscribersHandler extends EventHandler(
  'email.subscribers',
  PostPublishedEvent,
) {
  constructor(
    private readonly subscribers: SubscriberRepository,
    private readonly email: EmailSender,
  ) {
    super();
  }

  async handle(event: PostPublishedEvent): Promise<void> {
    if (!event.payload.emailSubscribers) return;
    const subscribers = await this.subscribers.list();
    for (const subscriber of subscribers) {
      await this.email.send(
        subscriber.props.email,
        'New post',
        event.payload.title,
      );
    }
  }
}
