import { type LogFields, Logger } from '@hexok/logger';
import { Adapter } from 'hexok';

export interface NewRelicLike {
  noticeError(
    error: Error | string,
    customAttributes?: Record<string, unknown>,
  ): void;
}

function attributes(
  fields: LogFields,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    } else {
      out[key] = typeof value;
    }
  }
  return out;
}

export class NewRelicLogger extends Adapter(Logger) {
  readonly #client: NewRelicLike;
  readonly #bindings: LogFields;

  constructor(config: { client: NewRelicLike; bindings?: LogFields }) {
    super();
    this.#client = config.client;
    this.#bindings = config.bindings ?? {};
  }

  debug(_message: string, _fields?: LogFields): void {}

  info(_message: string, _fields?: LogFields): void {}

  warn(_message: string, _fields?: LogFields): void {}

  error(messageOrError: string | Error, fields?: LogFields): void {
    this.#client.noticeError(
      messageOrError,
      attributes({ ...this.#bindings, ...fields }),
    );
  }

  child(bindings: LogFields): Logger {
    return new NewRelicLogger({
      client: this.#client,
      bindings: { ...this.#bindings, ...bindings },
    });
  }
}
