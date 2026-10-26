import type { SmsMessage, SmsReceipt } from '@hexok/sms';
import { SmsSender } from '@hexok/sms';
import { Adapter } from 'hexok';

export class ConsoleSms extends Adapter(SmsSender) {
  override async send(message: SmsMessage): Promise<SmsReceipt> {
    console.log(`sms to=${message.to} body=${message.body}`);
    return { id: 'console', acceptedAt: new Date() };
  }
}
