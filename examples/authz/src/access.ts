import { type AccessAction, AccessCatalog } from '@hexok/authz/catalog';

/** Web and mobile clients import this file too. */
export class Catalog extends AccessCatalog('example', {
  actions: [
    'location:read',
    'location:manage',
    'scan:read',
    'scan:create',
    'note:read',
    'note:create',
    'note:edit',
    'note:delete',
  ],
}) {}

export type Action = AccessAction<typeof Catalog>;
