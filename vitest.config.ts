import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/e2e/**', '**/node_modules/**'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'entrypoints/**/*.ts'],
      exclude: ['**/*.types.ts', '**/*.d.ts'],
    },
  },
});
