import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/src/**/*.test.ts', 'client/src/**/*.test.ts'],
  },
});
