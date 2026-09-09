import { ApiUseCase, type ExecuteCtx } from '@plinth/app';
import { z } from 'zod';
import { Site, siteSchema } from '../domain/site.js';
import { SiteRepository } from '../ports.js';

export class RelocateSite extends ApiUseCase {
  static readonly id = 'site.relocate';
  static readonly input = z.object({
    id: z.string(),
    city: z.string(),
    region: z.string(),
  });
  static readonly output = z.object({
    site: siteSchema,
    changedKeys: z.array(z.string()),
  });
  static readonly errors = {
    ...Site.errors,
    NOT_FOUND: { status: 404, message: 'Site not found' },
  } as const;
  static readonly ports = { sites: SiteRepository };

  async execute({ input, ports, errors }: ExecuteCtx<typeof RelocateSite>) {
    const site = await ports.sites.get(input.id);
    if (!site) throw errors.NOT_FOUND();
    const moved = site.relocate(input.city, input.region);
    if (!moved.ok) throw errors[moved.code]();
    await ports.sites.save(moved.value);
    return {
      site: moved.value.toProps(),
      changedKeys: moved.value.getChangedKeys(),
    };
  }
}
