import { describe, expect, it } from 'vitest';
import { httpStatus } from './http-status.js';

describe('httpStatus', () => {
  it('maps known codes and defaults to 409', () => {
    expect(httpStatus('NOT_FOUND')).toBe(404);
    expect(httpStatus('VALIDATION')).toBe(400);
    expect(httpStatus('FORBIDDEN')).toBe(403);
    expect(httpStatus('UNAUTHORIZED')).toBe(401);
    expect(httpStatus('ALREADY_CLOSED')).toBe(409);
  });
});
