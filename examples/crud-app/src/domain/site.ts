import type { Infer } from 'hexok/core';
import { Entity } from 'hexok/domain';
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
 * `relocate` mutates **this** and returns `this`.
 */
export class Site extends Entity<SiteProps> {
  static readonly key = 'Site';

  static schema = siteSchema;

  static errors = {
    SAME_ADDRESS: { message: 'Site is already at that address' },
  };

  static hq() {
    return Site.restore({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
  }

  relocate(city: string, region: string) {
    if (
      this.props.address.city === city &&
      this.props.address.region === region
    ) {
      this.error('SAME_ADDRESS');
    }

    this.set((draft) => {
      draft.address.city = city;
      draft.address.region = region;
    });

    return this;
  }
}
