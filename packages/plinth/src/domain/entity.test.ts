import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { CodedError, type Infer } from '../core/index.js';
import { type DeepReadonly, Entity } from './entity.js';

const incidentSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.date().nullable(),
});
type IncidentProps = Infer<typeof incidentSchema>;

class Incident extends Entity<IncidentProps> {
  static readonly key = 'Incident';
  static readonly schema = incidentSchema;
  static readonly errors = {
    ALREADY_CLOSED: { message: 'Incident already closed' },
  } as const;

  get id() {
    return this.props.id;
  }
  get status() {
    return this.props.status;
  }
  get closedAt() {
    return this.props.closedAt;
  }

  static open(id: string): Incident {
    return Incident.create({
      id,
      status: 'open',
      closedAt: null,
    });
  }

  close(now: Date): this {
    if (this.props.status === 'closed') Incident.error('ALREADY_CLOSED');
    return this.set((draft) => {
      draft.status = 'closed';
      draft.closedAt = now;
    });
  }
}

const siteSchema = z.object({
  id: z.string(),
  address: z.object({
    city: z.string(),
    region: z.string(),
  }),
});
type SiteProps = Infer<typeof siteSchema>;

class Site extends Entity<SiteProps> {
  static readonly key = 'Site';
  static readonly schema = siteSchema;
  static readonly errors = {
    SAME_ADDRESS: { message: 'Site is already at that address' },
  } as const;

  get id() {
    return this.props.id;
  }
  get address() {
    return this.props.address;
  }

  relocate(city: string, region: string): this {
    if (this.address.city === city && this.address.region === region) {
      Site.error('SAME_ADDRESS');
    }
    this.set((draft) => {
      draft.address.city = city;
      draft.address.region = region;
    });
    return this;
  }
}

const timedSchema = z.object({
  id: z.string(),
  items: z.array(z.string()),
  closedAt: z.date(),
});
type TimedProps = Infer<typeof timedSchema>;

class Timed extends Entity<TimedProps> {
  static readonly key = 'Timed';
  static readonly schema = timedSchema;
  static readonly errors = {};
}

const placeSchema = z.object({
  id: z.string(),
  address: z
    .object({
      city: z.string(),
      region: z.string(),
    })
    .optional(),
});
type PlaceProps = Infer<typeof placeSchema>;

class Place extends Entity<PlaceProps> {
  static readonly key = 'Place';
  static readonly schema = placeSchema;
  static readonly errors = {};
}

function hq(): SiteProps {
  return {
    id: 'hq',
    address: { city: 'Austin', region: 'TX' },
  };
}

