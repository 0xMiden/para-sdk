#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templateConfigPath = resolve(__dirname, "..", "template", "vite.config.ts");
const templateAppPath = resolve(__dirname, "..", "template", "src", "App.tsx");
const templatePolyfillsPath = resolve(__dirname, "..", "template", "src", "polyfills.ts");
const templateOptionalConnectorsPath = resolve(
  __dirname,
  "..",
  "template",
  "src",
  "optional-connectors.ts"
);
const repoRoot = resolve(__dirname, "..", "..", "..");
const localMidenParaPath =
  process.env.MIDEN_PARA_LOCAL_MIDEN_PARA_PATH ?? repoRoot;
const localUseMidenParaReactPath =
  process.env.MIDEN_PARA_LOCAL_USE_MIDEN_PARA_REACT_PATH ??
  join(repoRoot, "packages", "use-miden-para-react");
const useLocalDeps = process.env.MIDEN_PARA_LOCAL_DEPS === "1";

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("-")) ?? "miden-para-react-app";
const skipInstall = args.some(
  (flag) => flag === "--skip-install" || flag === "--no-install",
);
const skipScaffold =
  args.some((flag) => flag === "--skip-scaffold" || flag === "--no-scaffold") ||
  process.env.MIDEN_PARA_TEST_MODE === "1";
const targetDir = resolve(process.cwd(), target);
const targetParent = dirname(targetDir);
const targetName = basename(targetDir);
const baseEnv = {
  ...process.env,
  CI: process.env.CI ?? "true",
  npm_config_yes: process.env.npm_config_yes ?? "true",
};

ensureTargetParent();
if (skipScaffold) {
  scaffoldMinimalProject(targetDir, targetName);
} else {
  runCreateVite(targetName);
}
overrideViteConfig(targetDir);
overrideApp(targetDir);
ensurePolyfills(targetDir);
ensureOptionalConnectorsShim(targetDir);
ensurePolyfillDependency(targetDir);
ensureMidenParaDependencies(targetDir);
ensureNpmRc(targetDir);
logEnvReminder(targetName);

if (!skipInstall) {
  installDependencies(targetDir);
} else {
  logStep("Skipped dependency installation (--skip-install)");
}

function ensureTargetParent() {
  mkdirSync(targetParent, { recursive: true });
}

function runCreateVite(targetArg) {
  const scaffoldArgs = [
    "create",
    "vite@latest",
    targetArg,
    "--",
    "--template",
    "react-ts",
    "--yes", // avoid interactive prompts that might install/revert files
    "--no-install", // we handle installs after patching package.json
  ];
  runOrExit("npm", scaffoldArgs, targetParent, baseEnv, "n\n");
}

