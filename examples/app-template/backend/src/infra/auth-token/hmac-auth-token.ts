import { createHmac, timingSafeEqual } from 'node:crypto';
import { Adapter } from 'hexok/infra';
import { AuthTokenService } from '../../app/ports/services/auth-token.js';
import { type Actor, actorSchema } from '../../domain/schemas/actor.js';

export class HmacAuthToken implements AuthTokenService {
  constructor(private readonly secret: string) {}

  async issue(actor: Actor): Promise<string> {
    const payload = Buffer.from(JSON.stringify(actor)).toString('base64url');
    return `${payload}.${this.#sign(payload)}`;
  }

  async verify(token: string): Promise<Actor | null> {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!signaturesEqual(signature, this.#sign(payload))) return null;
    try {
      const parsed = actorSchema.safeParse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  #sign(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');
  }
}

export const hmacAuthToken = Adapter.of(
  AuthTokenService,
  (secret: string) => new HmacAuthToken(secret),
);

function signaturesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
