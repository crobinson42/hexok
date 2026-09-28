// biome-ignore-all lint/complexity/noUselessConstructor: protected base constructors are not publicly constructable
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { SchemaSource } from './index.js';
import { type InferSchema, Schema } from './schema.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import { UseCase } from './use-case.js';

type ApiContext = { sessionId: string };

const querySchema = z.object({
  query: z.string().transform((value) => value.trim()),
});

describe('UseCase', () => {
  it('types a one-argument execute and rejects a second factory argument', async () => {
    class CreateUser extends UseCase('user.create') {
      constructor() {
        super();
      }

      override async execute(input: {
        email: string;
      }): Promise<{ id: string }> {
        return { id: input.email };
      }
    }

    const create = new CreateUser();
    expectTypeOf(CreateUser.token).toEqualTypeOf<'user.create'>();
    expectTypeOf(create.execute).parameters.toEqualTypeOf<
      [{ email: string }]
    >();
    expectTypeOf(create.execute).returns.toEqualTypeOf<
      Promise<{ id: string }>
    >();
    expect(CreateUser.token).toBe('user.create');
    await expect(create.execute({ email: 'a@b.c' })).resolves.toEqual({
      id: 'a@b.c',
    });

    // @ts-expect-error a use case does not take a second argument
    class Mapped extends UseCase('mapped', { UserExists: {} }) {
      override async execute(): Promise<void> {}
    }
    void Mapped;
  });
});

