import {
  assertEmailMessage,
  EmailError,
  type EmailMessage,
  EmailSender,
} from '@hexok/email';
import { Adapter } from 'hexok';
import { type LogSink, noopSink } from './log-sink.js';

export interface MailgunLike {
  messages: {
    create(
      domain: string,
      data: Record<string, unknown>,
    ): Promise<{ id?: string; message?: string }>;
  };
}

export interface MailgunEmailSenderConfig {
  readonly client: MailgunLike;
  readonly domain: string;
  readonly sandbox?: boolean;
  readonly logger?: LogSink;
}

function formatFrom(message: EmailMessage): string {
  const name = message.from.name;
  return name ? `${name} <${message.from.email}>` : message.from.email;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export class MailgunEmailSender extends Adapter(EmailSender) {
  readonly #client: MailgunLike;
  readonly #domain: string;
  readonly #sandbox: boolean;
  readonly #logger: LogSink;

  constructor(config: MailgunEmailSenderConfig) {
    super();
    this.#client = config.client;
    this.#domain = config.domain;
    this.#sandbox = config.sandbox ?? false;
    this.#logger = config.logger ?? noopSink;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    assertEmailMessage(message);
    const data: Record<string, unknown> = {
      to: [...message.to],
      from: formatFrom(message),
      subject: message.subject,
    };
    if (message.cc) data.cc = [...message.cc];
    if (message.bcc) data.bcc = [...message.bcc];
    if (message.text) data.text = message.text;
    if (message.html) data.html = message.html;
    if (message.replyTo) data['h:Reply-To'] = message.replyTo;
    if (message.attachments) {
      data.attachment = message.attachments.map((attachment) => ({
        data: attachment.data,
        filename: attachment.filename,
        contentType: attachment.contentType,
      }));
    }
    if (this.#sandbox) data['o:testmode'] = 'yes';
    if (message.idempotencyKey) {
      data['v:idempotencyKey'] = message.idempotencyKey;
    }
    if (message.tags) {
      for (const [key, value] of Object.entries(message.tags)) {
        if (key === 'idempotencyKey') continue;
        data[`v:${key}`] = value;
      }
    }
    try {
      const result = await this.#client.messages.create(this.#domain, data);
      if (!result.id) {
        this.#logger.error('email: mailgun missing id', {
          domain: this.#domain,
        });
        throw EmailError.Unavailable();
      }
      return { id: result.id };
    } catch (error) {
      if (EmailError.is(error)) throw error;
      const status = statusOf(error);
      const message =
        error instanceof Error ? error.message : 'Email was rejected';
      const text =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
          ? error.message
          : message;
      if (status === undefined || status >= 500) throw EmailError.Unavailable();
      if (status === 429) throw EmailError.RateLimited();
      throw EmailError.Rejected(text);
    }
  }
}
