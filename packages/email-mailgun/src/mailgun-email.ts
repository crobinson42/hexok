import {
  assertEmailMessage,
  EmailError,
  type EmailMessage,
  EmailSender,
} from '@hexok/email';
import { Adapter } from 'hexok';
import { type LogSink, noopSink } from './log-sink.js';
import { courtesyPark, emailParkInput, type ParkSink } from './park.js';

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
  readonly quarantine?: ParkSink;
  /** Puts Mailgun's error text in `Rejected` and logs. Off by default because it can hold the recipient. A `sensitive` message never exposes it. */
  readonly exposeProviderErrors?: boolean;
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

function messageOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

export class MailgunEmailSender extends Adapter(EmailSender) {
  readonly #client: MailgunLike;
  readonly #domain: string;
  readonly #sandbox: boolean;
  readonly #logger: LogSink;
  readonly #quarantine: ParkSink | undefined;
  readonly #exposeProviderErrors: boolean;

  constructor(config: MailgunEmailSenderConfig) {
    super();
    this.#client = config.client;
    this.#domain = config.domain;
    this.#sandbox = config.sandbox ?? false;
    this.#logger = config.logger ?? noopSink;
    this.#quarantine = config.quarantine;
    this.#exposeProviderErrors = config.exposeProviderErrors ?? false;
  }

  async #park(message: EmailMessage, error: unknown): Promise<void> {
    if (!EmailError.is(error)) return;
    if (error.code !== 'Unavailable' && error.code !== 'RateLimited') return;
    await courtesyPark(
      this.#quarantine,
      emailParkInput(message, error, 'mailgun'),
      this.#logger,
    );
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
      if (EmailError.is(error)) {
        await this.#park(message, error);
        throw error;
      }
      const status = statusOf(error);
      const expose = this.#exposeProviderErrors && !message.sensitive;
      const text = expose ? messageOf(error) : undefined;
      if (expose) {
        this.#logger.error(
          error instanceof Error
            ? error
            : new Error(text ?? 'email: mailgun send failed'),
          { status, attempt: 1 },
        );
      } else {
        this.#logger.error('email: mailgun send failed', {
          status,
          attempt: 1,
        });
      }
      if (status === undefined || status >= 500) {
        const mapped = EmailError.Unavailable();
        await this.#park(message, mapped);
        throw mapped;
      }
      if (status === 429) {
        const mapped = EmailError.RateLimited();
        await this.#park(message, mapped);
        throw mapped;
      }
      throw text ? EmailError.Rejected(text) : EmailError.Rejected();
    }
  }
}
