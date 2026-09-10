import { Entity, Port } from '@plinth/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { TestAppBuilder, type TestAppInstance } from './app-test.js';
import { InMemoryRepository } from './in-memory-repository.js';

interface Clock {
  now(): Date;
}
const Clock = Port.token<Clock>('Clock');

interface ThingRepository {
  get(id: string): Promise<Thing | null>;
  save(entity: Thing): Promise<void>;
  list(): Promise<Thing[]>;
  delete(id: string): Promise<void>;
}
const ThingRepository = Port.token<ThingRepository>('ThingRepository');

class Thing extends Entity<{ id: string }> {
  static readonly key = 'Thing';
  static readonly schema = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          typeof (value as { id: unknown }).id === 'string'
        ) {
          return { value: { id: (value as { id: string }).id } };
        }
        return { issues: [{ message: 'id' }] };
      },
      types: {
        input: undefined as unknown as { id: string },
        output: undefined as unknown as { id: string },
      },
    },
  };
  static readonly errors = {};
  get id() {
    return this.props.id;
  }
}

describe('InMemoryRepository', () => {
  it('clones on get and save', async () => {
    const created = Thing.create({ id: '1' });
    const repo = InMemoryRepository.of(ThingRepository, {
      keyBy: 'id',
      seed: [created],
    });
    const a = await repo.get('1');
    const b = await repo.get('1');
    expect(a).not.toBe(b);
    expect(a?.id).toBe('1');
    expect((await repo.list()).map((t) => t.id)).toEqual(['1']);
    await repo.delete('1');
    expect(await repo.get('1')).toBeNull();
  });

  it('rejects non-CRUD ports at the type level', () => {
    expectTypeOf<
      Parameters<typeof InMemoryRepository.of<Clock>>[0]
    >().toEqualTypeOf<`plinth: InMemoryRepository.of expects a CRUD repository port`>();
    void Clock;
  });

  it('types seed as the repository entity and keyBy as a prop key', () => {
    expectTypeOf(InMemoryRepository.of<ThingRepository>)
      .parameter(1)
      .toEqualTypeOf<{ keyBy: 'id'; seed?: Thing[] }>();
  });
});

describe('TestAppBuilder', () => {
  it('constructor is private; App.test is the factory', () => {
    const _typeChecks = () => {
      // @ts-expect-error TestAppBuilder constructor is private
      new TestAppBuilder(null as never, []);
    };
    void _typeChecks;
  });
});

describe('TestAppInstance', () => {
  it('is not never for a bag that requires ports', () => {
    expectTypeOf<
      TestAppInstance<{ close: never }>
    >().not.toEqualTypeOf<never>();
  });
});
