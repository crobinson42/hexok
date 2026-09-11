import type { ChannelConnection } from 'hexok/domain';
import type { AuthTokenService } from '../app/ports/services/auth-token.js';
import type { Actor } from '../domain/schemas/actor.js';

export function tokenFromRequest(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return new URL(request.url).searchParams.get('token') ?? '';
}

export async function acceptClient(
  connection: ChannelConnection,
  request: Request,
  token: AuthTokenService,
  channel: {
    join(actor: Actor, connection: ChannelConnection): Promise<unknown>;
  },
): Promise<void> {
  const actor = await token.verify(tokenFromRequest(request));
  if (!actor) {
    connection.close();
    return;
  }
  try {
    await channel.join(actor, connection);
  } catch {
    connection.close();
  }
}
