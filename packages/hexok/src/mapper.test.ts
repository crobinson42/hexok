import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { CodedError } from './coded-error.js';
import { Entity } from './entity.js';
import { Mapper } from './mapper.js';
import { type InferSchema, Schema } from './schema.js';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.tuple([z.number(), z.number()]),
});

type UserProps = InferSchema<typeof userSchema>;

class User extends Entity('User', userSchema) {
  rename(name: string): this {
    return this.set((draft) => {
      draft.name = name;
    });
  }
}

const mongoUserSchema = z.object({
  _id: z.string(),
  name: z.string(),
  location: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
});

class MongoStored extends Schema('MongoStored', mongoUserSchema) {}

type MongoUserDoc = InferSchema<typeof MongoStored>;

class MongoUser extends Mapper('mongo.User', User, MongoStored) {
  protected fromSource(user: User) {
    const props = user.toProps();
    const [lat, lng] = props.location;
    return {
      _id: props.id,
      name: props.name,
      location: { type: 'Point' as const, coordinates: [lng, lat] },
    };
  }

  protected toSource(doc: MongoUserDoc): UserProps {
    const [lng, lat] = doc.location.coordinates;
    return { id: doc._id, name: doc.name, location: [lat, lng] };
  }
}

const pgUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  geog: z.string(),
});

type PgUserDoc = InferSchema<typeof pgUserSchema>;

class PgUser extends Mapper('pg.User', User, pgUserSchema) {
  protected fromSource(user: User) {
    const props = user.toProps();
    const [lat, lng] = props.location;
    return { id: props.id, name: props.name, geog: `POINT(${lng} ${lat})` };
  }

  protected toSource(row: PgUserDoc): UserProps {
    const body = row.geog.slice('POINT('.length, -1);
    const [lngText, latText] = body.split(' ');
    return {
      id: row.id,
      name: row.name,
      location: [Number(latText), Number(lngText)],
    };
  }
}

const logEntrySchema = z.object({
  level: z.enum(['info', 'error']),
  message: z.string(),
  at: z.date(),
});

class LogEntry extends Schema('LogEntry', logEntrySchema) {}

const logLineSchema = z.object({
  lvl: z.enum(['info', 'error']),
  msg: z.string(),
  ts: z.number(),
});

type LogEntryProps = InferSchema<typeof LogEntry>;
type LogLineProps = InferSchema<typeof logLineSchema>;

class LogLine extends Mapper('log.Line', LogEntry, logLineSchema) {
  protected fromSource(entry: LogEntryProps) {
    return { lvl: entry.level, msg: entry.message, ts: entry.at.getTime() };
  }

  protected toSource(line: LogLineProps) {
    return { level: line.lvl, message: line.msg, at: new Date(line.ts) };
  }
}

const rawEntrySchema = z.object({
  level: z.enum(['info', 'error']),
  message: z.string(),
  at: z.date(),
});

type RawEntry = InferSchema<typeof rawEntrySchema>;

class RawLine extends Mapper('log.Raw', rawEntrySchema, logLineSchema) {
  protected fromSource(entry: RawEntry) {
    return { lvl: entry.level, msg: entry.message, ts: entry.at.getTime() };
  }

  protected toSource(line: LogLineProps) {
    return { level: line.lvl, message: line.msg, at: new Date(line.ts) };
  }
}

const place = {
  id: 'u1',
  name: 'Ada',
  location: [12.5, -4] as [number, number],
};

