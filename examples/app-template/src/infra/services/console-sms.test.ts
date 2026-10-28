import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleSms } from './console-sms.js';

describe('ConsoleSms', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the recipient and body', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleSms().send({ to: '+15551234567', body: 'Hello' });
    expect(log).toHaveBeenCalledWith('sms to=+15551234567 body=Hello');
  });

  it('keeps a sensitive message out of the console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleSms().send({
      to: '+15551234567',
      body: 'Your code is 482913',
      sensitive: true,
    });
    const printed = log.mock.calls.flat().join(' ');
    expect(printed).not.toContain('+15551234567');
    expect(printed).not.toContain('482913');
  });
});
