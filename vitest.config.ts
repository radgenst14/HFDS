import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The engine is DOM-free (CLAUDE.md rule 4), so its tests run under plain Node; so do
      // the pure client modules (tests/client) that hold no DOM code.
      environment: 'node',
      include: [
        'tests/engine/**/*.test.ts',
        'tests/client/**/*.test.ts',
        'tests/scripts/**/*.test.ts',
      ],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    },
  }),
);
