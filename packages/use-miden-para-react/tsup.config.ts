import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    sourcemap: true,
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    clean: true,
    target: 'es2019',
    external: [
      'react',
      '@getpara/react-sdk-lite',
      '@getpara/web-sdk',
      '@miden-sdk/miden-para',
      '@miden-sdk/miden-sdk',
      '@miden-sdk/react',
      '@tanstack/react-query',
    ],
  },
  {
    entry: ['src/paraVitePlugin.ts'],
    format: ['cjs', 'esm'],
    sourcemap: true,
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    target: 'es2019',
    external: [
      'vite',
      'vite-plugin-node-polyfills',
    ],
  },
]);