describe('Entity', () => {
  it('constructor is protected; factories return the subclass', () => {
    expectTypeOf(
      Incident.create({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    expectTypeOf(
      Incident.restore({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    expectTypeOf(
      Incident.parse({ id: '1', status: 'open', closedAt: null }),
    ).toEqualTypeOf<Incident>();
    expectTypeOf(Site.create(hq())).toEqualTypeOf<Site>();
    expectTypeOf(Site.restore(hq())).toEqualTypeOf<Site>();
    const _typeChecks = () => {
      // @ts-expect-error Entity constructor is protected
      new Incident({ id: '1', status: 'open', closedAt: null });
      // @ts-expect-error Entity constructor is protected
      new Site(hq());
    };
    void _typeChecks;
  });

  it('create / restore / parse validate via the schema', () => {
    const created = Incident.create({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(created).toBeInstanceOf(Incident);
    expect(created.id).toBe('1');

    const restored = Incident.restore(created.toProps());
    expect(restored).toBeInstanceOf(Incident);

    const parsed = Incident.parse({
      id: '2',
      status: 'open',
      closedAt: null,
    });
    expect(parsed).toBeInstanceOf(Incident);

    try {
      Incident.parse({ id: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'VALIDATION',
        message: 'plinth: Incident validation failed',
      });
    }
  });

  it('close mutates this; the original incident is closed', () => {
    const incident = Incident.open('1');
    const now = new Date('2026-01-01T00:00:00Z');
    const closed = incident.close(now);

    expectTypeOf(incident.close).returns.toEqualTypeOf<Incident>();

    expect(closed).toBe(incident);
    expect(closed).toBeInstanceOf(Incident);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toEqual(now);
    expect(incident.status).toBe('closed');
    expect(incident.closedAt).toEqual(now);
  });

  it('close throws ALREADY_CLOSED', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const incident = Incident.open('1');
    const closed = incident.close(now);
    try {
      closed.close(now);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'ALREADY_CLOSED',
        message: 'Incident already closed',
      });
    }
  });

  it('toJSON / toProps return plain schema output', () => {
    const incident = Incident.open('1');
    expect(incident.toProps()).toEqual({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(incident.toJSON()).toEqual(incident.toProps());
  });

  it('toProps() is a deep frozen snapshot reused until set', () => {
    const site = Site.restore(hq());
    const first = site.toProps();
    expect(first).not.toBe(site.props);
    expect(first.address).not.toBe(site.props.address);
    expect(site.toProps()).toBe(first);
    expect(site.toJSON()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.address)).toBe(true);
    expect(() => {
      (first as SiteProps).id = 'x';
    }).toThrow();
    expect(() => {
      (first as SiteProps).address.city = 'Denver';
    }).toThrow();

    site.commit();
    expect(site.toProps()).toBe(first);

    site.set(() => {});
    expect(site.toProps()).toBe(first);

    site.relocate('Denver', 'CO');
    const afterSet = site.toProps();
    expect(afterSet).not.toBe(first);
    expect(afterSet.address.city).toBe('Denver');
    expect(first.address.city).toBe('Austin');
    expect(site.toProps()).toBe(afterSet);
  });

  it('toProps Date values are copied', () => {
    const closedAt = new Date('2026-01-01T00:00:00Z');
    const timed = Timed.restore({
      id: '1',
      items: ['a'],
      closedAt,
    });
    const snap = timed.toProps();
    expect(snap.closedAt).not.toBe(timed.props.closedAt);
    expect(snap.closedAt.getTime()).toBe(closedAt.getTime());
    expect(snap.items).not.toBe(timed.props.items);
  });

  it('undeclared error code is a type error on the class and a throw at runtime', () => {
    const _declared: () => never = () => Incident.error('ALREADY_CLOSED');
    void _declared;
    expect(() =>
      // @ts-expect-error NOPE is not a declared incident error
      Incident.error('NOPE'),
    ).toThrow('plinth: undeclared error "NOPE" on Incident');
    expect(() => Incident.open('1').error('NOPE')).toThrow(
      'plinth: undeclared error "NOPE" on Incident',
    );
  });

  it('restore does not snapshot; original is undefined while clean', () => {
    const restored = Site.restore(hq());
    expect(restored.isNew).toBe(false);
    expect(restored.original).toBeUndefined();
    expect(restored.isDirty()).toBe(false);
    const keys = restored.getChangedKeys();
    expect(keys).toEqual([]);
    expect(Object.isFrozen(keys)).toBe(true);
  });

  it('parse uses restore tracking; first set snapshots original', () => {
    const parsed = Incident.parse({
      id: '1',
      status: 'open',
      closedAt: null,
    });
    expect(parsed.isNew).toBe(false);
    expect(parsed.original).toBeUndefined();
    const keys = parsed.getChangedKeys();
    expect(keys).toEqual([]);
    expect(Object.isFrozen(keys)).toBe(true);

    parsed.set((draft) => {
      draft.status = 'closed';
    });
    expect(parsed.original).toBeDefined();
    expect(parsed.original).not.toBe(parsed.props);
    expect(parsed.getChangedKeys()).toEqual(['status']);
  });

  it('first set allocates a working copy and keeps original as the prior object', () => {
    const site = Site.restore(hq());
    expect(site.original).toBeUndefined();
    const before = site.props;
    site.relocate('Denver', 'CO');
    expect(site.props).not.toBe(before);
    expect(site.original).toBe(before);
    expect(site.original).toEqual({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(site.original?.address).not.toBe(site.props.address);
  });

  it('later set mutates the working copy in place', () => {
    const site = Site.restore(hq());
    site.relocate('Denver', 'CO');
    const working = site.props;
    site.set((draft) => {
      draft.id = 'hq-2';
    });
    expect(site.props).toBe(working);
    expect(site.getChangedKeys().sort()).toEqual(['address', 'id']);
  });

  it('getChangedKeys is empty when clean', () => {
    const restored = Site.restore(hq());
    expect(restored.getChangedKeys()).toEqual([]);
    expect(restored.getChangedKeys({ deep: true })).toEqual([]);
    expect(restored.getChangedKeys()).toBe(
      restored.getChangedKeys({ deep: true }),
    );
  });

  it('getChangedKeys({ deep: true }) after relocate is leaf paths in Object.keys order', () => {
    const site = Site.restore(hq());
    site.relocate('Denver', 'CO');
    expect(site.getChangedKeys({ deep: true })).toEqual([
      'address.city',
      'address.region',
    ]);
  });

  it('{ deep: false } is shallow', () => {
    const site = Site.restore(hq());
    site.relocate('Denver', 'CO');
    expect(site.getChangedKeys({ deep: false })).toEqual(['address']);
    expect(site.getChangedKeys()).toEqual(['address']);
  });

  it('arrays and Date are leaves; replacing them is a shallow change', () => {
    const items = ['a', 'b'];
    const closedAt = new Date('2026-01-01T00:00:00Z');
    const replaced = Timed.restore({ id: '1', items, closedAt });
    replaced.set((draft) => {
      draft.items = ['a', 'c'];
      draft.closedAt = new Date('2026-02-01T00:00:00Z');
    });
    expect(replaced.getChangedKeys()).toEqual(['items', 'closedAt']);
    expect(replaced.getChangedKeys({ deep: true })).toEqual([
      'items',
      'closedAt',
    ]);
  });

  it('array index writes copy the array and are visible to diffs', () => {
    const items = ['a', 'b'];
    const closedAt = new Date('2026-01-01T00:00:00Z');
    const inplace = Timed.restore({ id: '1', items, closedAt });
    inplace.set((draft) => {
      draft.items[0] = 'z';
    });
    expect(items[0]).toBe('a');
    expect(inplace.props.items[0]).toBe('z');
    expect(inplace.props.items).not.toBe(items);
    expect(inplace.getChangedKeys()).toEqual(['items']);
    expect(inplace.getChangedKeys({ deep: true })).toEqual(['items']);
  });

  it('Date in-place mutation is a leaf; assign a new Date', () => {
    const closedAt = new Date('2026-01-01T00:00:00Z');
    const timed = Timed.restore({ id: '1', items: ['a'], closedAt });
    timed.set((draft) => {
      draft.closedAt = new Date('2026-02-01T00:00:00Z');
    });
    expect(closedAt.getTime()).toBe(new Date('2026-01-01T00:00:00Z').getTime());
    expect(timed.getChangedKeys()).toEqual(['closedAt']);
  });

  it('deleting a nested object emits leaf paths', () => {
    const place = Place.restore({
      id: '1',
      address: { city: 'Austin', region: 'TX' },
    });
    place.set((draft) => {
      delete draft.address;
    });
    expect(place.getChangedKeys({ deep: true })).toEqual([
      'address.city',
      'address.region',
    ]);
  });

  it('same address throws SAME_ADDRESS and stays clean', () => {
    const site = Site.restore(hq());
    try {
      site.relocate('Austin', 'TX');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect(error).toMatchObject({
        code: 'SAME_ADDRESS',
        message: 'Site is already at that address',
      });
    }
    expect(site.isDirty()).toBe(false);
    expect(site.original).toBeUndefined();
    expect(site.getChangedKeys()).toEqual([]);
  });

  it('create() isNew with every current key dirty', () => {
    const created = Site.create(hq());
    expect(created.isNew).toBe(true);
    expect(created.original).toBeUndefined();
    expect(created.isDirty()).toBe(true);
    expect(created.getChangedKeys().sort()).toEqual(['address', 'id']);
  });

  it('create + deep: true emits current leaf paths', () => {
    const created = Site.create(hq());
    expect(created.getChangedKeys({ deep: true })).toEqual([
      'id',
      'address.city',
      'address.region',
    ]);
  });

  it('commit() aliases _props as original without copying', () => {
    const created = Site.create(hq());
    const createdWorking = created.props;
    created.commit();
    expect(created.isNew).toBe(false);
    expect(created.isDirty()).toBe(false);
    expect(created.original).toBeUndefined();
    expect(created.props).toBe(createdWorking);
    expect(created.getChangedKeys()).toEqual([]);

    const site = Site.restore(hq());
    site.relocate('Denver', 'CO');
    const working = site.props;
    site.commit();
    expect(site.isNew).toBe(false);
    expect(site.isDirty()).toBe(false);
    expect(site.original).toBeUndefined();
    expect(site.props).toBe(working);
    expect(site.getChangedKeys()).toEqual([]);
  });

  it('nested assignment in set copies the path and is visible to diffs', () => {
    const input = hq();
    const site = Site.restore(input);
    const before = site.props;
    site.set((draft) => {
      draft.address.city = 'Denver';
    });
    expect(input.address.city).toBe('Austin');
    expect(site.original).toBe(before);
    expect(site.original?.address).toBe(before.address);
    expect(site.props).not.toBe(before);
    expect(site.props.address).not.toBe(before.address);
    expect(site.props.address.city).toBe('Denver');
    expect(site.original?.address.city).toBe('Austin');
    expect(site.getChangedKeys()).toEqual(['address']);
    expect(site.getChangedKeys({ deep: true })).toEqual(['address.city']);
    expect(site.isDirty()).toBe(true);
  });

  it('no-op set on a restored entity stays clean', () => {
    const site = Site.restore(hq());
    const before = site.props;
    site.set(() => {});
    expect(site.props).toBe(before);
    expect(site.original).toBeUndefined();
    expect(site.isDirty()).toBe(false);
    expect(site.getChangedKeys()).toEqual([]);
  });

  it('later nested set mutates the already-copied address in place', () => {
    const site = Site.restore(hq());
    site.relocate('Denver', 'CO');
    const working = site.props;
    const address = site.props.address;
    site.set((draft) => {
      draft.address.city = 'Boulder';
    });
    expect(site.props).toBe(working);
    expect(site.props.address).toBe(address);
    expect(site.props.address.city).toBe('Boulder');
    expect(site.original?.address.city).toBe('Austin');
  });

  it('props is DeepReadonly; writes are a type error', () => {
    const site = Site.restore(hq());
    expectTypeOf(site.props).toMatchTypeOf<DeepReadonly<SiteProps>>();
    expectTypeOf(site.original).toMatchTypeOf<
      DeepReadonly<SiteProps> | undefined
    >();
    const _typeChecks = () => {
      // @ts-expect-error props is readonly
      site.props.id = 'x';
      // @ts-expect-error nested props are readonly
      site.props.address.city = 'Denver';
    };
    void _typeChecks;
  });
});
