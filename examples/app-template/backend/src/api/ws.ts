import type { AuthTokenService } from '../app/ports/services/auth-token.js';
import type {
  ClientConnection,
  WebSocketClientBus,
} from '../infra/client-event-bus/index.js';

export function tokenFromRequest(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  return new URL(request.url).searchParams.get('token') ?? '';
}

export async function acceptClient(
  connection: ClientConnection,
  request: Request,
  token: AuthTokenService,
  bus: WebSocketClientBus,
): Promise<void> {
  const actor = await token.verify(tokenFromRequest(request));
  if (!actor) {
    connection.close();
    return;
  }
  bus.connect(actor, connection);
}
