import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Hexok',
      description:
        'Hexo Kit — a TypeScript kit for writing a clean-architecture backend as ordinary classes.',
      sidebar: [{ label: 'Start', items: ['index'] }],
    }),
  ],
});