describe('UseCase.context', () => {
  const Plain = UseCase.context<ApiContext>();

  it('types execute from the subclass and does not wrap the input', async () => {
    class Echo extends Plain('echo') {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        input: { query: string },
      ): Promise<{ query: string }> {
        return input;
      }
    }

    const echo = new Echo();
    const input = { query: 'ada' };
    expectTypeOf(Echo.token).toEqualTypeOf<'echo'>();
    expectTypeOf(echo.execute).parameters.toEqualTypeOf<
      [ApiContext, { query: string }]
    >();
    expectTypeOf(echo.execute).returns.toEqualTypeOf<
      Promise<{ query: string }>
    >();
    expect(Echo.token).toBe('echo');
    expect(Object.hasOwn(echo, 'execute')).toBe(false);
    await expect(echo.execute({ sessionId: 's' }, input)).resolves.toBe(input);

    // @ts-expect-error missing execute
    class Forgot extends Plain('forgot') {}
    void Forgot;
  });

  const ApiUseCase = UseCase.context<
    ApiContext,
    { input: StandardSchemaV1; permission: string }
  >().guard((call) => {
    if (call.ctx.sessionId.length < 1) throw new Error('unauthorized');
  });

  class FindUsers extends ApiUseCase('user.find', {
    input: querySchema,
    permission: 'users.read',
    area: 'billing',
  }) {
    constructor(
      private readonly users: { search(query: string): Promise<string[]> },
    ) {
      super();
    }

    override async execute(
      _ctx: ApiContext,
      input: InferSchema<(typeof FindUsers)['input']>,
    ): Promise<string[]> {
      return this.users.search(input.query);
    }
  }

  it('copies statics onto the class', () => {
    const find = new FindUsers({
      async search(query) {
        return [query];
      },
    });
    expectTypeOf(FindUsers.token).toEqualTypeOf<'user.find'>();
    expectTypeOf(FindUsers.permission).toEqualTypeOf<'users.read'>();
    expectTypeOf(FindUsers.area).toEqualTypeOf<'billing'>();
    expectTypeOf(FindUsers.input).toEqualTypeOf<typeof querySchema>();
    expectTypeOf(find.execute).parameters.toEqualTypeOf<
      [ApiContext, { query: string }]
    >();
    expectTypeOf(find.execute).returns.toEqualTypeOf<Promise<string[]>>();
    expect(FindUsers.token).toBe('user.find');
    expect(FindUsers.permission).toBe('users.read');
    expect(FindUsers.area).toBe('billing');
    expect(FindUsers.input).toBe(querySchema);
  });

  it('rejects a missing contract, a bad input, and a reserved static', () => {
    // @ts-expect-error missing statics
    class MissingBag extends ApiUseCase('user.find') {
      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<void> {}
    }
    void MissingBag;

    // @ts-expect-error input is required
    class MissingInput extends ApiUseCase('user.find', {
      permission: 'users.read',
    }) {
      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<void> {}
    }
    void MissingInput;

    class StringInput extends ApiUseCase('user.find', {
      // @ts-expect-error input must be a schema
      input: 'nope',
      permission: 'users.read',
    }) {
      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<void> {}
    }
    void StringInput;

    class TokenBag extends ApiUseCase('user.find', {
      input: querySchema,
      permission: 'users.read',
      // @ts-expect-error token is reserved
      token: 'nope',
    }) {
      override async execute(
        _ctx: ApiContext,
        _input: { query: string },
      ): Promise<void> {}
    }
    void TokenBag;
  });

  it('reads the guard parameters from the factory', () => {
    expectTypeOf<UseCase.GuardParameters<typeof ApiUseCase>>().toEqualTypeOf<{
      readonly ctx: ApiContext;
      readonly spec: { input: StandardSchemaV1; permission: string };
      readonly token: string;
      readonly input: unknown;
    }>();
    expectTypeOf<UseCase.GuardParameters<typeof Plain>>().toEqualTypeOf<{
      readonly ctx: ApiContext;
      readonly spec: Record<never, never>;
      readonly token: string;
      readonly input: unknown;
    }>();

    class OneArg extends UseCase('one.arg') {
      override async execute(): Promise<void> {}
    }
    expectTypeOf<
      UseCase.GuardParameters<typeof OneArg>
    >().toEqualTypeOf<never>();
    expect(Object.getOwnPropertySymbols(ApiUseCase)).toEqual([]);
    expect(Object.getOwnPropertySymbols(Plain)).toEqual([]);
  });

  it('runs the guard, then the method, with the caller argument unchanged', async () => {
    const stages: string[] = [];
    let seen: { query: string } | undefined;
    let seenSpec: { input: StandardSchemaV1; permission: string } | undefined;
    let seenInput: unknown;
    let seenToken: string | undefined;
    const Api = UseCase.context<
      ApiContext,
      { input: StandardSchemaV1; permission: string }
    >().guard((call) => {
      stages.push('guard');
      seenSpec = call.spec;
      seenInput = call.input;
      seenToken = call.token;
      expectTypeOf(call.spec.permission).toEqualTypeOf<string>();
      expectTypeOf(call.spec.input).toEqualTypeOf<StandardSchemaV1>();
      expectTypeOf(call.input).toEqualTypeOf<unknown>();
      // @ts-expect-error extra statics are not part of the contract
      void call.spec.area;
      if (call.ctx.sessionId.length < 1) throw new Error('unauthorized');
    });

    class Find extends Api('user.find', {
      input: querySchema,
      permission: 'users.read',
    }) {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        input: { query: string },
      ): Promise<string> {
        stages.push('body');
        seen = input;
        return input.query;
      }
    }

    const find = new Find();
    expect(Object.hasOwn(find, 'execute')).toBe(true);
    await expect(
      find.execute({ sessionId: 's' }, { query: ' ada ' }),
    ).resolves.toBe(' ada ');
    expect(stages).toEqual(['guard', 'body']);
    expect(seen).toEqual({ query: ' ada ' });
    expect(seenInput).toEqual({ query: ' ada ' });
    expect(seenToken).toBe('user.find');
    expect(seenSpec?.permission).toBe('users.read');
    expect(seenSpec?.input).toBe(querySchema);

    stages.length = 0;
    await expect(
      find.execute({ sessionId: '' }, {} as { query: string }),
    ).rejects.toThrow('unauthorized');
    expect(stages).toEqual(['guard']);
  });

  it('passes an empty spec when the family has no contract', async () => {
    let seen: unknown;
    const Api = UseCase.context<ApiContext>().guard((call) => {
      seen = call.spec;
      expectTypeOf(call.spec).toEqualTypeOf<Record<never, never>>();
    });

    class Work extends Api('work') {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<void> {}
    }

    await new Work().execute({ sessionId: 's' }, undefined);
    expect(seen).toEqual({});
  });

  it('awaits an async guard before the method', async () => {
    const stages: string[] = [];
    const Api = UseCase.context<ApiContext>().guard(async () => {
      await Promise.resolve();
      stages.push('guard');
    });

    class Work extends Api('work') {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<string> {
        stages.push('body');
        return 'ok';
      }
    }

    await expect(
      new Work().execute({ sessionId: 's' }, undefined),
    ).resolves.toBe('ok');
    expect(stages).toEqual(['guard', 'body']);
  });

  it('runs hooks around the method', async () => {
    const stages: string[] = [];
    let preInput: unknown;
    let postInput: unknown;
    let postResult: unknown;
    let caught: unknown;
    let caughtState: unknown;
    let settled:
      | {
          status: string;
          input: unknown;
          result?: unknown;
          error?: unknown;
        }
      | undefined;
    const Api = UseCase.context<
      ApiContext,
      { input: StandardSchemaV1; permission: string }
    >()
      .guard((call) => {
        stages.push('guard');
        if (call.ctx.sessionId.length < 1) throw new Error('unauthorized');
      })
      .hooks({
        preExecute: (call) => {
          stages.push('pre');
          preInput = call.input;
          return { mark: 'span' };
        },
        postExecute: (call, state) => {
          stages.push('post');
          postInput = call.input;
          postResult = call.result;
          expect(state.mark).toBe('span');
        },
        onCatch: (call, state) => {
          stages.push('catch');
          caught = call.error;
          caughtState = state;
        },
        onFinally: (call) => {
          stages.push('finally');
          settled = call;
        },
      });

    class Find extends Api('user.find', {
      input: querySchema,
      permission: 'users.read',
    }) {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        input: { query: string },
      ): Promise<string> {
        stages.push('body');
        if (input.query === undefined) throw new Error('bad input');
        return input.query;
      }
    }

    const find = new Find();
    await expect(
      find.execute({ sessionId: 's' }, { query: ' ada ' }),
    ).resolves.toBe(' ada ');
    expect(stages).toEqual(['guard', 'pre', 'body', 'post', 'finally']);
    expect(preInput).toEqual({ query: ' ada ' });
    expect(postInput).toEqual({ query: ' ada ' });
    expect(postResult).toBe(' ada ');
    expect(settled).toEqual({
      ctx: { sessionId: 's' },
      spec: { input: querySchema, permission: 'users.read' },
      token: 'user.find',
      input: { query: ' ada ' },
      status: 'success',
      result: ' ada ',
    });

    stages.length = 0;
    await expect(
      find.execute({ sessionId: '' }, { query: 'ada' }),
    ).rejects.toThrow('unauthorized');
    expect(stages).toEqual(['guard']);

    stages.length = 0;
    caught = undefined;
    caughtState = undefined;
    const invalid = await find
      .execute({ sessionId: 's' }, {} as { query: string })
      .then(
        () => {
          throw new Error('expected the method to throw');
        },
        (error: unknown) => error,
      );
    expect(invalid).toEqual(new Error('bad input'));
    expect(caught).toBe(invalid);
    expect(caughtState).toEqual({ mark: 'span' });
    expect(settled?.status).toBe('failure');
    expect(settled?.error).toBe(invalid);
    expect(settled?.input).toEqual({});
    expect(stages).toEqual(['guard', 'pre', 'body', 'catch', 'finally']);
  });

  it('rethrows the original error after onCatch and lets onCatch replace it', async () => {
    const stages: string[] = [];
    let replace = false;
    const Api = UseCase.context<ApiContext>().hooks({
      preExecute: () => ({ n: 1 }),
      onCatch: (_call, state) => {
        stages.push('catch');
        expect(state).toEqual({ n: 1 });
        if (replace) throw new Error('replaced');
      },
      onFinally: (call) => {
        stages.push('finally');
        if (call.status === 'failure') {
          expect(call.error).toBeInstanceOf(Error);
          expect(call.input).toBeUndefined();
        }
      },
    });

    class Work extends Api('work') {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        _input: unknown,
      ): Promise<string> {
        stages.push('body');
        throw new Error('boom');
      }
    }

    const work = new Work();
    await expect(work.execute({ sessionId: 's' }, undefined)).rejects.toThrow(
      'boom',
    );
    expect(stages).toEqual(['body', 'catch', 'finally']);

    stages.length = 0;
    replace = true;
    await expect(work.execute({ sessionId: 's' }, undefined)).rejects.toThrow(
      'replaced',
    );
    expect(stages).toEqual(['body', 'catch', 'finally']);
  });

  it('infers hook state from preExecute', () => {
    const Api = UseCase.context<ApiContext, { permission: string }>().hooks({
      async preExecute(call) {
        expectTypeOf(call.ctx).toEqualTypeOf<ApiContext>();
        expectTypeOf(call.spec.permission).toEqualTypeOf<string>();
        expectTypeOf(call.input).toEqualTypeOf<unknown>();
        return { name: 'find' as const, n: call.ctx.sessionId.length };
      },
      postExecute(_call, state) {
        expectTypeOf(state).toEqualTypeOf<{ name: 'find'; n: number }>();
        // @ts-expect-error state only has the fields preExecute returned
        void state.nope;
      },
      onCatch(_call, state) {
        expectTypeOf(state).toEqualTypeOf<
          { name: 'find'; n: number } | undefined
        >();
      },
      onFinally(_call, state) {
        expectTypeOf(state).toEqualTypeOf<
          { name: 'find'; n: number } | undefined
        >();
      },
    });

    UseCase.context<ApiContext>().hooks({
      onFinally(_call, state) {
        type Omitted = Awaited<void> | undefined;
        expectTypeOf(state).toEqualTypeOf<Omitted>();
      },
    });

    // @ts-expect-error guard and hooks are methods, not settings
    UseCase.context<ApiContext>({ guard() {} });
    expectTypeOf(
      UseCase.context(),
    ).toEqualTypeOf<'Pass a type argument: UseCase.context<Ctx>()'>();
    expect(Object.keys(Api)).not.toContain('guard');
    expect(Object.keys(Api)).not.toContain('hooks');
    void Api;
  });

  it('keeps hook state on the invocation that produced it', async () => {
    let current = 0;
    const pairs: { id: number; result: string }[] = [];
    const Api = UseCase.context<ApiContext>().hooks({
      preExecute: async () => {
        const id = ++current;
        await Promise.resolve();
        return { id };
      },
      postExecute: (call, state) => {
        pairs.push({ id: state.id, result: call.result as string });
      },
    });

    class Echo extends Api('echo') {
      constructor() {
        super();
      }

      override async execute(_ctx: ApiContext, input: string): Promise<string> {
        await Promise.resolve();
        return input;
      }
    }

    const echo = new Echo();
    const ctx: ApiContext = { sessionId: 's' };
    await Promise.all([echo.execute(ctx, 'a'), echo.execute(ctx, 'b')]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        { id: 1, result: 'a' },
        { id: 2, result: 'b' },
      ]),
    );
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(2);
  });

  it('appends guards and rejects a second hooks registration', async () => {
    const stages: string[] = [];
    const Api = UseCase.context<ApiContext>()
      .hooks({
        preExecute: () => {
          stages.push('pre');
        },
      })
      .guard(() => {
        stages.push('first');
      })
      .guard(async () => {
        stages.push('second');
      });

    expect(() =>
      Api.hooks({
        onFinally() {},
      }),
    ).toThrow('hexok: UseCase hooks are already set');

    const open = UseCase.context<ApiContext>().hooks({});
    expect(() => open.hooks({ preExecute: () => ({ n: 1 }) })).not.toThrow();

    class Work extends Api('work') {
      constructor() {
        super();
      }

      override async execute(_ctx: ApiContext): Promise<void> {
        stages.push('body');
      }
    }

    await new Work().execute({ sessionId: 's' });
    expect(stages).toEqual(['first', 'second', 'pre', 'body']);
    expect(Object.hasOwn(new Work(), 'execute')).toBe(true);

    class Bare extends open('bare') {
      constructor() {
        super();
      }

      override async execute(): Promise<void> {}
    }
    expect(Object.hasOwn(new Bare(), 'execute')).toBe(false);
  });

  it('copies a Schema class onto the class and passes the input through', async () => {
    class FindInput extends Schema(
      'FindInput',
      z.object({ query: z.string() }),
    ) {}

    const Api = UseCase.context<ApiContext, { input: SchemaSource }>();
    let called = false;

    class Find extends Api('user.find', { input: FindInput }) {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        input: InferSchema<(typeof Find)['input']>,
      ): Promise<string> {
        called = true;
        return input.query;
      }
    }

    const find = new Find();
    expectTypeOf(find.execute).parameters.toEqualTypeOf<
      [ApiContext, { query: string }]
    >();
    expect(Find.input).toBe(FindInput);
    await expect(
      find.execute({ sessionId: 's' }, { query: 'ada' }),
    ).resolves.toBe('ada');
    expect(called).toBe(true);

    called = false;
    await expect(
      find.execute({ sessionId: 's' }, {} as { query: string }),
    ).resolves.toBeUndefined();
    expect(called).toBe(true);
  });

  it('constructs a use case that has statics and no ports', async () => {
    const Api = UseCase.context<ApiContext, { permission: string }>();

    class Ping extends Api('sys.ping', { permission: 'sys.ping' }) {
      constructor() {
        super();
      }

      override async execute(_ctx: ApiContext, _input: unknown): Promise<'ok'> {
        return 'ok';
      }
    }

    expect(Ping.permission).toBe('sys.ping');
    expectTypeOf(Ping.permission).toEqualTypeOf<'sys.ping'>();
    await expect(
      new Ping().execute({ sessionId: 's' }, undefined),
    ).resolves.toBe('ok');
  });

  it('does not let the static bag replace token', () => {
    const bag = {
      input: querySchema,
      permission: 'users.read' as const,
      token: 'hijack',
      prototype: {},
      name: 'Hijack',
      length: 9,
    };

    class Kept extends ApiUseCase(
      'user.find',
      bag as {
        input: typeof querySchema;
        permission: 'users.read';
      },
    ) {
      constructor() {
        super();
      }

      override async execute(
        _ctx: ApiContext,
        _input: { query: string },
      ): Promise<void> {}
    }

    expect(Kept.token).toBe('user.find');
    expect(Kept.permission).toBe('users.read');
    expect(new Kept()).toBeInstanceOf(Kept);
  });
});
