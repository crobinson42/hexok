// biome-ignore-all lint/complexity/noUselessConstructor: protected base constructors are not publicly constructable
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { CodedError } from './coded-error.js';
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
  >({
    guard(ctx) {
      if (ctx.sessionId.length < 1) throw new Error('unauthorized');
    },
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

  it('copies statics onto the class and types execute from the input schema', () => {
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

  it('rejects a missing contract, a bad command, and a reserved static', () => {
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

    class BadCommand extends ApiUseCase('user.find', {
      input: querySchema,
      permission: 'users.read',
    }) {
      // @ts-expect-error command does not match the schema output
      override async execute(
        _ctx: ApiContext,
        _input: { nope: number },
      ): Promise<string[]> {
        return [];
      }
    }
    void BadCommand;

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

  it('runs the guard, then validation, then the method', async () => {
    const stages: string[] = [];
    let seen: { query: string } | undefined;
    const Api = UseCase.context<
      ApiContext,
      { input: StandardSchemaV1; permission: string }
    >({
      guard(ctx) {
        stages.push('guard');
        if (ctx.sessionId.length < 1) throw new Error('unauthorized');
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
        seen = input;
        return input.query;
      }
    }

    const find = new Find();
    expect(Object.hasOwn(find, 'execute')).toBe(true);
    await expect(
      find.execute({ sessionId: 's' }, { query: ' ada ' }),
    ).resolves.toBe('ada');
    expect(stages).toEqual(['guard', 'body']);
    expect(seen).toEqual({ query: 'ada' });

    stages.length = 0;
    await expect(
      find.execute({ sessionId: '' }, {} as { query: string }),
    ).rejects.toThrow('unauthorized');
    expect(stages).toEqual(['guard']);

    stages.length = 0;
    const invalid = find
      .execute({ sessionId: 's' }, {} as { query: string })
      .then(
        () => {
          throw new Error('expected validation to fail');
        },
        (caught: unknown) => caught,
      );
    const error = await invalid;
    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({
      code: 'VALIDATION',
      data: { issues: expect.any(Array) },
    });
    expect((error as CodedError).message).toMatch(
      /hexok: user.find validation failed/,
    );
    expect(stages).toEqual(['guard']);
  });

  it('awaits an async guard before the method', async () => {
    const stages: string[] = [];
    const Api = UseCase.context<ApiContext>({
      async guard() {
        await Promise.resolve();
        stages.push('guard');
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
        return 'ok';
      }
    }

    await expect(
      new Work().execute({ sessionId: 's' }, undefined),
    ).resolves.toBe('ok');
    expect(stages).toEqual(['guard', 'body']);
  });

  it('validates and types a Schema class input', async () => {
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
    ).rejects.toThrow(/hexok: user.find validation failed/);
    expect(called).toBe(false);
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
