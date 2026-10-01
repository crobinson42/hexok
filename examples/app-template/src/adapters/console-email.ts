import { Adapter } from 'hexok';
import { EmailSender } from '../ports/email-sender.js';

export class ConsoleEmail extends Adapter(EmailSender) {
  override async send(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    console.log(`email to=${to} subject=${subject} body=${body}`);
  }
}
