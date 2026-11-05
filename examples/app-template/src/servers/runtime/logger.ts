import { JsonLineLogger, type Logger, TeeLogger } from '@hexok/logger';
import { type NewRelicLike, NewRelicLogger } from '@hexok/logger-newrelic';
import { type SentryLike, SentryLogger } from '@hexok/logger-sentry';
import { load } from './env.js';

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
export async function createLogger(): Promise<Logger> {
  const line = new JsonLineLogger({ bindings: { app: 'blog' } });
  const vendors = await Promise.all([sentryLogger(), newRelicLogger()]);
  const extras = vendors.filter((sink): sink is Logger => sink !== undefined);
  if (extras.length === 0) return line;
  return new TeeLogger({ sinks: [line, ...extras] });
}
