import { describe, expect, it } from 'vitest';
import { CodedError } from './coded-error.js';

describe('CodedError', () => {
  it('defaults status to 400 and message to the code', () => {
    const error = new CodedError({ code: 'NOT_FOUND' });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(400);
    expect(error.message).toBe('NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
  });

  it('carries status, message, and data', () => {
    const error = new CodedError({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Incident not found',
      data: { id: '1' },
    });
    expect(error.status).toBe(404);
    expect(error.message).toBe('Incident not found');
    expect(error.data).toEqual({ id: '1' });
  });
});
