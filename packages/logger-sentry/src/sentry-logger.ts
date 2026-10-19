import { type LogFields, Logger } from '@hexok/logger';
import { Adapter } from 'hexok';

export type SentrySeverityLevel =
  | 'fatal'
  | 'error'
  | 'warning'
  | 'log'
  | 'info'
  | 'debug';

export interface SentryLike {
  captureException(
    exception: unknown,
    hint?: { extra?: Record<string, unknown> },
  ): string;
  captureMessage(
    message: string,
    captureContext?:
      | SentrySeverityLevel
      | { level?: SentrySeverityLevel; extra?: Record<string, unknown> },
  ): string;
}

export class SentryLogger extends Adapter(Logger) {
  readonly #client: SentryLike;
  readonly #bindings: LogFields;

  constructor(config: { client: SentryLike; bindings?: LogFields }) {
    super();
    this.#client = config.client;
    this.#bindings = config.bindings ?? {};
  }

  debug(_message: string, _fields?: LogFields): void {}

  info(_message: string, _fields?: LogFields): void {}

  warn(message: string, fields?: LogFields): void {
    this.#client.captureMessage(message, {
      level: 'warning',
      extra: { ...this.#bindings, ...fields },
    });
  }

  error(messageOrError: string | Error, fields?: LogFields): void {
    const extra = { ...this.#bindings, ...fields };
    if (messageOrError instanceof Error) {
      this.#client.captureException(messageOrError, { extra });
      return;
    }
    this.#client.captureMessage(messageOrError, { level: 'error', extra });
  }

  child(bindings: LogFields): Logger {
    return new SentryLogger({
      client: this.#client,
      bindings: { ...this.#bindings, ...bindings },
    });
  }
}
