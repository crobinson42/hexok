import { AuthzError } from './errors.js';
import { isTypeName, parseSubject } from './refs.js';
import type { Tuple } from './types.js';

export type ObjectSpec = {
  readonly parent?: readonly string[];
};

/** The product's object types, relations, and permission expressions. */
export type Catalog = {
  readonly objects: { readonly [type: string]: ObjectSpec };
  readonly relations: { readonly [relation: string]: readonly string[] };
  readonly permissions: { readonly [action: string]: string };
};

export type CatalogAction<C> = C extends {
  readonly permissions: infer Permissions;
}
  ? keyof Permissions & string
  : never;

export type CatalogObject<C> = C extends { readonly objects: infer Objects }
  ? keyof Objects & string
  : never;

export type Clause = {
  readonly tupleset: string | null;
  readonly relation: string;
};

export type CompiledPermission = {
  readonly objectType: string;
  readonly clauses: readonly Clause[];
};

export type CompiledCatalog = {
  readonly objectTypes: ReadonlySet<string>;
  readonly objects: ReadonlyMap<string, { readonly parent: readonly string[] }>;
  readonly relations: ReadonlyMap<string, readonly string[]>;
  readonly permissions: ReadonlyMap<string, CompiledPermission>;
  readonly hasMember: boolean;
};

/**
 * Checks the catalog and returns it unchanged.
 * The return type keeps the action names as a string union.
 */
export function defineCatalog<const C>(catalog: C & Catalog): C {
  compileCatalog(catalog);
  return catalog;
}

export function compileCatalog(catalog: Catalog): CompiledCatalog {
  const objects = compileObjects(catalog.objects);
  const relations = compileRelations(catalog.relations, objects);
  const permissions = compilePermissions(
    catalog.permissions,
    objects,
    relations,
  );
  return {
    objectTypes: new Set(objects.keys()),
    objects,
    relations,
    permissions,
    hasMember: relations.has('member'),
  };
}

export function permissionFor(
  compiled: CompiledCatalog,
  action: string,
): CompiledPermission {
  const permission = compiled.permissions.get(action);
  if (!permission) {
    throw new AuthzError(`authz: unknown action "${action}".`);
  }
  return permission;
}

export function assertResourceType(
  permission: CompiledPermission,
  action: string,
  type: string,
): void {
  if (permission.objectType !== type) {
    throw new AuthzError(
      `authz: action "${action}" applies to ${permission.objectType}, not ${type}.`,
    );
  }
}

/** Reject a tuple the catalog does not name. */
export function assertTupleAllowed(
  compiled: CompiledCatalog,
  tuple: Tuple,
): void {
  const object = parseType(tuple.object);
  const subject = parseSubject(tuple.subject);
  if (!compiled.objects.has(object)) {
    throw new AuthzError(`authz: unknown object type "${object}".`);
  }
  if (!compiled.objects.has(subject.type)) {
    throw new AuthzError(`authz: unknown object type "${subject.type}".`);
  }

  if (tuple.relation === 'parent') {
    assertParent(compiled, object, subject);
    return;
  }

  const allowed = compiled.relations.get(tuple.relation);
  if (!allowed) {
    throw new AuthzError(`authz: unknown relation "${tuple.relation}".`);
  }
  if (!allowed.includes(subject.type)) {
    throw new AuthzError(
      `authz: relation ${tuple.relation} does not allow subject type ${subject.type}.`,
    );
  }
  if (
    subject.userset !== null &&
    subject.userset !== 'parent' &&
    !compiled.relations.has(subject.userset)
  ) {
    throw new AuthzError(
      `authz: unknown userset relation "${subject.userset}".`,
    );
  }
}

function assertParent(
  compiled: CompiledCatalog,
  objectType: string,
  subject: { readonly type: string; readonly userset: string | null },
): void {
  const allowed = compiled.objects.get(objectType)?.parent ?? [];
  if (allowed.length === 0) {
    throw new AuthzError(`authz: ${objectType} cannot have a parent.`);
  }
  if (subject.userset !== null) {
    throw new AuthzError('authz: a parent subject must be a concrete object.');
  }
  if (!allowed.includes(subject.type)) {
    throw new AuthzError(
      `authz: ${objectType} parent must be ${formatList(allowed)}, received ${subject.type}.`,
    );
  }
}

function compileObjects(
  value: Catalog['objects'],
): Map<string, { readonly parent: readonly string[] }> {
  if (!isRecord(value)) {
    throw new AuthzError('authz: catalog objects must be an object.');
  }
  const objects = new Map<string, { readonly parent: readonly string[] }>();
  for (const [type, spec] of Object.entries(value)) {
    if (!isTypeName(type)) {
      throw new AuthzError(
        `authz: object type "${type}" is not an identifier.`,
      );
    }
    objects.set(type, { parent: readParentTypes(type, spec) });
  }
  if (objects.size === 0) {
    throw new AuthzError('authz: catalog needs at least one object type.');
  }
  for (const [type, spec] of objects) {
    for (const parent of spec.parent) {
      if (!objects.has(parent)) {
        throw new AuthzError(
          `authz: object "${type}" parent type "${parent}" is unknown.`,
        );
      }
    }
  }
  return objects;
}

