import type { Plugin } from "vite";
import { createRequire } from "node:module";

export interface ParaVitePluginOptions {
  /**
   * Node.js polyfills to include. Para SDK requires these for crypto operations.
   * Default: ["buffer", "crypto", "stream", "util"]
   */
  polyfills?: string[];
}

// Para's @getpara/react-core dynamically imports many optional integration
// packages behind hooks the typical Miden dApp doesn't use (Account
// Abstraction providers, Solana / Cosmos / Stellar / Ethers / Viem chain
// signers, EVM wallet connectors). Without stubs, vite's import-analysis
// fails at dev-server start and rollup fails at build, even though
// runtime never reaches those code paths.
//
// Match by prefix regex so we don't have to enumerate sub-paths (Para's
// react-core also dynamically imports per-chain signer files like
// @getpara/react-core/dist/chains/evm/viem/useParaViemAccount.js).
//
// IMPORTANT: do NOT add @getpara/core-sdk, @getpara/shared, or
// @getpara/react-common — those are real peers used by the EVM happy path.
const STUB_REGEX =
  /^@getpara\/(aa-|cosmjs-|cosmos-|ethers-|evm-wallet-|solana-|stellar-|viem-v2-)/;

const STUB_PREFIX = "\0para-stub:";

/**
 * Vite plugin that configures Para SDK requirements:
 * - Node.js polyfills (buffer, crypto, stream, util) via vite-plugin-node-polyfills
 * - Stubs for unused Para wallet connectors (Solana, Cosmos)
 *
 * Returns an array of plugins (Vite flattens nested arrays in the plugins config).
 *
 * Requires `vite-plugin-node-polyfills` as a dev dependency.
 *
 * @example
 * ```ts
 * import { paraVitePlugin } from "@miden-sdk/use-miden-para-react/vite";
 *
 * export default defineConfig({
 *   plugins: [react(), midenVitePlugin(), paraVitePlugin()],
 * });
 * ```
 */
export function paraVitePlugin(options?: ParaVitePluginOptions): Plugin[] {
  const polyfills = options?.polyfills ?? ["buffer", "crypto", "stream", "util"];

  // Resolve nodePolyfills from the consuming project's node_modules (not
  // from this package's location) using createRequire with process.cwd().
  let nodePolyfillsPlugins: Plugin[] = [];
  try {
    const projectRequire = createRequire(`file://${process.cwd()}/`);
    const { nodePolyfills } = projectRequire("vite-plugin-node-polyfills");
    const result = nodePolyfills({ include: polyfills });
    // nodePolyfills can return a single Plugin or Plugin[]
    nodePolyfillsPlugins = Array.isArray(result) ? result : [result];
  } catch {
    console.warn(
      "[@miden-sdk/para-vite-plugin] vite-plugin-node-polyfills not found. " +
        "Install it: npm install -D vite-plugin-node-polyfills"
    );
  }

  /**
   * Esbuild plugin that stubs the optional Para packages during Vite's
   * dep pre-bundling so esbuild doesn't leave unresolvable bare imports
   * in the pre-bundled output.
   */
  const stubOptionalPackagesEsbuild = {
    name: "stub-para-optional",
    setup(build: any) {
      build.onResolve({ filter: STUB_REGEX }, (args: any) => ({
        path: args.path,
        namespace: "para-stub",
      }));
      build.onLoad(
        { filter: /.*/, namespace: "para-stub" },
        () => ({ contents: "export default {};", loader: "js" as const })
      );
    },
  };

  const paraPlugin: Plugin = {
    name: "@miden-sdk/para-vite-plugin",
    enforce: "pre",

    config() {
      return {
        resolve: {
          dedupe: ["@getpara/web-sdk", "@getpara/react-sdk-lite"],
        },
        build: {
          rollupOptions: {
            // Externalize optional packages for prod builds — runtime
            // dynamic imports for them throw a friendly error if invoked,
            // but dApps that don't use AA / cross-chain don't ship the
            // bytes.
            external: (id: string) => STUB_REGEX.test(id),
          },
        },
      };
    },

    // Inject esbuild stub plugin after all config() hooks have run,
    // so other plugins (e.g. vite-plugin-node-polyfills) can't overwrite it.
    configResolved(config) {
      if (!config.optimizeDeps.esbuildOptions) {
        config.optimizeDeps.esbuildOptions = {};
      }
      if (!config.optimizeDeps.esbuildOptions.plugins) {
        config.optimizeDeps.esbuildOptions.plugins = [];
      }
      const hasPlugin = config.optimizeDeps.esbuildOptions.plugins.some(
        (p: any) => p.name === "stub-para-optional"
      );
      if (!hasPlugin) {
        config.optimizeDeps.esbuildOptions.plugins.push(stubOptionalPackagesEsbuild);
      }
    },

    // Stub the optional packages at Vite's module resolution level
    // (handles imports that bypass pre-bundling, e.g. in SSR or dev).
    resolveId(source) {
      if (STUB_REGEX.test(source)) {
        return STUB_PREFIX + source;
      }
    },

    load(id) {
      if (id.startsWith(STUB_PREFIX)) {
        return "export default {};";
      }
    },
  };

  return [paraPlugin, ...nodePolyfillsPlugins];
}
