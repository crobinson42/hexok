import { describe, expect, it } from 'vitest';
import { type SentryLike, SentryLogger } from './sentry-logger.js';

function fake() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client: SentryLike = {
    captureException(exception, hint) {
      calls.push({ method: 'captureException', args: [exception, hint] });
      return 'ex';
    },
    captureMessage(message, captureContext) {
      calls.push({ method: 'captureMessage', args: [message, captureContext] });
      return 'msg';
    },
  };
  return { client, calls };
}

describe('SentryLogger', () => {
  it('sends warn and string error as captureMessage with a second-arg context', () => {
    const { client, calls } = fake();
    const logger = new SentryLogger({ client });
    logger.warn('careful', { id: '1' });
    logger.error('boom', { id: '2' });
    expect(calls).toEqual([
      {
        method: 'captureMessage',
        args: ['careful', { level: 'warning', extra: { id: '1' } }],
      },
      {
        method: 'captureMessage',
        args: ['boom', { level: 'error', extra: { id: '2' } }],
      },
    ]);
    expect(calls[1]?.args).toHaveLength(2);
    expect(typeof calls[1]?.args[0]).toBe('string');
  });

  it('sends Error to captureException and ignores debug and info', () => {
    const { client, calls } = fake();
    const logger = new SentryLogger({ client }).child({ component: 'api' });
    const error = new Error('failed');
    logger.debug('d');
    logger.info('i');
    logger.error(error, { requestId: 'r' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('captureException');
    expect(calls[0]?.args[0]).toBe(error);
    expect(calls[0]?.args[1]).toEqual({
      extra: { component: 'api', requestId: 'r' },
    });
  });
});
