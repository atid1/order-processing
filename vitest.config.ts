import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.rate-limit-env.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
