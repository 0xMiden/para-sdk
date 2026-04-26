import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Post-build rewrite: swap every `@miden-sdk/{miden-sdk,react,miden-para}/lazy`
 * import in the eager bundles to the bare specifier. Mirrors
 * `@miden-sdk/react/tsup.config.ts` so a consumer's choice of eager vs lazy
 * cascades through this adapter.
 */
function rewriteEagerBundles(distDir: string): void {
  for (const file of ['index.js', 'index.cjs']) {
    const path = join(distDir, file);
    let before: string;
    try {
      before = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const after = before
      .replace(/@miden-sdk\/miden-sdk\/lazy/g, '@miden-sdk/miden-sdk')
      .replace(/@miden-sdk\/react\/lazy/g, '@miden-sdk/react')
      .replace(/@miden-sdk\/miden-para\/lazy/g, '@miden-sdk/miden-para');
    if (after !== before) {
      writeFileSync(path, after);
    }
  }
}

const sharedExternal = [
  'react',
  '@getpara/react-sdk-lite',
  '@getpara/web-sdk',
  '@miden-sdk/miden-para',
  '@miden-sdk/miden-para/lazy',
  '@miden-sdk/miden-sdk',
  '@miden-sdk/miden-sdk/lazy',
  '@miden-sdk/react',
  '@miden-sdk/react/lazy',
  '@tanstack/react-query',
];

export default defineConfig([
  // Eager variant — default entry (`@miden-sdk/use-miden-para-react`).
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    sourcemap: true,
    dts: { compilerOptions: { skipLibCheck: true } },
    clean: true,
    target: 'es2019',
    external: sharedExternal,
    onSuccess: async () => {
      rewriteEagerBundles('dist');
    },
  },
  // Lazy variant — subpath entry (`.../lazy`).
  {
    entry: { lazy: 'src/index.ts' },
    format: ['cjs', 'esm'],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    sourcemap: true,
    dts: { compilerOptions: { skipLibCheck: true } },
    clean: false,
    target: 'es2019',
    external: sharedExternal,
  },
  // Vite plugin entry — unchanged.
  {
    entry: ['src/paraVitePlugin.ts'],
    format: ['cjs', 'esm'],
    sourcemap: true,
    dts: { compilerOptions: { skipLibCheck: true } },
    clean: false,
    target: 'es2019',
    external: ['vite', 'vite-plugin-node-polyfills'],
  },
]);
