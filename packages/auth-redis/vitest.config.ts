import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
