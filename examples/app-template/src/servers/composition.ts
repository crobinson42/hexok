import { RedisBroadcast } from '@hexok/broadcast-redis';
import type { EmailAddress, EmailSender } from '@hexok/email';
import { MailgunEmailSender, type MailgunLike } from '@hexok/email-mailgun';
import { ResendEmailSender, type ResendLike } from '@hexok/email-resend';
import { JsonLineLogger, type Logger } from '@hexok/logger';
import { type NewRelicLike, NewRelicLogger } from '@hexok/logger-newrelic';
import { type SentryLike, SentryLogger } from '@hexok/logger-sentry';
import { MemoryQuarantine } from '@hexok/quarantine';
import type { LogSink } from '@hexok/queue-redis';
import { RedisQueue } from '@hexok/queue-redis';
import { RedisScheduleCoordinator } from '@hexok/schedule-coordinator-redis';
import type { SmsSender } from '@hexok/sms';
import { type TwilioLike, TwilioSmsSender } from '@hexok/sms-twilio';
import { connectRedis } from '../infra/clients/redis-client.js';
import { RedisPosts } from '../infra/repos/redis-posts.js';
import { RedisSubscribers } from '../infra/repos/redis-subscribers.js';
import { ConsoleSms } from '../infra/services/console-sms.js';
import { TeeLogger } from '../infra/services/tee-logger.js';

export function logSink(logger: Logger): LogSink {
  return {
    debug(message, fields) {
      logger.debug(message, fields);
    },
    info(message, fields) {
      logger.info(message, fields);
    },
    warn(message, fields) {
      logger.warn(message, fields);
    },
    error(message, fields) {
      logger.error(message, fields);
    },
  };
}

function requiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function load(name: string): Promise<unknown> {
  return import(name);
}

/** Sentry ships warn and error. The SDK loads only when SENTRY_DSN is set. */
async function sentryLogger(): Promise<Logger | undefined> {
  const dsn = process.env.SENTRY_DSN;
  if (dsn === undefined || dsn === '') return undefined;
  const sentry = (await load('@sentry/node')) as SentryLike & {
    init(options: { dsn: string }): void;
  };
  sentry.init({ dsn });
  return new SentryLogger({ client: sentry });
}

/** New Relic ships error. The agent loads only when NEW_RELIC_LICENSE_KEY is set. */
async function newRelicLogger(): Promise<Logger | undefined> {
  const license = process.env.NEW_RELIC_LICENSE_KEY;
  if (license === undefined || license === '') return undefined;
  const loaded = (await load('newrelic')) as NewRelicLike & {
    default?: NewRelicLike;
  };
  return new NewRelicLogger({ client: loaded.default ?? loaded });
}

/**
 * Stdout keeps every level. Vendor loggers drop debug and info, so they sit
 * beside the JSON line logger instead of replacing it.
 */
async function createLogger(): Promise<Logger> {
  const line = new JsonLineLogger({ bindings: { app: 'blog' } });
  const vendors = await Promise.all([sentryLogger(), newRelicLogger()]);
  const extras = vendors.filter((sink): sink is Logger => sink !== undefined);
  if (extras.length === 0) return line;
  return new TeeLogger({ sinks: [line, ...extras] });
}

async function createEmailService(
  logger: Logger,
  quarantine: MemoryQuarantine,
): Promise<{
  email: EmailSender;
  from: EmailAddress;
}> {
  const sink = logSink(logger);
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
        logger: sink,
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
        logger: sink,
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

async function createSmsService(
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
    logger: logSink(logger),
    quarantine,
  });
}

export async function createRuntime(): Promise<{
  logger: Logger;
  posts: RedisPosts;
  subscribers: RedisSubscribers;
  domainEventsQueue: RedisQueue;
  clientEventsBroadcast: RedisBroadcast;
  scheduleCoordinator: RedisScheduleCoordinator;
  email: EmailSender;
  sms: SmsSender;
  from: EmailAddress;
}> {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const logger = await createLogger();
  const sink = logSink(logger);
  const quarantine = new MemoryQuarantine();
  const redis = await connectRedis(url);
  const email = await createEmailService(logger, quarantine);
  return {
    logger,
    posts: new RedisPosts({ redis }),
    subscribers: new RedisSubscribers({ redis }),
    domainEventsQueue: new RedisQueue({
      redis: url,
      keyPrefix: 'domain:',
      logger: sink,
      quarantine,
    }),
    clientEventsBroadcast: new RedisBroadcast({
      redis: url,
      channelPrefix: 'client-events:',
      logger: sink,
    }),
    scheduleCoordinator: new RedisScheduleCoordinator({
      redis: url,
      keyPrefix: 'domain:schedule:',
      logger: sink,
    }),
    email: email.email,
    sms: await createSmsService(logger, quarantine),
    from: email.from,
  };
}
