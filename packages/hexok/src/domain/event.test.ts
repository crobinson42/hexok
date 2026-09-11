import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { Infer } from '../core/index.js';
import { DomainEvent } from './event.js';

class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed';
  static readonly schema = z.object({
    id: z.string(),
    closedAt: z.date(),
  });
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super();
  }
}

describe('DomainEvent', () => {
  it('constructs with a typed payload and does not validate', () => {
    const payload = { id: '1', closedAt: new Date() };
    const event = new IncidentClosed(payload);
    expect(event.payload).toBe(payload);
    expectTypeOf(event.payload).toEqualTypeOf<{
      id: string;
      closedAt: Date;
    }>();
    expectTypeOf<
      typeof IncidentClosed.key
    >().toEqualTypeOf<'incident.closed'>();
  });
});
