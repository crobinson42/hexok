import { fail, type Infer, ok, type Result } from '@plinth/core';
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
 * Tracked aggregate. `relocate` mutates **this** and returns `ok(this)`.
 */
export class Site extends TrackedEntity<SiteProps> {
  static readonly key = 'Site';
  static  schema = siteSchema;
  static  errors = {
    SAME_ADDRESS: { status: 409, message: 'Site is already at that address' },
  };

  get id() {
    return this.props.id;
  }
  get address() {
    return this.props.address;
  }

  static hq(): Site {
    const created = Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    if (!created.ok) throw new Error('plinth: Site.hq failed validation');
    return created.value;
  }

  relocate(city: string, region: string): Result<this, 'SAME_ADDRESS'> {
    if (this.address.city === city && this.address.region === region) {
      return fail('SAME_ADDRESS');
    }
    this.set('address', { ...this.address, city, region });
    return ok(this);
  }
}
