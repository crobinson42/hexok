import { isPFError } from '@ts-pf/protocol';
import { CodedError, validationError } from 'hexok';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../domain/errors/domain.js';
import { declared, toRpcError } from './errors.js';

describe('declared', () => {
  it('adds the status to each domain definition', () => {
    const errors = declared('PostNotFound', 'AlreadyPublished');
    expect(errors.PostNotFound.status).toBe(404);
    expect(errors.PostNotFound.message).toBe('Post was not found');
    expect(errors.PostNotFound.data).toBeDefined();
    expect(errors.AlreadyPublished.status).toBe(409);
  });
});

describe('toRpcError', () => {
  it.each([
    [DomainError.PostNotFound({ id: 'p1' }), 404],
    [DomainError.AlreadyPublished(), 409],
    [DomainError.NotPublished(), 409],
    [DomainError.NotScheduled(), 409],
    [DomainError.PublishAtInvalid({ publishAt: 'x' }), 400],
    [DomainError.ChannelsRequired(), 400],
    [DomainError.ChannelsInvalid(), 400],
    [DomainError.SmsRequiresPhone(), 400],
  ])('keeps the code, message, and data of %s', (error, status) => {
    const rpc = toRpcError(error);
    if (!isPFError(rpc)) throw new Error('expected PFError');
    expect(rpc.toJSON()).toEqual({
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    });
    expect(rpc.status).toBe(status);
  });

  it('keeps an internal domain error from clients', () => {
    const error = DomainError.InternalCallerRequired();
    expect(toRpcError(error)).toBe(error);
  });

  it('sends hexok VALIDATION as the protocol VALIDATION', () => {
    const rpc = toRpcError(
      validationError('Post is invalid', [
        { message: 'Required', path: [{ key: 'title' }, 0] },
      ]),
    );
    if (!isPFError(rpc)) throw new Error('expected PFError');
    expect(rpc.toJSON()).toEqual({
      code: 'VALIDATION',
      message: 'Post is invalid',
      data: { issues: [{ message: 'Required', path: ['title', 0] }] },
    });
  });

  it('passes anything else through', () => {
    const error = new CodedError({ code: 'OTHER' });
    expect(toRpcError(error)).toBe(error);
  });
});
