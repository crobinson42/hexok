import { describe, expect, it } from 'vitest';
import { MemoryLogger } from './memory-logger.js';
import { NoopLogger } from './noop-logger.js';

describe('MemoryLogger', () => {
  it('stores message and fields and drops debug below info', () => {
    const logger = new MemoryLogger({ minLevel: 'info' });
    logger.debug('hidden', { a: 1 });
    logger.info('shown', { requestId: 'r1' });
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]?.message).toBe('shown');
    expect(logger.records[0]?.level).toBe('info');
    expect(logger.records[0]?.fields).toEqual({ requestId: 'r1' });
    expect(typeof logger.records[0]?.time).toBe('string');
  });

  it('defaults minLevel to debug', () => {
    const logger = new MemoryLogger();
    logger.debug('visible');
    expect(logger.records).toHaveLength(1);
  });

  it('merges child bindings and lets per-call fields win', () => {
    const logger = new MemoryLogger();
    const child = logger.child({ component: 'queue', requestId: 'parent' });
    child.info('tick', { requestId: 'call', extra: true });
    expect(logger.records).toHaveLength(1);
    expect(child).not.toBe(logger);
    expect(logger.records[0]?.fields).toEqual({
      component: 'queue',
      requestId: 'call',
      extra: true,
    });
  });

  it('sets time, level, and message over caller fields', () => {
    const logger = new MemoryLogger();
    logger.info('real', {
      time: 'nope',
      level: 'error',
      message: 'nope',
      ok: 1,
    });
    expect(logger.records[0]?.message).toBe('real');
    expect(logger.records[0]?.level).toBe('info');
    expect(logger.records[0]?.fields).toEqual({ ok: 1 });
  });

  it('records an Error and leaves a string without an error field', () => {
    const logger = new MemoryLogger();
    const error = new Error('boom');
    logger.error(error, { id: '1' });
    logger.error('plain', { id: '2' });
    expect(logger.records[0]?.message).toBe('boom');
    expect(logger.records[0]?.error?.name).toBe('Error');
    expect(logger.records[0]?.error?.message).toBe('boom');
    expect(logger.records[0]?.fields).toEqual({ id: '1' });
    expect(logger.records[1]?.message).toBe('plain');
    expect(logger.records[1]?.error).toBeUndefined();
  });

  it('shares the record array with a child and clear empties it', () => {
    const logger = new MemoryLogger();
    const child = logger.child({ a: 1 }) as MemoryLogger;
    child.info('x');
    expect(child.records).toBe(logger.records);
    logger.clear();
    expect(logger.records).toHaveLength(0);
    expect(child.records).toHaveLength(0);
  });
});

describe('NoopLogger', () => {
  it('returns itself from child and stores nothing', () => {
    const logger = new NoopLogger();
    expect(logger.child({ a: 1 })).toBe(logger);
    logger.info('nope');
    logger.error(new Error('nope'));
  });
});
