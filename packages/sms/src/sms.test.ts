import { describe, expect, it } from 'vitest';
import { assertSmsMessage, SmsError } from './sms.js';

describe('assertSmsMessage', () => {
  it('rejects a blank recipient or body', () => {
    expect(() => assertSmsMessage({ to: ' ', body: 'hi' })).toThrow(
      SmsError.InvalidRecipient(),
    );
    expect(() => assertSmsMessage({ to: '+1555', body: 'hi' })).not.toThrow();
    try {
      assertSmsMessage({ to: '+1', body: '' });
      throw new Error('expected throw');
    } catch (error) {
      expect(SmsError.is(error)).toBe(true);
      if (SmsError.is(error)) expect(error.code).toBe('Rejected');
    }
  });
});
