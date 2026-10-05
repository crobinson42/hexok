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
      customCss: ['./src/styles/layers.css'],
      sidebar: [
        { label: 'Start', items: ['index'] },
        {
          label: 'Building Software - The Patterns',
          slug: 'building-software',
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Overview', slug: 'concepts' },
            { label: 'Entity', slug: 'concepts/entity' },
            { label: 'Schema', slug: 'concepts/schema' },
            {
              label: 'UseCase',
              items: [
                { label: 'UseCase', slug: 'concepts/use-case' },
                { label: 'Context', slug: 'concepts/use-case/context' },
              ],
            },
            { label: 'Port', slug: 'concepts/port' },
            {
              label: 'Adapter',
              items: [
                { label: 'Adapter', slug: 'concepts/adapter' },
                { label: 'Mapper', slug: 'concepts/adapter/mapper' },
              ],
            },
            {
              label: 'Error',
              items: [
                { label: 'Error', slug: 'concepts/error' },
                { label: 'Error map', slug: 'concepts/error/map' },
                { label: 'Coded error', slug: 'concepts/error/coded' },
              ],
            },
            { label: 'Event', slug: 'concepts/event' },
            { label: 'EventCatalog', slug: 'concepts/event-catalog' },
            { label: 'EventHandler', slug: 'concepts/event-handler' },
          ],
        },
      ],
    }),
  ],
});
