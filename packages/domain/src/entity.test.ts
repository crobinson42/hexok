import { CodedError, type Infer } from '@plinth/core';
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
  static readonly key = 'Incident';
  static readonly schema = incidentSchema;
  static readonly errors = {
    ALREADY_CLOSED: { message: 'Incident already closed' },
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
    return Incident.create({
      id,
      status: 'open',
      closedAt: null,
    });
  }

  close(now: Date): Incident {
    if (this.props.status === 'closed') Incident.error('ALREADY_CLOSED');
    return this.with({ status: 'closed', closedAt: now });
  }
}

describe('Entity', () => {
  it('constructor is protected; factories return the subclass', () => {
    expectTypeOf(
      Incident.create({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    expectTypeOf(
      Incident.restore({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    expectTypeOf(
      Incident.parse({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    const _typeChecks = () => {
      // @ts-expect-error Entity constructor is protected
      new Incident({ id: '1', status: 'open', closedAt: null });
    };
    void _typeChecks;
  });

  it('create / restore / parse validate via the schema', () => {
    const created = Incident.create({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(created).toBeInstanceOf(Incident);
    expect(created.id).toBe('1');

    const restored = Incident.restore(created.toProps());
    expect(restored).toBeInstanceOf(Incident);

    const parsed = Incident.parse({
      id: '2',
      status: 'open',
      closedAt: null,
    });
    expect(parsed).toBeInstanceOf(Incident);

    try {
      Incident.parse({ id: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'VALIDATION',
        message: 'plinth: Incident validation failed',
      });
    }
  });

  it('close returns a new instance and leaves the original open', () => {
    const incident = Incident.open('1');
    const now = new Date('2026-01-01T00:00:00Z');
    const closed = incident.close(now);

    expectTypeOf(incident.close).returns.toEqualTypeOf<Incident>();

    expect(closed).not.toBe(incident);
    expect(closed).toBeInstanceOf(Incident);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toEqual(now);
    expect(incident.status).toBe('open');
    expect(incident.closedAt).toBeNull();
  });

  it('close throws ALREADY_CLOSED', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const incident = Incident.open('1');
    const closed = incident.close(now);
    try {
      closed.close(now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'ALREADY_CLOSED',
        message: 'Incident already closed',
      });
    }
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

  it('undeclared error code is a type error on the class and a throw at runtime', () => {
    const _declared: () => never = () => Incident.error('ALREADY_CLOSED');
    void _declared;
    expect(() =>
      // @ts-expect-error NOPE is not a declared incident error
      Incident.error('NOPE'),
    ).toThrow('plinth: undeclared error "NOPE" on Incident');
    expect(() => Incident.open('1').error('NOPE')).toThrow(
      'plinth: undeclared error "NOPE" on Incident',
    );
  });
});
