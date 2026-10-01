import { Port } from 'hexok';

export abstract class EmailSender extends Port('EmailSender') {
  abstract send(to: string, subject: string, body: string): Promise<void>;
}
