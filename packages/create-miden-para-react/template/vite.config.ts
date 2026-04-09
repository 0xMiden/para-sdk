import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Optional connector families that are never imported by the starter template.
// Alias them to an empty module so Vite doesn't try to resolve their deps.
// @getpara/aa-* packages are lazy `import()`ed by @getpara/react-core but the
// rolldown bundler in Vite 8 still fails if they can't be resolved at build time.
const optionalPackages = [
  '@getpara/solana-wallet-connectors',
  '@getpara/cosmos-wallet-connectors',
  '@getpara/wagmi-v2-connector',
  '@getpara/aa-alchemy',
  '@getpara/aa-biconomy',
  '@getpara/aa-cdp',
  '@getpara/aa-gelato',
  '@getpara/aa-pimlico',
  '@getpara/aa-porto',
  '@getpara/aa-rhinestone',
  '@getpara/aa-safe',
  '@getpara/aa-thirdweb',
  '@getpara/aa-zerodev',
  'wagmi',
  '@wagmi/core',
  '@wagmi/connectors',
];

// Mark any import whose bare specifier starts with an optional package
// (including subpath imports like "wagmi/connectors") as external so
// Rollup skips them entirely. These code paths are never reached at runtime.
function externalizeOptionalPackages() {
  return {
    name: 'externalize-optional-packages',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (optionalPackages.some((pkg) => id === pkg || id.startsWith(pkg + '/'))) {
        return { id, external: true };
      }
    },
  };
}

// Keep the miden SDK unbundled so its WASM asset path stays valid in dev.
export default defineConfig({
  plugins: [
    externalizeOptionalPackages(),
    wasm(),
    topLevelAwait(),
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util'],
    }),
  ],
  optimizeDeps: {
    // Keep Miden SDK unbundled and avoid prebundling Para's Stencil component bundles
    // to prevent multiple runtimes in dev.
    exclude: [
      '@miden-sdk/miden-sdk',
      ...optionalPackages,
    ],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  resolve: {
    dedupe: ['@getpara/web-sdk', '@getpara/react-sdk-lite', 'react', 'react-dom'],
  },
  // Ensure Vite treats wasm as a static asset with the correct MIME type.
  assetsInclude: ['**/*.wasm'],
  server: {
    fs: {
      allow: [process.cwd()],
    },
  },
});
