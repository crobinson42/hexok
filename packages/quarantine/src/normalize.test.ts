import { CodedError } from 'hexok';
import { describe, expect, it } from 'vitest';
import { normalizeFailure } from './normalize.js';

describe('normalizeFailure', () => {
  it('keeps name and message for an Error', () => {
    const error = new Error('down');
    error.name = 'Boom';
    expect(normalizeFailure(error)).toEqual({ name: 'Boom', message: 'down' });
  });

  it('adds code for a CodedError and catalog codes for a catalog-shaped error', () => {
    expect(
      normalizeFailure(new CodedError({ code: 'VALIDATION', message: 'no' })),
    ).toEqual({ name: 'CodedError', message: 'no', code: 'VALIDATION' });
    const catalog = Object.assign(new Error('rejected'), {
      code: 'Rejected',
      catalog: 'email',
    });
    expect(normalizeFailure(catalog)).toEqual({
      name: 'Error',
      message: 'rejected',
      code: 'Rejected',
      catalog: 'email',
    });
  });

  it('reads catalog and code from a non-Error object and stringifies the rest', () => {
    expect(
      normalizeFailure({
        name: 'Sms',
        message: 'later',
        code: 'RateLimited',
        catalog: 'sms',
      }),
    ).toEqual({
      name: 'Sms',
      message: 'later',
      code: 'RateLimited',
      catalog: 'sms',
    });
    expect(normalizeFailure('offline')).toEqual({
      name: 'Error',
      message: 'offline',
    });
  });
});
