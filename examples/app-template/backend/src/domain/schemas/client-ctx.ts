export type ClientCtx =
  | { kind: 'authenticated' }
  | { kind: 'organization'; organizationIds: string[] }
  | { kind: 'user'; userIds: string[] };
