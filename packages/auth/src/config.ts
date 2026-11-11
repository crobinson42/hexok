import { invalidConfig } from './errors.js';

/** The environment the app read and passed in. The package never reads `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/** How long a session lives. Both clocks are seconds. */
export type SessionConfig = {
  /** A session unused this long ends. Every authenticated call slides it. */
  readonly idleSeconds: number;
  /** A session ends this long after it opened, however busy it is. */
  readonly absoluteSeconds: number;
};

const DEFAULT_IDLE_SECONDS = 30 * 60;
const DEFAULT_ABSOLUTE_SECONDS = 8 * 60 * 60;

/**
 * Reads `<prefix>IDLE_SECONDS` (default 1800) and `<prefix>ABSOLUTE_SECONDS`
 * (default 28800) from `env`. A blank value is unset. Throws
 * `AuthError.InvalidConfig` naming every bad variable.
 *
 * ```ts
 * const lifetimes = sessionConfig(process.env)
 * ```
 */
export function sessionConfig(
  env: Env,
  options: { readonly prefix?: string } = {},
): SessionConfig {
  const prefix = options.prefix ?? 'AUTH_SESSION_';
  const problems: string[] = [];
  const idleSeconds = positiveInteger(
    env,
    `${prefix}IDLE_SECONDS`,
    DEFAULT_IDLE_SECONDS,
    problems,
  );
  const absoluteSeconds = positiveInteger(
    env,
    `${prefix}ABSOLUTE_SECONDS`,
    DEFAULT_ABSOLUTE_SECONDS,
    problems,
  );
  if (problems.length === 0 && idleSeconds > absoluteSeconds) {
    problems.push(
      `${prefix}IDLE_SECONDS: must not be greater than ${prefix}ABSOLUTE_SECONDS.`,
    );
  }
  if (problems.length > 0) throw invalidConfig(problems);
  return { idleSeconds, absoluteSeconds };
}

/**
 * Throws `AuthError.InvalidConfig` unless both clocks are positive whole
 * seconds and idle is not greater than absolute. Store adapters call it in
 * their constructor.
 */
export function assertSessionConfig(config: SessionConfig): void {
  const problems: string[] = [];
  for (const key of ['idleSeconds', 'absoluteSeconds'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) {
      problems.push(`${key}: must be a positive whole number of seconds.`);
    }
  }
  if (problems.length === 0 && config.idleSeconds > config.absoluteSeconds) {
    problems.push('idleSeconds: must not be greater than absoluteSeconds.');
  }
  if (problems.length > 0) throw invalidConfig(problems);
}

function positiveInteger(
  env: Env,
  name: string,
  fallback: number,
  problems: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    problems.push(`${name}: must be a positive whole number of seconds.`);
    return fallback;
  }
  return value;
}
