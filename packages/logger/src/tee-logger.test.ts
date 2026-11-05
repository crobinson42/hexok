import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { Logger } from './logger.js';
import { MemoryLogger } from './memory-logger.js';
import { TeeLogger } from './tee-logger.js';

class BoomLogger extends Adapter(Logger) {
  info(): void {
    throw new Error('boom');
  }

  debug(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

describe('TeeLogger', () => {
  it('forwards each level to every sink in order', () => {
    const first = new MemoryLogger();
    const second = new MemoryLogger();
    const logger = new TeeLogger({ sinks: [first, second] });
    const error = new Error('failed');

    logger.debug('d', { n: 1 });
    logger.info('i');
    logger.warn('w');
    logger.error(error);
    logger.error('plain');

    expect(first.records.map((record) => record.message)).toEqual([
      'd',
      'i',
      'w',
      'failed',
      'plain',
    ]);
    expect(second.records.map((record) => record.level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'error',
    ]);
    expect(first.records[0]?.fields).toEqual({ n: 1 });
    expect(first.records[3]?.error?.message).toBe('failed');
  });

  it('returns a tee whose children keep per-sink bindings', () => {
    const first = new MemoryLogger();
    const second = new MemoryLogger();
    const child = new TeeLogger({ sinks: [first, second] }).child({
      requestId: '1',
    });

    expect(child).toBeInstanceOf(TeeLogger);
    child.info('tick', { ok: true });

    expect(first.records[0]?.fields).toEqual({ requestId: '1', ok: true });
    expect(second.records[0]?.fields).toEqual({ requestId: '1', ok: true });
  });

  it('stops later sinks when one throws', () => {
    const first = new MemoryLogger();
    const later = new MemoryLogger();
    const logger = new TeeLogger({
      sinks: [first, new BoomLogger(), later],
    });

    expect(() => logger.info('tick')).toThrow('boom');
    expect(first.records).toHaveLength(1);
    expect(later.records).toHaveLength(0);
  });

  it('accepts an empty sink list', () => {
    const logger = new TeeLogger({ sinks: [] });
    logger.info('quiet');
    expect(logger.child({ a: 1 })).toBeInstanceOf(TeeLogger);
  });
});
