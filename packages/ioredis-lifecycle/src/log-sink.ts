/** A structural logger. `@hexok/logger` fits it, and so does `console`. */
export interface LogSink {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string | Error, fields?: Record<string, unknown>): void;
}

export const noopSink: LogSink = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
