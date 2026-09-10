import { fail, type Infer, ok, type Result } from '@plinth/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
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
    SAME_ADDRESS: { status: 409, message: 'Site is already at that address' },
  } as const;

  get id() {
    return this.props.id;
  }
  get address() {
    return this.props.address;
  }

  relocate(city: string, region: string): Result<this, 'SAME_ADDRESS'> {
    if (this.address.city === city && this.address.region === region) {
      return fail('SAME_ADDRESS');
    }
    this.set('address', { ...this.address, city, region });
    return ok(this);
  }
}

describe('TrackedEntity', () => {
  it('create marks isNew with no original', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.isNew).toBe(true);
    expect(created.value.original).toBeUndefined();
    expect(created.value.isDirty()).toBe(true);
    expect(created.value.getChangedKeys().sort()).toEqual(['address', 'id']);
  });

  it('restore snapshots original and is clean', () => {
    const restored = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.isNew).toBe(false);
    expect(restored.value.original).toEqual({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.value.isDirty()).toBe(false);
    expect(restored.value.getChangedKeys()).toEqual([]);
  });

  it('relocate mutates this and dirties the parent key', () => {
    const restored = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const site = restored.value;
    const result = site.relocate('Denver', 'CO');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(site);
    expect(site.address).toEqual({ city: 'Denver', region: 'CO' });
    expect(site.getChangedKeys()).toEqual(['address']);
    expect(site.isDirty()).toBe(true);
  });

  it('same address fails SAME_ADDRESS and stays clean', () => {
    const restored = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const result = restored.value.relocate('Austin', 'TX');
    expect(result).toEqual({ ok: false, code: 'SAME_ADDRESS' });
    expect(restored.value.isDirty()).toBe(false);
  });

  it('commit clears dirty and isNew', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    created.value.commit();
    expect(created.value.isNew).toBe(false);
    expect(created.value.isDirty()).toBe(false);
    expect(created.value.original).toEqual(created.value.toProps());
  });

  it('with() is rejected', () => {
    const created = Site.create({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const site = created.value;
    expectTypeOf(site.with).not.toEqualTypeOf<
      (patch: Partial<SiteProps>) => Site
    >();
    expect(() =>
      (created.value as unknown as { with: (p: unknown) => unknown }).with({
        id: 'other',
      }),
    ).toThrow(
      'plinth: TrackedEntity is mutable; use set() and return ok(this)',
    );
  });
});
