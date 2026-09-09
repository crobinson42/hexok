import type { Result } from '@plinth/core';
import type { Entity, EntityConstructor } from '@plinth/domain';

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
  #toFn: (entity: InstanceType<E>) => Row;
  #fromFn: (
    row: Row,
  ) => Result<InstanceType<E>, 'VALIDATION'> | InstanceType<E>;

  private constructor(
    toFn: (entity: InstanceType<E>) => Row,
    fromFn: (
      row: Row,
    ) => Result<InstanceType<E>, 'VALIDATION'> | InstanceType<E>,
  ) {
    this.#toFn = toFn;
    this.#fromFn = fromFn;
  }

  static for<E extends EntityConstructor>(_entity: E): MapperTo<E> {
    return {
      to: <Row>(
        toFn: (entity: InstanceType<E>) => Row,
      ): MapperFrom<E, Row> => ({
        from: (fromFn) => new Mapper(toFn, fromFn),
      }),
    };
  }

  /** Outbound. No parse. */
  to(entity: InstanceType<E> | Entity<unknown>): Row {
    return this.#toFn(entity as InstanceType<E>);
  }

  /** Inbound trust boundary. Throws if entity.parse/restore fails. */
  from(row: Row): InstanceType<E> {
    const result = this.read(row);
    if (!result.ok) throw new Error(TRUST);
    return result.value;
  }

  /**
   * Same mapping, but `from` returns `Result` instead of throwing.
   */
  unsafe(): {
    to: Mapper<E, Row>['to'];
    from: (row: Row) => Result<InstanceType<E>, 'VALIDATION'>;
  } {
    return {
      to: (entity) => this.to(entity),
      from: (row) => this.read(row),
    };
  }

  private read(row: Row): Result<InstanceType<E>, 'VALIDATION'> {
    const result = this.#fromFn(row);
    if (isResult(result)) return result;
    return { ok: true, value: result };
  }
}

export type MapperTo<E extends EntityConstructor> = {
  to<Row>(toFn: (entity: InstanceType<E>) => Row): MapperFrom<E, Row>;
};

export type MapperFrom<E extends EntityConstructor, Row> = {
  from(
    fromFn: (
      row: Row,
    ) => Result<InstanceType<E>, 'VALIDATION'> | InstanceType<E>,
  ): Mapper<E, Row>;
};

function isResult<T>(
  value: Result<T, 'VALIDATION'> | T,
): value is Result<T, 'VALIDATION'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as Result<T, 'VALIDATION'>).ok === 'boolean'
  );
}
