import { type CatalogAction, defineCatalog } from '@hexok/authz';

/**
 * The only policy for this process.
 * `parent->viewer` and `parent->editor` walk every ancestor.
 */
export const catalog = defineCatalog({
  objects: {
    org: {},
    region: { parent: ['org'] },
    location: { parent: ['region', 'org'] },
    scan: { parent: ['location'] },
    note: { parent: ['scan', 'location'] },
    group: {},
    user: {},
  },
  relations: {
    member: ['user', 'group'],
    viewer: ['user', 'group'],
    editor: ['user', 'group'],
  },
  permissions: {
    'org:view': 'viewer + editor',
    'org:edit': 'editor',
    'region:view': 'viewer + editor + parent->viewer + parent->editor',
    'region:edit': 'editor + parent->editor',
    'location:view': 'viewer + editor + parent->viewer + parent->editor',
    'location:edit': 'editor + parent->editor',
    'scan:view': 'viewer + editor + parent->viewer + parent->editor',
    'scan:edit': 'editor + parent->editor',
    'note:view': 'viewer + editor + parent->viewer + parent->editor',
    'note:edit': 'editor + parent->editor',
    'group:view': 'viewer + editor + member',
    'group:edit': 'editor',
  },
} as const);

export type Action = CatalogAction<typeof catalog>;

const actionNames = [
  'org:view',
  'org:edit',
  'region:view',
  'region:edit',
  'location:view',
  'location:edit',
  'scan:view',
  'scan:edit',
  'note:view',
  'note:edit',
  'group:view',
  'group:edit',
] as const;

type ActionName = (typeof actionNames)[number];
type _missing = Exclude<Action, ActionName>;
type _extra = Exclude<ActionName, Action>;
const _actionsCovered: [_missing] extends [never]
  ? [_extra] extends [never]
    ? true
    : never
  : never = true;
void _actionsCovered;

export const actionNamesList = actionNames;
