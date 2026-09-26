import { EventHandler } from 'hexok';
import { UserCreatedEvent } from '../events/user-created.js';
import type { EmailSender } from '../ports/email-sender.js';

export class SendWelcomeEmailHandler extends EventHandler(
  'send.welcome.email',
  UserCreatedEvent,
) {
  static readonly groupId = 'user-welcome-email';

  constructor(private readonly email: EmailSender) {
    super();
  }

  async handle(event: UserCreatedEvent): Promise<void> {
    await this.email.send(
      event.payload.email,
      'Welcome',
      `Hello ${event.payload.name}`,
    );
  }
}
