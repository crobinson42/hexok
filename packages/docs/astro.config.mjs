import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  site: 'https://crobinson42.github.io',
  base: '/hexok',
  integrations: [
    starlight({
      title: 'Hexok',
      description:
        'Hexo Kit — a TypeScript kit for writing a clean-architecture backend as ordinary classes.',
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Start', items: ['index'] },
        {
          label: 'API',
          items: [
            {
              label: 'core',
              items: [{ autogenerate: { directory: 'api/core' } }],
            },
            {
              label: 'domain',
              items: [{ autogenerate: { directory: 'api/domain' } }],
            },
            {
              label: 'app',
              items: [{ autogenerate: { directory: 'api/app' } }],
            },
            {
              label: 'infra',
              items: [{ autogenerate: { directory: 'api/infra' } }],
            },
            {
              label: 'runtime',
              items: [{ autogenerate: { directory: 'api/runtime' } }],
            },
            {
              label: 'testing',
              items: [{ autogenerate: { directory: 'api/testing' } }],
            },
          ],
        },
      ],
    }),
  ],
});
