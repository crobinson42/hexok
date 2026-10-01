import type { StandardSchemaV1 } from 'hexok';
import type { Static, StaticDecode, TSchema } from 'typebox';
import { Validator } from 'typebox/compile';

const vendor = 'typebox';

function pointerPath(pointer: string): readonly PropertyKey[] | undefined {
  if (pointer.length === 0) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function toIssues(
  errors: readonly { message: string; instancePath: string }[],
): readonly StandardSchemaV1.Issue[] {
  return errors.map((error) => {
    const path = pointerPath(error.instancePath);
    if (path === undefined) return { message: error.message };
    return { message: error.message, path };
  });
}

// biome-ignore lint/complexity/noBannedTypes: TypeBox Static defaults its context to {}
type SchemaContext = {};

function wrap<S extends TSchema, Out>(
  schema: S,
  run: (
    validator: Validator<SchemaContext, S>,
    value: unknown,
  ) => StandardSchemaV1.Result<Out>,
): StandardSchemaV1<Out, Out> {
  const validator = new Validator<SchemaContext, S>({}, schema);
  return {
    '~standard': {
      version: 1,
      vendor,
      validate(value: unknown) {
        return run(validator, value);
      },
      types: undefined as unknown as
        | StandardSchemaV1.Types<Out, Out>
        | undefined,
    },
  };
}

/**
 * Standard Schema for a TypeBox schematic.
 * `Check` accepts `Static` (the encode type). Output is that same value.
 */
export function typebox<const S extends TSchema>(
  schema: S,
): StandardSchemaV1<Static<S>, Static<S>> {
  return wrap(schema, (validator, value) => {
    if (!validator.Check(value)) {
      return { issues: toIssues(validator.Errors(value)) };
    }
    return { value };
  });
}

/**
 * Standard Schema that decodes a TypeBox schematic.
 * A failing `Check` reports issues. `Decode` runs only after `Check` passes.
 */
export function typeboxDecode<const S extends TSchema>(
  schema: S,
): StandardSchemaV1<StaticDecode<S>, StaticDecode<S>> {
  return wrap(schema, (validator, value) => {
    if (!validator.Check(value)) {
      return { issues: toIssues(validator.Errors(value)) };
    }
    return { value: validator.Decode(value) };
  });
}
