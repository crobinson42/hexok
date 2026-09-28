import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Actor } from '../../schemas/actor.js';
import type { ActorApiUseCaseCtx } from '../context.js';
import { ActorApiUseCase } from '../factory.js';
import { allowedActorGuard } from './allowed-actor.js';
import { inputValidationGuard } from './input-validation-guard.js';
import { traceIdGuard } from './trace-id.js';

const user: Actor = {
  id: 'user-1',
  roles: [],
  permissions: [],
  type: 'user',
};

const actorCall = {
  ctx: { traceId: 'trace-1', actor: user },
  spec: { allowedActors: ['user'] as Actor['type'][], input: undefined },
  token: 'user.find',
  input: undefined,
};

describe('traceIdGuard', () => {
  it('refuses a missing trace id', () => {
    expect(() => traceIdGuard({ ctx: { traceId: '' } })).toThrow(
      expect.objectContaining({ code: 'TraceIdMissing' }),
    );
  });

  it('accepts a trace id', () => {
    expect(() => traceIdGuard({ ctx: { traceId: 'trace-1' } })).not.toThrow();
  });
});

describe('allowedActorGuard', () => {
  it('refuses an actor type outside the use-case contract', () => {
    expect(() =>
      allowedActorGuard({
        ...actorCall,
        ctx: { traceId: 'trace-1', actor: { ...user, type: 'service' } },
      }),
    ).toThrow(expect.objectContaining({ code: 'Unauthorized' }));
  });

  it('accepts an allowed actor', () => {
    expect(() => allowedActorGuard(actorCall)).not.toThrow();
  });
});

describe('inputValidationGuard', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('parses the input with the use-case schema', () => {
    expect(() =>
      inputValidationGuard({
        ...actorCall,
        spec: { allowedActors: ['user'], input: schema },
        input: { name: '' },
      }),
    ).toThrow(/Input validation failed/);
  });

  it('accepts an input the schema accepts', () => {
    expect(() =>
      inputValidationGuard({
        ...actorCall,
        spec: { allowedActors: ['user'], input: schema },
        input: { name: 'Ada' },
      }),
    ).not.toThrow();
  });

  it('skips a use case with no input schema', () => {
    expect(() => inputValidationGuard(actorCall)).not.toThrow();
  });
});

describe('ActorApiUseCase pipeline', () => {
  const ctx: ActorApiUseCaseCtx = { traceId: 'trace-1', actor: user };

  class Named extends ActorApiUseCase('probe.name', {
    allowedActors: ['user'],
    input: z.object({ name: z.string().min(1) }),
  }) {
    async execute(
      _ctx: ActorApiUseCaseCtx,
      input: { name: string },
    ): Promise<string> {
      return input.name;
    }
  }

  const named = new Named();

  it('rejects a missing trace id before the actor and the input', async () => {
    await expect(
      named.execute({ ...ctx, traceId: '' }, { name: '' }),
    ).rejects.toMatchObject({ code: 'TraceIdMissing' });
  });

  it('rejects a disallowed actor before input validation', async () => {
    await expect(
      named.execute(
        { traceId: 'trace-1', actor: { ...user, type: 'service' } },
        { name: '' },
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('rejects an input the schema refuses', async () => {
    await expect(named.execute(ctx, { name: '' })).rejects.toThrow(
      /Input validation failed/,
    );
  });

  it('returns the input for an allowed actor', async () => {
    await expect(named.execute(ctx, { name: 'Ada' })).resolves.toBe('Ada');
  });
});
