export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const rank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** A record is emitted when `level` is at least `minLevel`. */
export function allows(level: LogLevel, minLevel: LogLevel): boolean {
  return rank[level] >= rank[minLevel];
}
