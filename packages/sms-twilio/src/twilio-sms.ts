import {
  assertSmsMessage,
  SmsError,
  type SmsMessage,
  SmsSender,
} from '@hexok/sms';
import { Adapter } from 'hexok';
import { type LogSink, noopSink } from './log-sink.js';
import { courtesyPark, type ParkSink, smsParkInput } from './park.js';

export interface TwilioLike {
  messages: {
    create(body: {
      to: string;
      from: string;
      body: string;
    }): Promise<{ sid: string; dateCreated: Date | null }>;
  };
}

export interface TwilioSmsSenderConfig {
  readonly client: TwilioLike;
  readonly from: string;
  readonly logger?: LogSink;
  readonly quarantine?: ParkSink;
}

const retryAfterMs = 30000;

function field(error: unknown, key: 'code' | 'status' | 'message'): unknown {
  if (typeof error === 'object' && error !== null && key in error) {
    return (error as Record<string, unknown>)[key];
  }
  return undefined;
}

export class TwilioSmsSender extends Adapter(SmsSender) {
  readonly #client: TwilioLike;
  readonly #from: string;
  readonly #logger: LogSink;
  readonly #quarantine: ParkSink | undefined;

  constructor(config: TwilioSmsSenderConfig) {
    super();
    this.#client = config.client;
    this.#from = config.from;
    this.#logger = config.logger ?? noopSink;
    this.#quarantine = config.quarantine;
  }

  async send(message: SmsMessage): Promise<{ id: string; acceptedAt: Date }> {
    assertSmsMessage(message);
    try {
      const result = await this.#client.messages.create({
        to: message.to,
        from: this.#from,
        body: message.body,
      });
      return { id: result.sid, acceptedAt: result.dateCreated ?? new Date() };
    } catch (error) {
      const code = field(error, 'code');
      const status = field(error, 'status');
      const text = field(error, 'message');
      const messageText =
        typeof text === 'string' ? text : 'Message was rejected';
      this.#logger.error(
        error instanceof Error ? error : new Error(messageText),
        { code, status },
      );
      if (code === 21610) throw SmsError.Unsubscribed();
      if (code === 21608 || code === 21211 || code === 21614) {
        throw SmsError.InvalidRecipient();
      }
      if (code === 20429 || status === 429) {
        const mapped = SmsError.RateLimited({ retryAfterMs });
        await courtesyPark(
          this.#quarantine,
          smsParkInput(message, mapped),
          this.#logger,
        );
        throw mapped;
      }
      if (typeof status !== 'number' || status >= 500) {
        const mapped = SmsError.Unavailable({ retryAfterMs });
        await courtesyPark(
          this.#quarantine,
          smsParkInput(message, mapped),
          this.#logger,
        );
        throw mapped;
      }
      throw SmsError.Rejected(messageText);
    }
  }
}
