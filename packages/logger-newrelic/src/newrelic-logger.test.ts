import { describe, expect, it } from 'vitest';
import { type NewRelicLike, NewRelicLogger } from './newrelic-logger.js';

describe('NewRelicLogger', () => {
  it('forwards only error, as a string or Error, and replaces non-primitives', () => {
    const calls: unknown[][] = [];
    const client: NewRelicLike = {
      noticeError(error, customAttributes) {
        calls.push([error, customAttributes]);
      },
    };
    const logger = new NewRelicLogger({ client }).child({ region: 'us' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('boom', { n: 1, nested: { a: 1 } });
    const error = new Error('failed');
    logger.error(error);
    expect(calls).toEqual([
      ['boom', { region: 'us', n: 1, nested: 'object' }],
      [error, { region: 'us' }],
    ]);
  });
});
