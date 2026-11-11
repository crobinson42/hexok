import { describe, expect, it } from 'vitest';
import { sessionConfig } from './config.js';
import { AuthError } from './errors.js';

function problemsOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (AuthError.is(error) && error.code === 'InvalidConfig') {
      return error.data.problems;
    }
    throw error;
  }
  throw new Error('expected throw');
}

describe('sessionConfig', () => {
  it('defaults to 30 minutes idle and 8 hours absolute', () => {
    expect(sessionConfig({})).toEqual({
      idleSeconds: 1800,
      absoluteSeconds: 28800,
    });
  });

  it('treats a blank value as unset', () => {
    expect(sessionConfig({ AUTH_SESSION_IDLE_SECONDS: ' ' }).idleSeconds).toBe(
      1800,
    );
  });

  it('reads the variables under a prefix', () => {
    expect(
      sessionConfig(
        { BILLING_IDLE_SECONDS: '600', BILLING_ABSOLUTE_SECONDS: '3600' },
        { prefix: 'BILLING_' },
      ),
    ).toEqual({ idleSeconds: 600, absoluteSeconds: 3600 });
  });

  it('names every bad variable at once', () => {
    expect(
      problemsOf(() =>
        sessionConfig({
          AUTH_SESSION_IDLE_SECONDS: '-1',
          AUTH_SESSION_ABSOLUTE_SECONDS: '1.5',
        }),
      ),
    ).toEqual([
      'AUTH_SESSION_IDLE_SECONDS: must be a positive whole number of seconds.',
      'AUTH_SESSION_ABSOLUTE_SECONDS: must be a positive whole number of seconds.',
    ]);
  });

  it('refuses idle longer than absolute', () => {
    expect(
      problemsOf(() =>
        sessionConfig({
          AUTH_SESSION_IDLE_SECONDS: '7200',
          AUTH_SESSION_ABSOLUTE_SECONDS: '3600',
        }),
      ),
    ).toEqual([
      'AUTH_SESSION_IDLE_SECONDS: must not be greater than AUTH_SESSION_ABSOLUTE_SECONDS.',
    ]);
  });

  it('puts every problem in the error message', () => {
    expect(() => sessionConfig({ AUTH_SESSION_IDLE_SECONDS: 'x' })).toThrow(
      /AUTH_SESSION_IDLE_SECONDS: must be/,
    );
  });
});
