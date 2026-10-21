import { SmsError } from '@hexok/sms';
import { describe, expect, it } from 'vitest';
import type { ParkInput } from './park.js';
import { type TwilioLike, TwilioSmsSender } from './twilio-sms.js';

function sender(create: TwilioLike['messages']['create']): TwilioSmsSender {
  return new TwilioSmsSender({
    from: '+100',
    client: { messages: { create } },
  });
}

describe('TwilioSmsSender', () => {
  it('sends one recipient from adapter config', async () => {
    let body: unknown;
    const result = await sender(async (input) => {
      body = input;
      return { sid: 'SM1', dateCreated: null };
    }).send({ to: '+1555', body: 'hi' });
    expect(body).toEqual({ to: '+1555', from: '+100', body: 'hi' });
    expect(result.id).toBe('SM1');
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('maps Twilio codes and statuses', async () => {
    const cases: Array<[unknown, string]> = [
      [{ code: 21610 }, 'Unsubscribed'],
      [{ code: 21608 }, 'InvalidRecipient'],
      [{ code: 21211 }, 'InvalidRecipient'],
      [{ code: 21614 }, 'InvalidRecipient'],
      [{ code: 20429 }, 'RateLimited'],
      [{ status: 429 }, 'RateLimited'],
      [{ status: 500 }, 'Unavailable'],
      [{ message: 'down' }, 'Unavailable'],
      [{ status: 400, message: 'no' }, 'Rejected'],
    ];
    for (const [thrown, code] of cases) {
      const error = await sender(async () => {
        throw thrown;
      })
        .send({ to: '+1', body: 'x' })
        .catch((caught) => caught);
      expect(SmsError.is(error)).toBe(true);
      if (!SmsError.is(error)) continue;
      expect(error.code).toBe(code);
      if (code === 'RateLimited' || code === 'Unavailable') {
        expect(error.data).toEqual({ retryAfterMs: 30000 });
      }
    }
  });

  it('parks rate limits and outages and skips an unsubscribe', async () => {
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    const cases: Array<[unknown, string, boolean]> = [
      [{ status: 500 }, 'Unavailable', true],
      [{ code: 20429 }, 'RateLimited', true],
      [{ code: 21610 }, 'Unsubscribed', false],
    ];
    for (const [thrown, code, parkedOnce] of cases) {
      const before = parked.length;
      const error = await new TwilioSmsSender({
        from: '+100',
        client: {
          messages: {
            async create() {
              throw thrown;
            },
          },
        },
        quarantine,
      })
        .send({ to: '+1555', body: 'hi' })
        .catch((caught) => caught);
      expect(SmsError.is(error)).toBe(true);
      if (SmsError.is(error)) expect(error.code).toBe(code);
      expect(parked.length).toBe(before + (parkedOnce ? 1 : 0));
    }
    expect(parked[0]?.payload).toEqual({ to: '+1555', body: 'hi' });
    expect(parked[0]?.subject).toBeUndefined();
    expect(parked[0]?.context).toEqual({ adapter: 'twilio' });
  });
});
