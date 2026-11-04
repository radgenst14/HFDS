import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The engine is DOM-free (CLAUDE.md rule 4), so its tests run under plain Node.
      environment: 'node',
      include: ['tests/engine/**/*.test.ts', 'tests/scripts/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    },
  }),
);
