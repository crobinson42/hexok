import { Adapter } from 'hexok';
import { type LogFields, Logger } from './logger.js';

export class NoopLogger extends Adapter(Logger) {
  debug(_message: string, _fields?: LogFields): void {}

  info(_message: string, _fields?: LogFields): void {}

  warn(_message: string, _fields?: LogFields): void {}

  error(_messageOrError: string | Error, _fields?: LogFields): void {}

  child(_bindings: LogFields): Logger {
    return this;
  }
}
