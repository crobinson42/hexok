import { Adapter } from 'hexok';
import { allows, type LogLevel } from './level.js';
import { type LogFields, Logger } from './logger.js';
import { type NormalizedError, normalizeError } from './normalize-error.js';

export class JsonLineLogger extends Adapter(Logger) {
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
    this.#write('warn', message, fields, console.error);
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
    return new JsonLineLogger({
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
    const record: Record<string, unknown> = {
      ...this.#bindings,
      ...fields,
      time: new Date().toISOString(),
      level,
      message,
    };
    if (error) record.error = error;
    sink(`${JSON.stringify(record)}\n`);
  }
}
