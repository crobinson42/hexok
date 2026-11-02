import type { Actor } from '@hexok/authz';
import { DomainError } from '../../domain/errors/domain.js';

/**
 * `alice` is `user:alice`. `group:night-crew` is that group.
 * The header stands in for the product gateway. Authz does not read it.
 */
export function actorFromHeader(value: string | null): Actor {
  if (value === null || value.trim() === '') {
    throw DomainError.ActorRequired();
  }
  const header = value.trim();
  const colon = header.indexOf(':');
  if (colon === -1) return { id: header };
  const type = header.slice(0, colon);
  const id = header.slice(colon + 1);
  if (type.length === 0 || id.length === 0) {
    throw DomainError.ActorInvalid();
  }
  if (type === 'user') return { id };
  return { type, id };
}

/** The subject ref authz stores for this actor. */
export function actorRef(actor: Actor): string {
  return `${actor.type ?? 'user'}:${actor.id}`;
}
