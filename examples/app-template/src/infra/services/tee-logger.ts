import { type LogFields, Logger } from '@hexok/logger';
import { Adapter } from 'hexok';

/** Forwards each call to every logger. Stdout stays even when a vendor logger drops info. */
export class TeeLogger extends Adapter(Logger) {
  constructor(private readonly deps: { sinks: readonly Logger[] }) {
    super();
  }

  debug(message: string, fields?: LogFields): void {
    for (const sink of this.deps.sinks) sink.debug(message, fields);
  }

  info(message: string, fields?: LogFields): void {
    for (const sink of this.deps.sinks) sink.info(message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    for (const sink of this.deps.sinks) sink.warn(message, fields);
  }

  error(messageOrError: string | Error, fields?: LogFields): void {
    for (const sink of this.deps.sinks) sink.error(messageOrError, fields);
  }

  child(bindings: LogFields): Logger {
    return new TeeLogger({
      sinks: this.deps.sinks.map((sink) => sink.child(bindings)),
    });
  }
}
