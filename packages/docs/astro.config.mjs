import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Plinth',
      description:
        'A TypeScript kit for writing a clean-architecture backend as ordinary classes.',
      sidebar: [
        { label: 'Start', items: ['index'] },
        {
          label: 'Core',
          items: [{ autogenerate: { directory: 'core' } }],
        },
        {
          label: 'Domain',
          items: [{ autogenerate: { directory: 'domain' } }],
        },
        {
          label: 'Application',
          items: [{ autogenerate: { directory: 'application' } }],
        },
        {
          label: 'Infrastructure',
          items: [{ autogenerate: { directory: 'infrastructure' } }],
        },
        {
          label: 'Runtime',
          items: [{ autogenerate: { directory: 'runtime' } }],
        },
        {
          label: 'Testing',
          items: [{ autogenerate: { directory: 'testing' } }],
        },
        {
          label: 'Extend',
          items: [{ autogenerate: { directory: 'extend' } }],
        },
      ],
    }),
  ],
});
