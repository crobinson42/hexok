import { Adapter } from 'hexok';
import { mergeFields } from './fields.js';
import { allows, type LogLevel } from './level.js';
import { type LogFields, Logger } from './logger.js';
import { type NormalizedError, normalizeError } from './normalize-error.js';

export class ConsoleLogger extends Adapter(Logger) {
  readonly #minLevel: LogLevel;
  readonly #bindings: LogFields;

  constructor(config?: { minLevel?: LogLevel; bindings?: LogFields }) {
    super();
    this.#minLevel = config?.minLevel ?? 'info';
    this.#bindings = config?.bindings ?? {};
  }

  debug(message: string, fields?: LogFields): void {
    this.#write('debug', message, fields, console.log);
  }

  info(message: string, fields?: LogFields): void {
    this.#write('info', message, fields, console.log);
  }

  warn(message: string, fields?: LogFields): void {
    this.#write('warn', message, fields, console.warn);
  }

  error(messageOrError: string | Error, fields?: LogFields): void {
    if (messageOrError instanceof Error) {
      this.#write(
        'error',
        messageOrError.message,
        fields,
        console.error,
        normalizeError(messageOrError),
      );
      return;
    }
    this.#write('error', messageOrError, fields, console.error);
  }

  child(bindings: LogFields): Logger {
    return new ConsoleLogger({
      minLevel: this.#minLevel,
      bindings: { ...this.#bindings, ...bindings },
    });
  }

  #write(
    level: LogLevel,
    message: string,
    fields: LogFields | undefined,
    sink: (...args: unknown[]) => void,
    error?: NormalizedError,
  ): void {
    if (!allows(level, this.#minLevel)) return;
    const time = new Date().toISOString();
    const rest: LogFields = mergeFields(this.#bindings, fields);
    if (error) rest.error = error;
    const suffix =
      Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    sink(`${time} ${level} ${message}${suffix}`);
  }
}
