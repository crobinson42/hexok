import { describe, expect, it } from 'vitest';
import { allows } from './level.js';

describe('allows', () => {
  it('orders debug < info < warn < error', () => {
    expect(allows('debug', 'info')).toBe(false);
    expect(allows('info', 'info')).toBe(true);
    expect(allows('warn', 'info')).toBe(true);
    expect(allows('error', 'warn')).toBe(true);
    expect(allows('info', 'warn')).toBe(false);
  });
});
