import type { Plugin } from "vite";

export interface ParaVitePluginOptions {
  /**
   * Node.js polyfills to include. Para SDK requires these for crypto operations.
   * Default: ["buffer", "crypto", "stream", "util"]
   */
  polyfills?: string[];
}

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

  // Lazy-import nodePolyfills — require it at plugin creation time so Vite
  // gets the real plugin instance with all its hooks intact.
  let nodePolyfillsPlugins: Plugin[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nodePolyfills } = require("vite-plugin-node-polyfills");
    const result = nodePolyfills({ include: polyfills });
    // nodePolyfills can return a single Plugin or Plugin[]
    nodePolyfillsPlugins = Array.isArray(result) ? result : [result];
  } catch {
    console.warn(
      "[@miden-sdk/para-vite-plugin] vite-plugin-node-polyfills not found. " +
        "Install it: npm install -D vite-plugin-node-polyfills"
    );
  }

  const paraPlugin: Plugin = {
    name: "@miden-sdk/para-vite-plugin",
    enforce: "pre",

    config() {
      return {
        resolve: {
          alias: {
            // Stub unused Para wallet connectors (Solana/Cosmos) to avoid
            // pulling in heavy dependencies that aren't needed for Miden.
            "@getpara/solana-wallet-connectors":
              "data:text/javascript,export default {};",
            "@getpara/cosmos-wallet-connectors":
              "data:text/javascript,export default {};",
          },
          dedupe: ["@getpara/web-sdk", "@getpara/react-sdk-lite"],
        },
        optimizeDeps: {
          exclude: [
            "@getpara/solana-wallet-connectors",
            "@getpara/cosmos-wallet-connectors",
          ],
        },
      };
    },
  };

  return [paraPlugin, ...nodePolyfillsPlugins];
}
