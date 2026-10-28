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

interface ResendEmailFields {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  attachments?: Array<{
    content: string | Buffer;
    filename: string;
    contentType?: string;
  }>;
  tags?: Array<{ name: string; value: string }>;
}

type ResendEmailBody =
  | { html: string; text?: string }
  | { text: string; html?: string };

/** The SDK requires `html` or `text`. The union keeps the real `Resend` client assignable. */
export type ResendEmailPayload = ResendEmailFields & ResendEmailBody;

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
  /** Puts Resend's error text in `Rejected` and logs a failed park's raw error. Off by default because both can hold the recipient. A `sensitive` message never exposes them. */
  readonly exposeProviderErrors?: boolean;
}

function terminal(
  kind: 'rejected' | 'unavailable',
  message?: string,
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

function emailBody(message: EmailMessage): ResendEmailBody {
  const { text, html } = message;
  if (html?.trim()) return text ? { html, text } : { html };
  if (text?.trim()) return html ? { text, html } : { text };
  throw EmailError.InvalidMessage();
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
    return error instanceof Error && error.message !== ''
      ? EmailError.Rejected(error.message)
      : EmailError.Rejected();
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
  readonly #exposeProviderErrors: boolean;

  constructor(config: ResendEmailSenderConfig) {
    super();
    this.#client = config.client;
    this.#sandbox = config.sandbox ?? false;
    this.#logger = config.logger ?? noopSink;
    this.#retry = config.retry;
    this.#quarantine = config.quarantine;
    this.#exposeProviderErrors = config.exposeProviderErrors ?? false;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    assertEmailMessage(message);
    const payload: ResendEmailPayload = {
      ...emailBody(message),
      from: formatFrom(message),
      to: addresses(message.to, this.#sandbox) ?? [],
      subject: message.subject,
    };
    const cc = addresses(message.cc, this.#sandbox);
    const bcc = addresses(message.bcc, this.#sandbox);
    if (cc) payload.cc = cc;
    if (bcc) payload.bcc = bcc;
    if (message.replyTo) payload.replyTo = message.replyTo;
    if (message.attachments) {
      payload.attachments = message.attachments.map((attachment) => ({
        content: attachment.data,
        filename: attachment.filename,
        contentType: attachment.contentType,
      }));
    }
    if (message.tags) {
      payload.tags = Object.entries(message.tags).map(([name, value]) => ({
        name,
        value,
      }));
    }
    const expose = this.#exposeProviderErrors && !message.sensitive;
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
              const retryable = new Error('email: resend attempt failed');
              retryable.name = result.error.name;
              if (result.error.statusCode !== null) {
                Object.assign(retryable, {
                  statusCode: result.error.statusCode,
                });
              }
              throw retryable;
            }
            throw terminal(
              'rejected',
              expose ? result.error.message : undefined,
            );
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
          expose,
        );
      }
      throw mapped;
    }
  }
}
