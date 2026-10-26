import {
  assertEmailMessage,
  EmailError,
  type EmailMessage,
  EmailSender,
} from '@hexok/email';
import { Adapter } from 'hexok';
import pRetry, { AbortError } from 'p-retry';
import { type LogSink, noopSink } from './log-sink.js';
import {
  attemptOf,
  courtesyPark,
  emailParkInput,
  type ParkSink,
} from './park.js';
import { type RetrySettings, retryOptions } from './retry.js';

export interface ResendEmailPayload {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    content: string;
    filename: string;
  }>;
  tags?: Array<{ name: string; value: string }>;
}

export interface ResendLike {
  emails: {
    send(
      payload: ResendEmailPayload,
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: {
        message: string;
        name: string;
        statusCode: number | null;
      } | null;
    }>;
  };
}

export interface ResendEmailSenderConfig {
  readonly client: ResendLike;
  readonly sandbox?: boolean;
  readonly logger?: LogSink;
  readonly retry?: Partial<RetrySettings>;
  readonly quarantine?: ParkSink;
}

function terminal(
  kind: 'rejected' | 'unavailable',
  message: string,
): AbortError {
  const error = new Error(message);
  Object.assign(error, { emailKind: kind });
  return new AbortError(error);
}

function emailKind(error: unknown): 'rejected' | 'unavailable' | undefined {
  if (typeof error === 'object' && error !== null && 'emailKind' in error) {
    const kind = error.emailKind;
    if (kind === 'rejected' || kind === 'unavailable') return kind;
  }
  return undefined;
}

function formatFrom(message: EmailMessage): string {
  const name = message.from.name;
  return name ? `${name} <${message.from.email}>` : message.from.email;
}

function addresses(
  values: readonly string[] | undefined,
  sandbox: boolean,
): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  if (sandbox) return ['delivered@resend.dev'];
  return [...values];
}

function shouldRetry(error: {
  statusCode: number | null;
  name: string;
}): boolean {
  if (error.statusCode === 429) return true;
  if (error.statusCode !== null && error.statusCode >= 500) return true;
  return (
    error.name === 'rate_limit_exceeded' ||
    error.name === 'application_error' ||
    error.name === 'internal_server_error'
  );
}

function mapSendError(error: unknown) {
  const kind = emailKind(error);
  if (kind === 'rejected') {
    return EmailError.Rejected(
      error instanceof Error ? error.message : 'Email was rejected',
    );
  }
  if (kind === 'unavailable') return EmailError.Unavailable();
  const status = statusOf(error);
  const name = error instanceof Error ? error.name : '';
  if (status === 429 || name === 'rate_limit_exceeded') {
    return EmailError.RateLimited();
  }
  return EmailError.Unavailable();
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = error.statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export class ResendEmailSender extends Adapter(EmailSender) {
  readonly #client: ResendLike;
  readonly #sandbox: boolean;
  readonly #logger: LogSink;
  readonly #retry: Partial<RetrySettings> | undefined;
  readonly #quarantine: ParkSink | undefined;

  constructor(config: ResendEmailSenderConfig) {
    super();
    this.#client = config.client;
    this.#sandbox = config.sandbox ?? false;
    this.#logger = config.logger ?? noopSink;
    this.#retry = config.retry;
    this.#quarantine = config.quarantine;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    assertEmailMessage(message);
    const payload: ResendEmailPayload = {
      from: formatFrom(message),
      to: addresses(message.to, this.#sandbox) ?? [],
      subject: message.subject,
    };
    const cc = addresses(message.cc, this.#sandbox);
    const bcc = addresses(message.bcc, this.#sandbox);
    if (cc) payload.cc = cc;
    if (bcc) payload.bcc = bcc;
    if (message.replyTo) payload.replyTo = message.replyTo;
    if (message.text) payload.text = message.text;
    if (message.html) payload.html = message.html;
    if (message.tags) {
      payload.tags = Object.entries(message.tags).map(([name, value]) => ({
        name,
        value,
      }));
    }
    const options = message.idempotencyKey
      ? { idempotencyKey: message.idempotencyKey }
      : undefined;
    try {
      const id = await pRetry(
        async () => {
          let result: Awaited<ReturnType<ResendLike['emails']['send']>>;
          try {
            result = await this.#client.emails.send(payload, options);
          } catch (error) {
            throw error instanceof Error ? error : new Error('email: network');
          }
          if (result.error) {
            if (shouldRetry(result.error)) {
              const retryable = new Error(result.error.message);
              retryable.name = result.error.name;
              if (result.error.statusCode !== null) {
                Object.assign(retryable, {
                  statusCode: result.error.statusCode,
                });
              }
              throw retryable;
            }
            throw terminal('rejected', result.error.message);
          }
          if (!result.data?.id) throw terminal('unavailable', 'missing id');
          return result.data.id;
        },
        {
          ...retryOptions(this.#retry),
          onFailedAttempt: (error) => {
            if (error instanceof AbortError) return;
            this.#logger.warn('email: resend attempt failed', {
              idempotencyKey: message.idempotencyKey,
              status: statusOf(error),
              attempt: error.attemptNumber,
            });
          },
        },
      );
      return { id };
    } catch (error) {
      const mapped = mapSendError(error);
      if (mapped.code === 'Unavailable' || mapped.code === 'RateLimited') {
        await courtesyPark(
          this.#quarantine,
          emailParkInput(message, mapped, 'resend', attemptOf(error)),
          this.#logger,
        );
      }
      throw mapped;
    }
  }
}
