import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'entrypoints/**/*.ts'],
      exclude: ['**/*.types.ts', '**/*.d.ts'],
    },
  },
});
