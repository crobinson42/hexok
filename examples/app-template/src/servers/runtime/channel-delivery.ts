import type { EmailAddress, EmailSender } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import type { MemoryQuarantine } from '@hexok/quarantine';
import type { SmsSender } from '@hexok/sms';
import { createEmailService } from './email.js';
import { createSmsService } from './sms.js';

/**
 * Mail and SMS senders. Only the worker sends, so only the worker needs
 * `FROM_EMAIL` and the provider keys.
 */
export async function createChannelDeliveryServices(runtime: {
  logger: Logger;
  quarantine: MemoryQuarantine;
}): Promise<{
  email: EmailSender;
  sms: SmsSender;
  from: EmailAddress;
}> {
  const email = await createEmailService(runtime.logger, runtime.quarantine);
  return {
    email: email.email,
    sms: await createSmsService(runtime.logger, runtime.quarantine),
    from: email.from,
  };
}
