import { fail, type Infer, ok, type Result } from '@plinth/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { Entity } from './entity.js';

const incidentSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.date().nullable(),
});
type IncidentProps = Infer<typeof incidentSchema>;

class Incident extends Entity<IncidentProps> {
  static readonly type = 'Incident';
  static readonly schema = incidentSchema;
  static readonly errors = {
    ALREADY_CLOSED: { status: 409, message: 'Incident already closed' },
  } as const;

  get id() {
    return this.props.id;
  }
  get status() {
    return this.props.status;
  }
  get closedAt() {
    return this.props.closedAt;
  }

  static open(id: string): Incident {
    const created = Incident.create({
      id,
      status: 'open',
      closedAt: null,
    });
    if (!created.ok) throw new Error('plinth: Incident.open failed validation');
    return created.value;
  }

  close(now: Date): Result<Incident, 'ALREADY_CLOSED'> {
    if (this.props.status === 'closed') return fail('ALREADY_CLOSED');
    return ok(this.with({ status: 'closed', closedAt: now }));
  }

  undeclaredFail(): Result<Incident, 'ALREADY_CLOSED'> {
    // @ts-expect-error NOPE is not a declared incident error
    return fail('NOPE');
  }
}

describe('Entity', () => {
  it('create / restore / parse validate via the schema', () => {
    const created = Incident.create({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toBeInstanceOf(Incident);
    expect(created.value.id).toBe('1');

    const restored = Incident.restore(created.value.toProps());
    expect(restored.ok).toBe(true);

    const parsed = Incident.parse({
      id: '2',
      status: 'open',
      closedAt: null,
    });
    expect(parsed.ok).toBe(true);

    const invalid = Incident.parse({ id: 1 });
    expect(invalid).toEqual({ ok: false, code: 'VALIDATION' });
  });

  it('close returns a new instance and leaves the original open', () => {
    const incident = Incident.open('1');
    const now = new Date('2026-01-01T00:00:00Z');
    const closed = incident.close(now);

    expectTypeOf(incident.close).returns.toEqualTypeOf<
      Result<Incident, 'ALREADY_CLOSED'>
    >();

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value).not.toBe(incident);
    expect(closed.value).toBeInstanceOf(Incident);
    expect(closed.value.status).toBe('closed');
    expect(closed.value.closedAt).toEqual(now);
    expect(incident.status).toBe('open');
    expect(incident.closedAt).toBeNull();
  });

  it('close fails with ALREADY_CLOSED', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const incident = Incident.open('1');
    const closed = incident.close(now);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    const again = closed.value.close(now);
    expect(again).toEqual({ ok: false, code: 'ALREADY_CLOSED' });
  });

  it('toJSON / toProps return plain schema output', () => {
    const incident = Incident.open('1');
    expect(incident.toProps()).toEqual({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(incident.toJSON()).toEqual(incident.toProps());
  });

  it('keeps undeclared fail codes as a type error (runtime still returns the code)', () => {
    const result = Incident.open('1').undeclaredFail();
    expect(result).toEqual({ ok: false, code: 'NOPE' });
  });
});
