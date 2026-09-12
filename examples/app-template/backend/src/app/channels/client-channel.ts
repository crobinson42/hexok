import {
  EventChannel,
  type JoinCtx,
  type RefreshCtx,
  type RouteCtx,
} from 'hexok/app';
import type { Actor } from '../../domain/schemas/actor.js';
import { actorSchema } from '../../domain/schemas/actor.js';
import type { ClientEventCtx } from '../context.js';
import { ClientEvents } from '../events/client/catalog.js';
import { UserRepository } from '../ports/repos/users.js';

export class ClientChannel extends EventChannel {
  static readonly catalog = ClientEvents;
  static readonly ports = { usersRepo: UserRepository };
  static readonly joinInput = actorSchema;
  static readonly errors = {
    FORBIDDEN: { message: 'Forbidden' },
  };

  async join({ input, errors }: JoinCtx<typeof ClientChannel>): Promise<Actor> {
    if (input.type !== 'user') throw errors.FORBIDDEN();
    return input;
  }

  async refresh({
    session,
    ports,
  }: RefreshCtx<typeof ClientChannel>): Promise<Actor | 'eject'> {
    const user = await ports.usersRepo.get(session.userId);

    if (!user) return 'eject';

    return {
      ...session,
      organizationIds: [...user.props.organizationIds],
    };
  }

  async route({ ctx, clients, send }: RouteCtx<typeof ClientChannel>) {
    for (const { id, session } of clients) {
      if (this.clientShouldReceiveEvent(session, ctx)) await send(id);
    }
  }

  private clientShouldReceiveEvent(actor: Actor, ctx: ClientEventCtx): boolean {
    if (ctx.kind === 'authenticated') return actor.type === 'user';
    if (ctx.kind === 'user') return ctx.userIds.includes(actor.userId);
    return ctx.organizationIds.some((id) => actor.organizationIds.includes(id));
  }
}
