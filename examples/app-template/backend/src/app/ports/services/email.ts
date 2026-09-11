import { Port } from 'hexok/domain';

export interface EmailService {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}
export const EmailService = Port.token<EmailService>('EmailService');
