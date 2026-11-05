import { Adapter } from 'hexok';
import { type LogFields, Logger } from './logger.js';

/** Forwards each call to every sink, in order. A throw stops later sinks. */
export class TeeLogger extends Adapter(Logger) {
  readonly #sinks: readonly Logger[];

  constructor(config: { sinks: readonly Logger[] }) {
    super();
    this.#sinks = config.sinks;
  }

  debug(message: string, fields?: LogFields): void {
    for (const sink of this.#sinks) sink.debug(message, fields);
  }

  info(message: string, fields?: LogFields): void {
    for (const sink of this.#sinks) sink.info(message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    for (const sink of this.#sinks) sink.warn(message, fields);
  }

  error(messageOrError: string | Error, fields?: LogFields): void {
    for (const sink of this.#sinks) sink.error(messageOrError, fields);
  }

  child(bindings: LogFields): Logger {
    return new TeeLogger({
      sinks: this.#sinks.map((sink) => sink.child(bindings)),
    });
  }
}
