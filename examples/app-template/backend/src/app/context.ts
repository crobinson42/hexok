import type { Actor } from '../domain/schemas/actor.js';

export type AppContext = {
  actor?: Actor;
};

export type ClientEventCtx =
    | { kind: 'authenticated' }
    | { kind: 'organization'; organizationIds: string[] }
    | { kind: 'user'; userIds: string[] };
