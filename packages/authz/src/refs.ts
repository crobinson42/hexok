import { AuthzError } from './errors.js';
import type { Actor, Tuple } from './types.js';

const TYPE_NAME = /^[a-z][a-z0-9-]*$/;

export type ParsedRef = {
  readonly type: string;
  readonly id: string;
  readonly userset: string | null;
};

export type ResolvedActor = {
  readonly type: string;
  readonly id: string;
  readonly ref: string;
};

export function isTypeName(value: string): boolean {
  return TYPE_NAME.test(value);
}

export function parseObject(value: string): ParsedRef {
  if (value.includes('\0') || value.includes('#')) {
    throw invalidObject(value);
  }
  const colon = value.indexOf(':');
  if (colon <= 0) throw invalidObject(value);
  const type = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (!isTypeName(type) || !isId(id)) throw invalidObject(value);
  return { type, id, userset: null };
}

export function parseSubject(value: string): ParsedRef {
  if (value.includes('\0')) throw invalidSubject(value);
  const hash = value.indexOf('#');
  if (hash === -1) return parseObject(value);
  const userset = value.slice(hash + 1);
  if (!isTypeName(userset)) throw invalidSubject(value);
  try {
    const object = parseObject(value.slice(0, hash));
    return { type: object.type, id: object.id, userset };
  } catch {
    throw invalidSubject(value);
  }
}

export function formatObject(type: string, id: string): string {
  const ref = `${type}:${id}`;
  parseObject(ref);
  return ref;
}

/** Copy a tuple into the shape the store keeps. Rejects a malformed ref. */
export function assertTuple(value: Tuple): Tuple {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.object !== 'string' ||
    typeof value.relation !== 'string' ||
    typeof value.subject !== 'string'
  ) {
    throw new AuthzError(
      'authz: a tuple needs object, relation, and subject strings.',
    );
  }
  if (value.relation.length === 0 || value.relation.includes('\0')) {
    throw new AuthzError('authz: a tuple needs a relation.');
  }
  parseObject(value.object);
  parseSubject(value.subject);
  return Object.freeze({
    object: value.object,
    relation: value.relation,
    subject: value.subject,
  });
}

export function resolveActor(
  actor: Actor,
  objectTypes: ReadonlySet<string>,
): ResolvedActor {
  if (actor === null || typeof actor !== 'object') {
    throw new AuthzError('authz: actor needs an id.');
  }
  const type = actor.type ?? 'user';
  if (typeof type !== 'string' || !isTypeName(type)) {
    throw new AuthzError(`authz: invalid actor type "${String(type)}".`);
  }
  if (!objectTypes.has(type)) {
    throw new AuthzError(`authz: unknown actor type "${type}".`);
  }
  if (typeof actor.id !== 'string' || !isId(actor.id)) {
    throw new AuthzError('authz: invalid actor id.');
  }
  return { type, id: actor.id, ref: `${type}:${actor.id}` };
}

function isId(id: string): boolean {
  return id.length > 0 && !/[\s#\0]/.test(id);
}

function invalidObject(value: string): AuthzError {
  return new AuthzError(
    `authz: invalid object ref "${value}". Expected type:id.`,
  );
}

function invalidSubject(value: string): AuthzError {
  return new AuthzError(
    `authz: invalid subject ref "${value}". Expected type:id or type:id#relation.`,
  );
}