function readParentTypes(type: string, spec: unknown): readonly string[] {
  if (!isRecord(spec)) {
    throw new AuthzError(`authz: object "${type}" must be an object.`);
  }
  const parent = spec.parent;
  if (parent === undefined) return [];
  if (!Array.isArray(parent)) {
    throw new AuthzError(`authz: object "${type}" parent must be an array.`);
  }
  const seen = new Set<string>();
  for (const item of parent) {
    if (typeof item !== 'string' || !isTypeName(item)) {
      throw new AuthzError(
        `authz: object "${type}" parent types must be identifiers.`,
      );
    }
    if (seen.has(item)) {
      throw new AuthzError(
        `authz: object "${type}" lists parent type "${item}" more than once.`,
      );
    }
    seen.add(item);
  }
  return [...seen];
}

function compileRelations(
  value: Catalog['relations'],
  objects: ReadonlyMap<string, unknown>,
): Map<string, readonly string[]> {
  if (!isRecord(value)) {
    throw new AuthzError('authz: catalog relations must be an object.');
  }
  const relations = new Map<string, readonly string[]>();
  for (const [name, subjects] of Object.entries(value)) {
    if (name === 'parent') {
      throw new AuthzError(
        'authz: relation "parent" is reserved for the object hierarchy.',
      );
    }
    if (!isTypeName(name)) {
      throw new AuthzError(`authz: relation "${name}" is not an identifier.`);
    }
    relations.set(name, readSubjectTypes(name, subjects, objects));
  }
  return relations;
}

function readSubjectTypes(
  name: string,
  subjects: unknown,
  objects: ReadonlyMap<string, unknown>,
): readonly string[] {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new AuthzError(
      `authz: relation "${name}" needs at least one subject type.`,
    );
  }
  const seen = new Set<string>();
  for (const subject of subjects) {
    if (typeof subject !== 'string' || !isTypeName(subject)) {
      throw new AuthzError(
        `authz: relation "${name}" subject types must be identifiers.`,
      );
    }
    if (seen.has(subject)) {
      throw new AuthzError(
        `authz: relation "${name}" lists subject type "${subject}" more than once.`,
      );
    }
    if (!objects.has(subject)) {
      throw new AuthzError(
        `authz: relation "${name}" allows unknown subject type "${subject}".`,
      );
    }
    seen.add(subject);
  }
  return [...seen];
}

function compilePermissions(
  value: Catalog['permissions'],
  objects: ReadonlyMap<string, unknown>,
  relations: ReadonlyMap<string, readonly string[]>,
): Map<string, CompiledPermission> {
  if (!isRecord(value)) {
    throw new AuthzError('authz: catalog permissions must be an object.');
  }
  const relationNames = new Set(relations.keys());
  const permissions = new Map<string, CompiledPermission>();
  for (const [action, expression] of Object.entries(value)) {
    if (typeof expression !== 'string') {
      throw new AuthzError(
        `authz: permission "${action}" expression must be a string.`,
      );
    }
    const objectType = permissionObject(action, objects);
    permissions.set(action, {
      objectType,
      clauses: parseClauses(action, expression, relationNames),
    });
  }
  return permissions;
}

function permissionObject(
  action: string,
  objects: ReadonlyMap<string, unknown>,
): string {
  const colon = action.indexOf(':');
  if (colon <= 0 || colon === action.length - 1) {
    throw new AuthzError(`authz: permission "${action}" must be type:name.`);
  }
  const objectType = action.slice(0, colon);
  const name = action.slice(colon + 1);
  if (!isTypeName(objectType) || !isTypeName(name)) {
    throw new AuthzError(`authz: permission "${action}" must be type:name.`);
  }
  if (!objects.has(objectType)) {
    throw new AuthzError(
      `authz: permission "${action}" names unknown object "${objectType}".`,
    );
  }
  return objectType;
}

function parseClauses(
  action: string,
  expression: string,
  relations: ReadonlySet<string>,
): Clause[] {
  if (expression.trim() === '') {
    throw new AuthzError(
      `authz: permission "${action}" has an empty expression.`,
    );
  }
  const clauses: Clause[] = [];
  for (const raw of expression.split('+')) {
    const part = raw.trim();
    if (part === '') {
      throw new AuthzError(
        `authz: permission "${action}" has an empty clause.`,
      );
    }
    const pieces = part.split('->').map((item) => item.trim());
    if (pieces.length > 2) {
      throw new AuthzError(
        `authz: permission "${action}" clause "${part}" must be a relation or tupleset->relation.`,
      );
    }
    const left = pieces[0];
    const right = pieces[1];
    if (right !== undefined) {
      if (left === undefined || left === '' || right === '') {
        throw new AuthzError(
          `authz: permission "${action}" has an empty clause.`,
        );
      }
      assertTupleset(action, left, relations);
      assertRelation(action, right, relations);
      clauses.push({ tupleset: left, relation: right });
      continue;
    }
    if (left === undefined || left === '') {
      throw new AuthzError(
        `authz: permission "${action}" has an empty clause.`,
      );
    }
    assertRelation(action, left, relations);
    clauses.push({ tupleset: null, relation: left });
  }
  return clauses;
}

function assertRelation(
  action: string,
  relation: string,
  relations: ReadonlySet<string>,
): void {
  if (!relations.has(relation)) {
    throw new AuthzError(
      `authz: permission "${action}" references unknown relation "${relation}".`,
    );
  }
}

function assertTupleset(
  action: string,
  tupleset: string,
  relations: ReadonlySet<string>,
): void {
  if (tupleset !== 'parent' && !relations.has(tupleset)) {
    throw new AuthzError(
      `authz: permission "${action}" references unknown tupleset "${tupleset}".`,
    );
  }
}

function parseType(object: string): string {
  const colon = object.indexOf(':');
  return colon === -1 ? object : object.slice(0, colon);
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  const head = values.slice(0, -1).join(', ');
  return `${head} or ${values[values.length - 1] ?? ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
