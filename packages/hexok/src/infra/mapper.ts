import {
  CodedError,
  fail,
  ok,
  type Result,
  type StandardSchemaV1,
} from '../core/index.js';
import type { EntityConstructor } from '../domain/index.js';

const TRUST = 'hexok: model.from() failed entity.parse (trust boundary)';

/**
 * One entity, two functions. Inbound `from` wraps the mapping.
 * `restore` does not run the schema; `parse` does (untyped trust
 * boundary). `VALIDATION` from `parse` / `create` / `set` is rethrown
 * with a mapper message.
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

  /** Start a mapper for this entity class. Chain `.to` then `.from`. */
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

  /** Run the inbound mapping. Rethrows `VALIDATION` from `parse` / `create` / `set`. */
  from(row: Row): E['prototype'] {
    try {
      return this.#fromFn(row);
    } catch (error) {
      if (isValidation(error)) {
        throw new CodedError({
          code: error.code,
          message: TRUST,
          ...(error.data !== undefined ? { data: error.data } : {}),
        });
      }
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
          if (isValidation(error)) {
            const issues = (
              error.data as
                | { issues?: readonly StandardSchemaV1.Issue[] }
                | undefined
            )?.issues;
            return fail('VALIDATION', issues);
          }
          throw error;
        }
      },
    };
  }
}

/** Next step after `Mapper.for`. Call `.to` with the outbound mapping. */
export type MapperTo<E extends EntityConstructor> = {
  /** Set the outbound mapping (entity → row). Returns the `.from` builder. */
  to<Row>(toFn: (entity: E['prototype']) => Row): MapperFrom<E, Row>;
};

/** Next step after `.to`. Call `.from` with the inbound mapping to finish. */
export type MapperFrom<E extends EntityConstructor, Row> = {
  /**
   * Set the inbound mapping (row → entity) and return the mapper.
   * `restore` does not run the schema; `parse` does.
   */
  from(fromFn: (row: Row) => E['prototype']): Mapper<E, Row>;
};

function isValidation(error: unknown): error is CodedError {
  return error instanceof CodedError && error.code === 'VALIDATION';
}
