import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** How far `webhook-timestamp` may be from now, either way, for {@link verify} to accept it. */
const TOLERANCE_SECONDS = 5 * 60;

const SECRET_PREFIX = 'whsec_';

export interface SignInput {
  /** A `whsec_` secret. The part after the prefix is the base64 key. */
  readonly secret: string;
  /** The `webhook-id` header. */
  readonly id: string;
  /** The `webhook-timestamp` header, in whole seconds since the epoch. */
  readonly timestamp: number;
  /** The exact request body. */
  readonly body: string;
}

export interface VerifyInput {
  /** The `whsec_` secrets to try, such as the new and the old one during a rotation. */
  readonly secrets: readonly string[];
  /** The `webhook-id` header. */
  readonly id: string;
  /** The `webhook-timestamp` header, as received. */
  readonly timestamp: string;
  /** The `webhook-signature` header, as received: space-separated `v1,<base64>` signatures. */
  readonly signature: string;
  /** The exact request body. */
  readonly body: string;
  /** Defaults to now. */
  readonly now?: Date;
}

/** The Standard Webhooks `v1,<base64>` signature of `<id>.<timestamp>.<body>`, an HMAC-SHA256 under the secret's key. */
export function sign(input: SignInput): string {
  const encoded = input.secret.startsWith(SECRET_PREFIX)
    ? input.secret.slice(SECRET_PREFIX.length)
    : input.secret;
  const key = Buffer.from(encoded, 'base64');
  const digest = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest('base64');
  return `v1,${digest}`;
}

/**
 * True when one `v1` signature in the header matches one of the secrets and the timestamp is within 5 minutes of now.
 * A malformed header or timestamp is false, not a throw.
 */
export function verify(input: VerifyInput): boolean {
  if (!/^\d+$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;
  const received = input.signature
    .split(' ')
    .filter((part) => part.startsWith('v1,'))
    .map((part) => Buffer.from(part.slice(3), 'base64'));
  for (const secret of input.secrets) {
    const expected = Buffer.from(
      sign({ secret, id: input.id, timestamp, body: input.body }).slice(3),
      'base64',
    );
    for (const candidate of received) {
      // timingSafeEqual throws on buffers of different lengths.
      if (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** A new `whsec_` secret of 32 random bytes. */
export function generateSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64')}`;
}

/**
 * The `webhook-id` for one event of one organization: `msg_` and the first 26 hex characters of SHA-256 over
 * `organizationId`, a NUL byte, and `eventId`. The same inputs give the same id, so a repeated publish keeps it. It never holds a dot.
 */
export function webhookId(organizationId: string, eventId: string): string {
  const digest = createHash('sha256')
    .update(`${organizationId}\0${eventId}`)
    .digest('hex');
  return `msg_${digest.slice(0, 26)}`;
}
