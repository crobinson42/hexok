import { Entity, type StandardSchemaV1 } from 'hexok';
import type { Effect } from './model.js';

type Issue = StandardSchemaV1.Issue;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const isTextList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText);

const isDate = (value: unknown): value is Date => value instanceof Date;

/** Inline Standard Schema: named checks over one object. */
function schemaOf<T>(
  checks: {
    readonly [K in keyof T]-?: (value: unknown) => boolean;
  },
): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'hexok-authz',
      validate(value) {
        const record = (value ?? {}) as Record<string, unknown>;
        const issues: Issue[] = [];
        for (const [key, check] of Object.entries(checks)) {
          if (!(check as (value: unknown) => boolean)(record[key])) {
            issues.push({ message: `${key} is invalid`, path: [key] });
          }
        }
        return issues.length > 0 ? { issues } : { value: value as T };
      },
    },
  };
}

export type PermissionSetProps = {
  id: string;
  orgId: string;
  name: string;
  actions: readonly string[];
  /** The set follows the catalog. Only `BootstrapOrganization` sets it. */
  allActions: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const permissionSetSchema = schemaOf<PermissionSetProps>({
  id: isText,
  orgId: isText,
  name: isText,
  actions: isTextList,
  allActions: (value) => typeof value === 'boolean',
  createdBy: isText,
  createdAt: isDate,
  updatedAt: isDate,
});

/** What can be done: a named list of actions. */
export class PermissionSet extends Entity(
  'PermissionSet',
  permissionSetSchema,
) {
  change(
    input: { readonly name?: string; readonly actions?: readonly string[] },
    now: Date,
  ): this {
    return this.set((draft) => {
      if (input.name !== undefined) draft.name = input.name;
      if (input.actions !== undefined) draft.actions = [...input.actions];
      draft.updatedAt = now;
    });
  }
}

export type GrantProps = {
  id: string;
  orgId: string;
  subject: string;
  setId: string;
  /** Non-empty. The grant applies when every folder is in the record's path. */
  folders: readonly string[];
  effect: Effect;
  createdBy: string;
  createdAt: Date;
};

const grantSchema = schemaOf<GrantProps>({
  id: isText,
  orgId: isText,
  subject: isText,
  setId: isText,
  folders: (value) => isTextList(value) && value.length > 0,
  effect: (value) => value === 'allow' || value === 'deny',
  createdBy: isText,
  createdAt: isDate,
});

/** Who gets a set, and where. */
export class Grant extends Entity('Grant', grantSchema) {}
