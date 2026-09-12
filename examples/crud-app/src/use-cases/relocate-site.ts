import { type ExecuteCtx, ExternalUseCase } from 'hexok/app';
import { z } from 'zod';
import { Site, siteSchema } from '../domain/site.js';
import { SiteRepository } from '../ports.js';

export class RelocateSite extends ExternalUseCase {
  static readonly key = 'site.relocate';

  static input = z.object({
    id: z.string(),
    city: z.string(),
    region: z.string(),
  });

  static output = z.object({
    site: siteSchema,
    changedKeys: z.array(z.string()),
  });

  static errors = {
    ...Site.errors,
    NOT_FOUND: { message: 'Site not found' },
  };

  static ports = { sites: SiteRepository };

  async execute({ input, ports, errors }: ExecuteCtx<typeof RelocateSite>) {
    const site = await ports.sites.get(input.id);

    if (!site) throw errors.NOT_FOUND();

    site.relocate(input.city, input.region);

    const changedKeys = site.getChangedKeys();
    await ports.sites.save(site);

    return {
      site: site.toProps(),
      changedKeys,
    };
  }
}
