import type { Logger } from '@hexok/logger';
import type { MemoryQuarantine } from '@hexok/quarantine';
import type { SmsSender } from '@hexok/sms';
import { type TwilioLike, TwilioSmsSender } from '@hexok/sms-twilio';
import { ConsoleSms } from '../../infra/services/console-sms.js';
import { load, requiredEnvVar } from './env.js';

export async function createSmsService(
  logger: Logger,
  quarantine: MemoryQuarantine,
): Promise<SmsSender> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (sid === undefined || sid === '') return new ConsoleSms();
  const twilioMod = (await load('twilio')) as {
    default: (accountSid: string, authToken: string) => TwilioLike;
  };
  return new TwilioSmsSender({
    client: twilioMod.default(sid, requiredEnvVar('TWILIO_AUTH_TOKEN')),
    from: requiredEnvVar('TWILIO_FROM'),
    logger,
    quarantine,
  });
}
