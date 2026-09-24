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
        'TypeScript primitives for hexagonal software: Schema, Entity, UseCase, Port, Adapter, Event, and EventCatalog.',
      plugins: [starlightLinksValidator()],
      sidebar: [{ label: 'Start', items: ['index'] }],
    }),
  ],
});
