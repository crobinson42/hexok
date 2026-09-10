import { CodedError, fail, ok, type Result } from '../core/index.js';
import type { EntityConstructor } from '../domain/index.js';

const TRUST = 'plinth: model.from() failed entity.parse (trust boundary)';

/**
 * One entity, two functions. Inbound `from` is the trust boundary.
 *
 * ```ts
 * const IncidentMapper = Mapper.for(Incident)
 *   .to((e) => ({ id: e.id, closed_at: e.closedAt?.toISOString() ?? null }))
 *   .from((row) => Incident.restore({
 *     id: row.id,
 *     closedAt: row.closed_at ? new Date(row.closed_at) : null,
 *   }))
 * ```
 */
export class Mapper<E extends EntityConstructor, Row> {
  #toFn: (entity: E['prototype']) => Row;
  #fromFn: (row: Row) => E['prototype'];

  private constructor(
    toFn: (entity: E['prototype']) => Row,
    fromFn: (row: Row) => E['prototype'],
  ) {
    this.#toFn = toFn;
    this.#fromFn = fromFn;
  }

  static for<E extends EntityConstructor>(_entity: E): MapperTo<E> {
    return {
      to: <Row>(toFn: (entity: E['prototype']) => Row): MapperFrom<E, Row> => ({
        from: (fromFn) => new Mapper(toFn, fromFn),
      }),
    };
  }

  /** Outbound. No parse. */
  to(entity: E['prototype']): Row {
    return this.#toFn(entity);
  }

  /** Inbound trust boundary. Throws if entity.parse/restore fails. */
  from(row: Row): E['prototype'] {
    try {
      return this.#fromFn(row);
    } catch (error) {
      if (isValidation(error)) throw new Error(TRUST);
      throw error;
    }
  }

  /**
   * Same mapping, but `from` returns `Result` instead of throwing.
   */
  unsafe(): {
    to: Mapper<E, Row>['to'];
    from: (row: Row) => Result<E['prototype'], 'VALIDATION'>;
  } {
    return {
      to: (entity) => this.to(entity),
      from: (row) => {
        try {
          return ok(this.#fromFn(row));
        } catch (error) {
          if (isValidation(error)) return fail('VALIDATION');
          throw error;
        }
      },
    };
  }
}

export type MapperTo<E extends EntityConstructor> = {
  to<Row>(toFn: (entity: E['prototype']) => Row): MapperFrom<E, Row>;
};

export type MapperFrom<E extends EntityConstructor, Row> = {
  from(fromFn: (row: Row) => E['prototype']): Mapper<E, Row>;
};

function isValidation(error: unknown): boolean {
  return error instanceof CodedError && error.code === 'VALIDATION';
}
