import type { Infer } from '@plinth/core';
import { TrackedEntity } from '@plinth/domain';
import { z } from 'zod';

export const siteSchema = z.object({
  id: z.string(),
  address: z.object({
    city: z.string(),
    region: z.string(),
  }),
});

export type SiteProps = Infer<typeof siteSchema>;

/**
 * Tracked aggregate. `relocate` mutates **this** and returns `this`.
 */
export class Site extends TrackedEntity<SiteProps> {
  static readonly key = 'Site';
  static schema = siteSchema;
  static errors = {
    SAME_ADDRESS: { status: 409, message: 'Site is already at that address' },
  } as const;

  get id() {
    return this.props.id;
  }
  get address() {
    return this.props.address;
  }

  static hq(): Site {
    return Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
  }

  relocate(city: string, region: string): this {
    if (this.address.city === city && this.address.region === region) {
      this.error('SAME_ADDRESS');
    }
    this.set('address', { ...this.address, city, region });
    return this;
  }
}