function scaffoldMinimalProject(targetRoot, name) {
  mkdirSync(targetRoot, { recursive: true });
  const pkgPath = join(targetRoot, "package.json");
  if (!existsSync(pkgPath)) {
    const pkg = {
      name,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
      devDependencies: {
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
        "@vitejs/plugin-react": "^4.2.0",
        typescript: "^5.2.2",
        vite: "^5.2.0",
      },
    };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const srcDir = join(targetRoot, "src");
  mkdirSync(srcDir, { recursive: true });
  const mainPath = join(srcDir, "main.tsx");
  if (!existsSync(mainPath)) {
    writeFileSync(
      mainPath,
      `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\n\nReactDOM.createRoot(document.getElementById("root")!).render(<App />);\n`
    );
  }
  const appPath = join(srcDir, "App.tsx");
  if (!existsSync(appPath)) {
    writeFileSync(appPath, "export default function App() { return null; }\n");
  }
}

function overrideViteConfig(targetRoot) {
  const dest = join(targetRoot, "vite.config.ts");
  copyFileSync(templateConfigPath, dest);
}

function overrideApp(targetRoot) {
  const dest = join(targetRoot, "src", "App.tsx");
  mkdirSync(join(targetRoot, "src"), { recursive: true });
  logStep(`Replacing App.tsx with Para + Miden starter at ${dest}`);
  copyFileSync(templateAppPath, dest);
}

function ensurePolyfills(targetRoot) {
  const dest = join(targetRoot, "src", "polyfills.ts");
  mkdirSync(join(targetRoot, "src"), { recursive: true });
  copyFileSync(templatePolyfillsPath, dest);

  const mainPath = join(targetRoot, "src", "main.tsx");
  if (existsSync(mainPath)) {
    const main = readFileSync(mainPath, "utf8");
    if (!main.includes('./polyfills') && !main.includes("./polyfills")) {
      writeFileSync(mainPath, `import "./polyfills";\n${main}`);
      logStep(`Injected polyfills import into ${mainPath}`);
    }
  }
}

function ensureOptionalConnectorsShim(targetRoot) {
  const dest = join(targetRoot, "src", "optional-connectors.ts");
  mkdirSync(join(targetRoot, "src"), { recursive: true });
  copyFileSync(templateOptionalConnectorsPath, dest);
}

function ensurePolyfillDependency(targetRoot) {
  const pkgPath = join(targetRoot, "package.json");
  if (!existsSync(pkgPath)) {
    logStep("No package.json found after scaffolding; nothing to patch");
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.devDependencies = pkg.devDependencies ?? {};
  pkg.devDependencies["vite-plugin-node-polyfills"] ??= "^0.24.0";
  pkg.devDependencies["vite-plugin-wasm"] ??= "^3.5.0";
  pkg.devDependencies["vite-plugin-top-level-await"] ??= "^1.6.0";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  logStep("Added Vite plugin deps (polyfills/wasm/top-level-await)");
}

function ensureNpmRc(targetRoot) {
  const npmrcPath = join(targetRoot, ".npmrc");
  const line = "legacy-peer-deps=true";
  if (existsSync(npmrcPath)) {
    const contents = readFileSync(npmrcPath, "utf8");
    if (contents.includes(line)) {
      logStep("Existing .npmrc already opts into legacy-peer-deps");
      return;
    }
    writeFileSync(npmrcPath, `${contents.trim()}\n${line}\n`);
    logStep("Updated .npmrc to include legacy-peer-deps");
    return;
  }
  writeFileSync(npmrcPath, `${line}\n`);
  logStep("Created .npmrc with legacy-peer-deps=true");
}

function ensureMidenParaDependencies(targetRoot) {
  const pkgPath = join(targetRoot, "package.json");
  if (!existsSync(pkgPath)) {
    logStep("No package.json found after scaffolding; cannot add dependencies");
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.devDependencies = pkg.devDependencies ?? {};
  pkg.resolutions = pkg.resolutions ?? {};
  pkg.scripts = pkg.scripts ?? {};
  const midenParaVersion = useLocalDeps
    ? `file:${localMidenParaPath}`
    : "0.14.0";
  const useMidenParaReactVersion = useLocalDeps
    ? `file:${localUseMidenParaReactPath}`
    : "^0.14.0";
  // Align with examples/react-signer so Para SDK connector peers are satisfied
  Object.assign(pkg.dependencies, {
    ...pkg.dependencies,
    "@getpara/react-sdk-lite": "^2.2.0",
    "@getpara/evm-wallet-connectors": "^2.2.0",
    "@miden-sdk/miden-sdk": "^0.14.0",
    "@miden-sdk/miden-para": midenParaVersion,
    "@miden-sdk/use-miden-para-react": useMidenParaReactVersion,
    "@miden-sdk/react": "^0.14.0",
    "@tanstack/react-query": "^5.0.0",
  });

  Object.assign(pkg.devDependencies, {
    ...pkg.devDependencies,
    "vite-plugin-node-polyfills": "^0.24.0",
    "vite-plugin-wasm": "^3.5.0",
    "vite-plugin-top-level-await": "^1.6.0",
  });


  Object.assign(pkg.resolutions, {
    "@getpara/react-sdk": "2.0.0-alpha.73",
    "@getpara/web-sdk": "2.0.0-alpha.73",
  });

  Object.assign(pkg.scripts, {
    ...pkg.scripts,
    'postinstall': 'setup-para'
  });

  delete pkg.peerDependencies;

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  logStep("Added Para + Miden starter dependencies");
}

function installDependencies(targetRoot) {
  const pm = detectPackageManager();
  logStep(`Installing dependencies with ${pm.command}`);
  runOrExit(pm.command, pm.args, targetRoot);
}

function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || "";
  if (ua.startsWith("pnpm")) return { command: "pnpm", args: ["install"] };
  if (ua.startsWith("yarn")) return { command: "yarn", args: [] };
  if (ua.startsWith("bun")) return { command: "bun", args: ["install"] };
  return { command: "npm", args: ["install"] };
}

function runOrExit(command, args, cwd, env, input) {
  const result = spawnSync(command, args, {
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    input,
    cwd,
    env,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function logStep(message) {
  console.log(`\n> ${message}`);
}

function logEnvReminder(dirName) {
  logStep(
    `Remember to use VITE_PARA_API_KEY like this:\n  cd ${dirName}\n  VITE_PARA_API_KEY=... npm run dev`,
  );
}
