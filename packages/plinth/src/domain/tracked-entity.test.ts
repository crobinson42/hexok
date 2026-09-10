import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { CodedError, type Infer } from '../core/index.js';
import { TrackedEntity } from './tracked-entity.js';

const siteSchema = z.object({
  id: z.string(),
  address: z.object({
    city: z.string(),
    region: z.string(),
  }),
});
type SiteProps = Infer<typeof siteSchema>;

class Site extends TrackedEntity<SiteProps> {
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
    this.set('address', { ...this.address, city, region });
    return this;
  }
}

describe('TrackedEntity', () => {
  it('constructor is protected; factories return the subclass', () => {
    const props = {
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    };
    expectTypeOf(Site.create(props)).toEqualTypeOf<Site>();
    expectTypeOf(Site.restore(props)).toEqualTypeOf<Site>();
    const _typeChecks = () => {
      // @ts-expect-error TrackedEntity constructor is protected
      new Site(props);
    };
    void _typeChecks;
  });

  it('create marks isNew with no original', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(created.isNew).toBe(true);
    expect(created.original).toBeUndefined();
    expect(created.isDirty()).toBe(true);
    expect(created.getChangedKeys().sort()).toEqual(['address', 'id']);
  });

  it('restore snapshots original and is clean', () => {
    const restored = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.isNew).toBe(false);
    expect(restored.original).toEqual({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.isDirty()).toBe(false);
    expect(restored.getChangedKeys()).toEqual([]);
  });

  it('relocate mutates this and dirties the parent key', () => {
    const site = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    const moved = site.relocate('Denver', 'CO');
    expect(moved).toBe(site);
    expect(site.address).toEqual({ city: 'Denver', region: 'CO' });
    expect(site.getChangedKeys()).toEqual(['address']);
    expect(site.isDirty()).toBe(true);
  });

  it('same address throws SAME_ADDRESS and stays clean', () => {
    const site = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
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
  });

  it('commit clears dirty and isNew', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    created.commit();
    expect(created.isNew).toBe(false);
    expect(created.isDirty()).toBe(false);
    expect(created.original).toEqual(created.toProps());
  });

  it('with() is rejected', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expectTypeOf(created.with).not.toEqualTypeOf<
      (patch: Partial<SiteProps>) => Site
    >();
    expect(() =>
      (created as unknown as { with: (p: unknown) => unknown }).with({
        id: 'other',
      }),
    ).toThrow('plinth: TrackedEntity is mutable; use set()');
  });
});
