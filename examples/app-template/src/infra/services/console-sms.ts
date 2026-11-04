import {
  assertSmsMessage,
  type SmsMessage,
  type SmsReceipt,
  SmsSender,
} from '@hexok/sms';
import { Adapter } from 'hexok';

export class ConsoleSms extends Adapter(SmsSender) {
  override async send(message: SmsMessage): Promise<SmsReceipt> {
    assertSmsMessage(message);
    if (message.sensitive) {
      console.log(`sms sensitive bodyLength=${message.body.length}`);
    } else {
      console.log(`sms to=${message.to} body=${message.body}`);
    }
    return { id: 'console', acceptedAt: new Date() };
  }
}