describe('Mapper', () => {
  it('round-trips an entity through GeoJSON', () => {
    const user = User.create(place);
    expect(user.isNew).toBe(true);
    const mongo = new MongoUser();
    const model = mongo.toModel(user);
    expect(user.isNew).toBe(true);
    expect(model).toEqual({
      _id: 'u1',
      name: 'Ada',
      location: { type: 'Point', coordinates: [-4, 12.5] },
    });
    expect(MongoUser.token).toBe('mongo.User');
    expect(MongoUser.schema).toBe(mongoUserSchema);
    expect(MongoUser.source).toBe(User);

    const loaded = mongo.fromModel(model);
    expect(loaded).toBeInstanceOf(User);
    expect(loaded).not.toBe(user);
    expect(loaded.isNew).toBe(false);
    expect(loaded.isValidated).toBe(false);
    expect(loaded.props.location).toEqual([12.5, -4]);
    expect(loaded.rename('Bea').props.name).toBe('Bea');
  });

  it('round-trips the same entity through a second stored shape', () => {
    const user = User.create(place);
    const pg = new PgUser();
    const row = pg.toModel(user);
    expect(row).toEqual({ id: 'u1', name: 'Ada', geog: 'POINT(-4 12.5)' });
    expect(row).not.toHaveProperty('_id');
    expect(row).not.toHaveProperty('location');

    const loaded = pg.fromModel(row);
    expect(loaded).toBeInstanceOf(User);
    expect(loaded.props).toEqual(place);
    expect(loaded.isNew).toBe(false);
    expect(loaded.isValidated).toBe(false);
  });

  it('round-trips a schema without an entity', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const line = new LogLine();
    const stored = line.toModel({ level: 'info', message: 'hi', at });
    expect(stored).toEqual({ lvl: 'info', msg: 'hi', ts: at.getTime() });
    const loaded = line.fromModel(stored);
    expect(loaded).toEqual({ level: 'info', message: 'hi', at });
    expect(loaded).not.toBeInstanceOf(LogEntry);
    expect(loaded).not.toHaveProperty('isNew');
  });

  it('round-trips a raw zod schema used as the source', () => {
    const at = new Date('2026-03-04T05:06:07.000Z');
    const raw = new RawLine();
    const stored = raw.toModel({ level: 'error', message: 'nope', at });
    expect(stored).toEqual({ lvl: 'error', msg: 'nope', ts: at.getTime() });
    const loaded = raw.fromModel(stored);
    expect(loaded).toEqual({ level: 'error', message: 'nope', at });
    expect(loaded).not.toHaveProperty('props');
    expect(loaded).not.toHaveProperty('isNew');

    class BadRaw extends Mapper('log.Raw', rawEntrySchema, logLineSchema) {
      protected fromSource(entry: RawEntry) {
        return {
          lvl: entry.level,
          msg: entry.message,
          ts: entry.at.getTime(),
        };
      }

      protected toSource(): RawEntry {
        return {
          level: 'info',
          message: 1 as unknown as string,
          at: new Date(0),
        };
      }
    }

    expect(() => new BadRaw().fromModel(stored)).not.toThrow();
    expect(() => new BadRaw().fromModel(stored, { validate: true })).toThrow(
      CodedError,
    );
    expect(() => new BadRaw().fromModel(stored, { validate: true })).toThrow(
      /hexok: log\.Raw validation failed/,
    );
  });

  it('throws the mapper token when the stored draft is invalid', () => {
    class BadStored extends Mapper('mongo.User', User, MongoStored) {
      protected fromSource(_user: User) {
        return { _id: 1 };
      }

      protected toSource(doc: MongoUserDoc): UserProps {
        return { id: doc._id, name: doc.name, location: [0, 0] };
      }
    }

    const user = User.create(place);
    expect(() => new BadStored().toModel(user)).not.toThrow();

    class CheckedStored extends Mapper('mongo.User', User, MongoStored, {
      validate: true,
    }) {
      protected fromSource(_user: User) {
        return { _id: 1 };
      }

      protected toSource(doc: MongoUserDoc): UserProps {
        return { id: doc._id, name: doc.name, location: [0, 0] };
      }
    }

    const fail = () => new CheckedStored().toModel(user);
    expect(fail).toThrow(CodedError);
    expect(fail).toThrow(/hexok: mongo\.User validation failed/);
    expect(fail).not.toThrow(/MongoStored/);
    expect(() =>
      new CheckedStored().toModel(user, { validate: false }),
    ).not.toThrow();
  });

  it('throws the mapper token when the driver document is invalid', () => {
    const raw = { nope: true };
    expect(() => new MongoUser().fromModel(raw)).not.toThrow(CodedError);
    const fail = () => new MongoUser().fromModel(raw, { validate: true });
    expect(fail).toThrow(CodedError);
    expect(fail).toThrow(/hexok: mongo\.User validation failed/);
    expect(fail).not.toThrow(/MongoStored/);
  });

  it('throws the entity token when restored props are invalid', () => {
    class BadSource extends Mapper('mongo.User', User, MongoStored) {
      protected fromSource(user: User) {
        const props = user.toProps();
        const [lat, lng] = props.location;
        return {
          _id: props.id,
          name: props.name,
          location: { type: 'Point' as const, coordinates: [lng, lat] },
        };
      }

      protected toSource(doc: MongoUserDoc): UserProps {
        return {
          id: doc._id,
          name: 5 as unknown as string,
          location: [0, 0],
        };
      }
    }

    const doc = new MongoUser().toModel(User.create(place));
    expect(new BadSource().fromModel(doc).isValidated).toBe(false);
    const fail = () => new BadSource().fromModel(doc, { validate: true });
    expect(fail).toThrow(CodedError);
    expect(fail).toThrow(/hexok: User validation failed/);
    expect(fail).not.toThrow(/mongo\.User/);
  });

  it('rejects a source that is not an entity or a schema', () => {
    expect(() => Mapper('nope', { nope: true }, z.string())).toThrow(
      'hexok: nope source is not an entity or a schema',
    );
  });

  it('rejects a mapper that does not implement both directions', () => {
    // @ts-expect-error missing fromSource and toSource
    class Forgot extends Mapper('mongo.Forgot', User, MongoStored) {}
    void Forgot;
  });

  it('types the token, the entity instance, and schema output', () => {
    const mongo = new MongoUser();
    expectTypeOf(MongoUser.token).toEqualTypeOf<'mongo.User'>();
    expectTypeOf(mongo.fromModel).parameters.toEqualTypeOf<
      [unknown, { readonly validate?: boolean }?]
    >();
    expectTypeOf(mongo.fromModel).returns.toEqualTypeOf<User>();
    expectTypeOf(mongo.toModel).parameters.toEqualTypeOf<
      [User, { readonly validate?: boolean }?]
    >();
    expectTypeOf(mongo.toModel).returns.toEqualTypeOf<MongoUserDoc>();
    expectTypeOf<
      ReturnType<MongoUser['fromModel']>['rename']
    >().parameters.toEqualTypeOf<[string]>();

    const line = new LogLine();
    expectTypeOf(line.fromModel).parameters.toEqualTypeOf<
      [unknown, { readonly validate?: boolean }?]
    >();
    expectTypeOf(line.fromModel).returns.toEqualTypeOf<LogEntryProps>();
    expectTypeOf(line.toModel).parameters.toEqualTypeOf<
      [LogEntryProps, { readonly validate?: boolean }?]
    >();
    expectTypeOf(line.toModel).returns.toEqualTypeOf<LogLineProps>();

    const raw = new RawLine();
    expectTypeOf(raw.fromModel).returns.toEqualTypeOf<RawEntry>();
    expectTypeOf(raw.toModel).parameters.toEqualTypeOf<
      [RawEntry, { readonly validate?: boolean }?]
    >();
  });

  it('does not treat two mappers as the same type', () => {
    function takesMongo(mapper: MongoUser): void {
      void mapper;
    }
    // @ts-expect-error PgUser is not a MongoUser
    takesMongo(new PgUser());
  });
});
