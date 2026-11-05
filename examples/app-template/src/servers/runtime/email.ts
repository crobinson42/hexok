import type { EmailAddress, EmailSender } from '@hexok/email';
import { MailgunEmailSender, type MailgunLike } from '@hexok/email-mailgun';
import { ResendEmailSender, type ResendLike } from '@hexok/email-resend';
import type { Logger } from '@hexok/logger';
import type { MemoryQuarantine } from '@hexok/quarantine';
import { load, requiredEnvVar } from './env.js';

export async function createEmailService(
  logger: Logger,
  quarantine: MemoryQuarantine,
): Promise<{
  email: EmailSender;
  from: EmailAddress;
}> {
  const provider = process.env.EMAIL_PROVIDER ?? 'resend';
  const from = fromAddress();
  if (provider === 'resend') {
    const mod = (await load('resend')) as {
      Resend: new (key: string) => ResendLike;
    };
    return {
      email: new ResendEmailSender({
        client: new mod.Resend(requiredEnvVar('RESEND_API_KEY')),
        sandbox: process.env.RESEND_SANDBOX === '1',
        logger,
        quarantine,
      }),
      from,
    };
  }
  if (provider === 'mailgun') {
    const mailgunMod = (await load('mailgun.js')) as {
      default: new (
        form: unknown,
      ) => {
        client(options: { username: string; key: string }): MailgunLike;
      };
    };
    const formMod = (await load('form-data')) as { default: new () => unknown };
    const client = new mailgunMod.default(new formMod.default()).client({
      username: 'api',
      key: requiredEnvVar('MAILGUN_API_KEY'),
    });
    return {
      email: new MailgunEmailSender({
        client,
        domain: requiredEnvVar('MAILGUN_DOMAIN'),
        logger,
        quarantine,
      }),
      from,
    };
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}

function fromAddress(): EmailAddress {
  return { email: requiredEnvVar('FROM_EMAIL'), name: 'Blog' };
}
