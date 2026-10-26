import { Adapter } from 'hexok';
import { mergeFields } from './fields.js';
import { allows, type LogLevel } from './level.js';
import { type LogFields, Logger } from './logger.js';
import { type NormalizedError, normalizeError } from './normalize-error.js';

export interface MemoryRecord {
  readonly time: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly error?: NormalizedError;
  readonly fields: LogFields;
}

export class MemoryLogger extends Adapter(Logger) {
  readonly records: MemoryRecord[];
  readonly #minLevel: LogLevel;
  readonly #bindings: LogFields;
  readonly #store: MemoryRecord[];

  constructor(config?: {
    minLevel?: LogLevel;
    bindings?: LogFields;
    store?: MemoryRecord[];
  }) {
    super();
    this.#minLevel = config?.minLevel ?? 'debug';
    this.#bindings = config?.bindings ?? {};
    this.#store = config?.store ?? [];
    this.records = this.#store;
  }

  debug(message: string, fields?: LogFields): void {
    this.#emit('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.#emit('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.#emit('warn', message, fields);
  }

  error(messageOrError: string | Error, fields?: LogFields): void {
    if (messageOrError instanceof Error) {
      this.#emit(
        'error',
        messageOrError.message,
        fields,
        normalizeError(messageOrError),
      );
      return;
    }
    this.#emit('error', messageOrError, fields);
  }

  child(bindings: LogFields): Logger {
    return new MemoryLogger({
      minLevel: this.#minLevel,
      bindings: { ...this.#bindings, ...bindings },
      store: this.#store,
    });
  }

  clear(): void {
    this.#store.length = 0;
  }

  #emit(
    level: LogLevel,
    message: string,
    fields?: LogFields,
    error?: NormalizedError,
  ): void {
    if (!allows(level, this.#minLevel)) return;
    const record: MemoryRecord = {
      time: new Date().toISOString(),
      level,
      message,
      fields: mergeFields(this.#bindings, fields),
    };
    if (error) {
      this.#store.push({ ...record, error });
      return;
    }
    this.#store.push(record);
  }
}
