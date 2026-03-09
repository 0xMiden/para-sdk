import type { Plugin } from "vite";
import { createRequire } from "node:module";

export interface ParaVitePluginOptions {
  /**
   * Node.js polyfills to include. Para SDK requires these for crypto operations.
   * Default: ["buffer", "crypto", "stream", "util"]
   */
  polyfills?: string[];
}

const STUB_PACKAGES = [
  "@getpara/solana-wallet-connectors",
  "@getpara/cosmos-wallet-connectors",
];

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
   * Esbuild plugin that stubs the connector packages during Vite's dep
   * pre-bundling so esbuild doesn't leave unresolvable bare imports in
   * the pre-bundled output.
   */
  const stubConnectorsEsbuild = {
    name: "stub-para-connectors",
    setup(build: any) {
      const filter = new RegExp(
        `^(${STUB_PACKAGES.map((p) => p.replace(/[/]/g, "\\/")).join("|")})$`
      );
      build.onResolve({ filter }, (args: any) => ({
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

    config(userConfig) {
      const existingPlugins =
        userConfig.optimizeDeps?.esbuildOptions?.plugins ?? [];

      return {
        resolve: {
          dedupe: ["@getpara/web-sdk", "@getpara/react-sdk-lite"],
        },
        optimizeDeps: {
          esbuildOptions: {
            plugins: [...existingPlugins, stubConnectorsEsbuild],
          },
        },
      };
    },

    // Stub the connector packages at Vite's module resolution level
    // (handles imports that bypass pre-bundling, e.g. in SSR or dev).
    resolveId(source) {
      if (STUB_PACKAGES.includes(source)) {
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
