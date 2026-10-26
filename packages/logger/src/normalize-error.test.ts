import { describe, expect, it } from 'vitest';
import { normalizeError } from './normalize-error.js';

describe('normalizeError', () => {
  it('maps an Error and omits a non-string stack', () => {
    const error = new Error('boom');
    Object.defineProperty(error, 'stack', { value: 12 });
    expect(normalizeError(error)).toEqual({ name: 'Error', message: 'boom' });
  });

  it('keeps a string stack', () => {
    const error = new Error('boom');
    expect(normalizeError(error)?.stack).toBe(error.stack);
  });

  it('leaves strings as non-errors', () => {
    expect(normalizeError('boom')).toBeUndefined();
    expect(normalizeError(null)).toBeUndefined();
  });
});
