import {
  assertResourceType,
  type Clause,
  type CompiledCatalog,
  permissionFor,
} from './catalog.js';
import { AuthzError } from './errors.js';
import { parseObject, parseSubject, type ResolvedActor } from './refs.js';
import type { Explanation, ExplanationStep, TupleReader } from './types.js';

/**
 * A hierarchy or membership chain longer than this is rejected.
 * The limit keeps a bad tuple from overflowing the stack.
 */
const MAX_WALK = 32;

type Walk = {
  readonly compiled: CompiledCatalog;
  readonly reader: TupleReader;
  readonly actor: ResolvedActor;
  readonly visiting: Set<string>;
};

export function evaluate(input: {
  readonly compiled: CompiledCatalog;
  readonly reader: TupleReader;
  readonly actor: ResolvedActor;
  readonly action: string;
  readonly resource: string;
}): Explanation {
  const permission = permissionFor(input.compiled, input.action);
  const resource = parseObject(input.resource);
  assertResourceType(permission, input.action, resource.type);
  const steps = matchClauses(
    {
      compiled: input.compiled,
      reader: input.reader,
      actor: input.actor,
      visiting: new Set(),
    },
    input.resource,
    permission.clauses,
  );
  return {
    allowed: steps !== null,
    action: input.action,
    resource: input.resource,
    actor: input.actor.ref,
    steps: steps ?? [],
  };
}

function matchClauses(
  walk: Walk,
  resource: string,
  clauses: readonly Clause[],
): ExplanationStep[] | null {
  for (const clause of clauses) {
    const steps =
      clause.tupleset === null
        ? holdsRelation(walk, resource, clause.relation, 0)
        : holdsOnAncestors(walk, resource, clause.tupleset, clause.relation, 0);
    if (steps) return steps;
  }
  return null;
}

function holdsRelation(
  walk: Walk,
  object: string,
  relation: string,
  depth: number,
): ExplanationStep[] | null {
  assertDepth(depth);
  const key = `${object}\0${relation}`;
  if (walk.visiting.has(key)) return null;
  walk.visiting.add(key);
  try {
    for (const tuple of walk.reader.read(object, relation)) {
      const steps = matchTuple(walk, object, relation, tuple.subject, depth);
      if (steps) return steps;
    }
    return null;
  } finally {
    walk.visiting.delete(key);
  }
}

function matchTuple(
  walk: Walk,
  object: string,
  relation: string,
  subject: string,
  depth: number,
): ExplanationStep[] | null {
  const parsed = parseSubject(subject);
  if (parsed.userset === null && subject === walk.actor.ref) {
    return [{ object, relation, subject, via: 'direct' }];
  }

  const nested =
    parsed.userset === null
      ? expandMember(walk, parsed.type, subject, depth)
      : holdsRelation(
          walk,
          `${parsed.type}:${parsed.id}`,
          parsed.userset,
          depth + 1,
        );
  if (!nested) return null;
  return [{ object, relation, subject, via: 'userset' }, ...nested];
}

/**
 * A concrete subject expands through `member` when its type differs from the
 * actor. Same-type subjects stay exact, so one user does not inherit another
 * user's grants. An explicit `#relation` subject does that walk by name.
 */
function expandMember(
  walk: Walk,
  subjectType: string,
  subject: string,
  depth: number,
): ExplanationStep[] | null {
  if (!walk.compiled.hasMember || subjectType === walk.actor.type) return null;
  return holdsRelation(walk, subject, 'member', depth + 1);
}

function holdsOnAncestors(
  walk: Walk,
  object: string,
  tupleset: string,
  relation: string,
  depth: number,
): ExplanationStep[] | null {
  assertDepth(depth);
  const key = `${object}\0${tupleset}\0${relation}\0walk`;
  if (walk.visiting.has(key)) return null;
  walk.visiting.add(key);
  try {
    for (const tuple of walk.reader.read(object, tupleset)) {
      const parsed = parseSubject(tuple.subject);
      if (parsed.userset !== null) continue;
      const steps = ancestorSteps(
        walk,
        object,
        tupleset,
        relation,
        tuple.subject,
        depth,
      );
      if (steps) return steps;
    }
    return null;
  } finally {
    walk.visiting.delete(key);
  }
}

function ancestorSteps(
  walk: Walk,
  object: string,
  tupleset: string,
  relation: string,
  parent: string,
  depth: number,
): ExplanationStep[] | null {
  const direct = holdsRelation(walk, parent, relation, depth + 1);
  const nested =
    direct ?? holdsOnAncestors(walk, parent, tupleset, relation, depth + 1);
  if (!nested) return null;
  return [
    { object, relation: tupleset, subject: parent, via: 'ancestor' },
    ...nested,
  ];
}

function assertDepth(depth: number): void {
  if (depth > MAX_WALK) {
    throw new AuthzError(
      `authz: relationship walk exceeded ${MAX_WALK} steps.`,
    );
  }
}
