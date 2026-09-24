import { describe, expect, it } from 'vitest';
import { CodedError } from './coded-error.js';

describe('CodedError', () => {
  it('defaults message to the code', () => {
    const error = new CodedError({ code: 'NOT_FOUND' });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
  });

  it('carries message and data', () => {
    const error = new CodedError({
      code: 'NOT_FOUND',
      message: 'Incident not found',
      data: { id: '1' },
    });
    expect(error.message).toBe('Incident not found');
    expect(error.data).toEqual({ id: '1' });
  });
});
