import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { CodedError, type Infer } from '../core/index.js';
import { Entity } from '../domain/index.js';
import { Mapper } from './mapper.js';

const schema = z.object({
  id: z.string(),
  closedAt: z.date().nullable(),
});
type Props = Infer<typeof schema>;

class Incident extends Entity<Props> {
  static readonly key = 'Incident';
  static readonly schema = schema;
  static readonly errors = {};
  get id() {
    return this.props.id;
  }
  get closedAt() {
    return this.props.closedAt;
  }
}

const rowOf = (e: Incident) => ({
  id: e.id,
  closed_at: e.closedAt?.toISOString() ?? null,
});

const IncidentMapper = Mapper.for(Incident)
  .to(rowOf)
  .from((row) =>
    Incident.restore({
      id: row.id,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
    }),
  );

const IncidentParseMapper = Mapper.for(Incident)
  .to(rowOf)
  .from((row) =>
    Incident.parse({
      id: row.id,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
    }),
  );

describe('Mapper', () => {
  it('round-trips to/from rows', () => {
    const created = Incident.create({ id: '1', closedAt: null });
    const row = IncidentMapper.to(created);
    expect(row).toEqual({ id: '1', closed_at: null });
    const back = IncidentMapper.from(row);
    expect(back.id).toBe('1');
    expect(back.isValidated).toBe(false);
  });

  it('restore from does not run the schema', () => {
    const back = IncidentMapper.from({
      id: 1 as unknown as string,
      closed_at: null,
    });
    expect(back.id).toBe(1 as unknown as string);
    expect(back.isValidated).toBe(false);
  });

  it('parse from throws CodedError at the trust boundary', () => {
    try {
      IncidentParseMapper.from({
        id: 1 as unknown as string,
        closed_at: null,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'VALIDATION',
        message: 'hexok: model.from() failed entity.parse (trust boundary)',
      });
      expect((error as CodedError).data as { issues: unknown[] }).toEqual(
        expect.objectContaining({
          issues: expect.any(Array),
        }),
      );
    }
  });

  it('unsafe restore from does not run the schema', () => {
    const result = IncidentMapper.unsafe().from({
      id: 1 as unknown as string,
      closed_at: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isValidated).toBe(false);
      expect(result.value.id).toBe(1 as unknown as string);
    }
  });

  it('unsafe from returns Result with issues when parse rejects', () => {
    const result = IncidentParseMapper.unsafe().from({
      id: 1 as unknown as string,
      closed_at: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION');
      expect(result.issues?.length).toBeGreaterThan(0);
    }
  });

  it('to does not accept a different entity class', () => {
    class Other extends Entity<{ name: string }> {
      static readonly key = 'Other';
      static readonly schema = z.object({ name: z.string() });
      static readonly errors = {};
      get name() {
        return this.props.name;
      }
    }

    expectTypeOf(IncidentMapper.to).parameter(0).toEqualTypeOf<Incident>();
    expectTypeOf<Other>().not.toMatchTypeOf<
      Parameters<typeof IncidentMapper.to>[0]
    >();

    const _typeChecks = (other: Other) => {
      // @ts-expect-error Other is not assignable to IncidentMapper.to
      IncidentMapper.to(other);
    };
    void _typeChecks;
  });
});
