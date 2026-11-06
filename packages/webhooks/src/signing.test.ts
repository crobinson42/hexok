import { describe, expect, it } from 'vitest';
import { generateSecret, sign, verify, webhookId } from './signing.js';

const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const timestamp = 1614265330;
const body = '{"test": 2432232314}';
const at = new Date(timestamp * 1000);

describe('sign', () => {
  it('matches the Standard Webhooks library vector', () => {
    expect(sign({ secret, id, timestamp, body })).toBe(
      'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    );
  });
});

describe('verify', () => {
  const signature = sign({ secret, id, timestamp, body });
  const valid = {
    secrets: [secret],
    id,
    timestamp: String(timestamp),
    signature,
    body,
    now: at,
  };

  it('accepts a matching signature within the tolerance', () => {
    expect(verify(valid)).toBe(true);
    expect(verify({ ...valid, now: new Date(at.getTime() + 299_000) })).toBe(
      true,
    );
  });

  it('rejects a changed body, a wrong secret, and a malformed signature', () => {
    expect(verify({ ...valid, body: '{"test": 2432232315}' })).toBe(false);
    expect(verify({ ...valid, secrets: [generateSecret()] })).toBe(false);
    for (const malformed of [
      '',
      'v1,',
      'v1,not base64!',
      'v1,AAAA',
      'v2,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      signature.slice(0, -2),
    ]) {
      expect(verify({ ...valid, signature: malformed })).toBe(false);
    }
    expect(verify({ ...valid, timestamp: '16142653.30' })).toBe(false);
    expect(verify({ ...valid, timestamp: 'soon' })).toBe(false);
  });

  it('rejects a timestamp 6 minutes off in either direction', () => {
    for (const offset of [-360_000, 360_000]) {
      expect(verify({ ...valid, now: new Date(at.getTime() + offset) })).toBe(
        false,
      );
    }
  });

  it('uses toleranceMs in place of 5 minutes, and is false for a tolerance that is not a number zero or more', () => {
    const later = new Date(at.getTime() + 600_000);
    expect(verify({ ...valid, now: later })).toBe(false);
    expect(verify({ ...valid, now: later, toleranceMs: 900_000 })).toBe(true);
    expect(verify({ ...valid, now: later, toleranceMs: 599_000 })).toBe(false);
    expect(verify({ ...valid, toleranceMs: 0 })).toBe(true);
    expect(verify({ ...valid, toleranceMs: -1 })).toBe(false);
    expect(verify({ ...valid, toleranceMs: Number.NaN })).toBe(false);
  });

  it('accepts either of two secrets, and either of two signatures', () => {
    const next = generateSecret();
    expect(verify({ ...valid, secrets: [next, secret] })).toBe(true);
    const both = `${sign({ secret: next, id, timestamp, body })} ${signature}`;
    expect(verify({ ...valid, signature: both })).toBe(true);
    expect(verify({ ...valid, secrets: [next], signature: both })).toBe(true);
  });
});

describe('generateSecret', () => {
  it('is whsec_ and 32 random bytes', () => {
    const generated = generateSecret();
    expect(generated).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(generated.slice(6), 'base64')).toHaveLength(32);
    expect(generateSecret()).not.toBe(generated);
  });
});

describe('webhookId', () => {
  it('is stable, separates its inputs, and never holds a dot', () => {
    expect(webhookId('org', 'report.submitted:1:2')).toBe(
      webhookId('org', 'report.submitted:1:2'),
    );
    expect(webhookId('a:b', 'c')).not.toBe(webhookId('a', 'b:c'));
    expect(webhookId('org', 'a')).not.toBe(webhookId('org', 'b'));
    for (const [organizationId, eventId] of [
      ['org.with.dots', 'event.with.dots'],
      ['', ''],
      ['org', 'report.submitted:1:2'],
    ] as const) {
      const value = webhookId(organizationId, eventId);
      expect(value).toMatch(/^msg_[0-9a-f]{26}$/);
      expect(value).not.toContain('.');
    }
  });
});
