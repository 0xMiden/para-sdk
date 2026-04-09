const { exec, spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const fs = require('fs');

// Publish order:
//   Level 1: the root package `@miden-sdk/miden-para` — base.
//   Level 2: `@miden-sdk/use-miden-para-react` — peer-depends on the root package.
//   Level 3: `@miden-sdk/create-miden-para-react` — scaffolds projects that
//            reference both of the above at the versions we just published.
const repoRoot = path.resolve(__dirname, '..');
const buildOrder = [
  [repoRoot],
  [path.join(repoRoot, 'packages/use-miden-para-react')],
  [path.join(repoRoot, 'packages/create-miden-para-react')],
];

function runCommand(directory, command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: path.resolve(directory) }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing ${command} in ${directory}:`, error);
        return reject(error);
      }

      if (stderr) {
        console.error(`Error output from ${command} in ${directory}:`, stderr);
      }

      console.log(`Output from ${command} in ${directory}:`, stdout);
      resolve();
    });
  });
}

function runInteractiveCommand(directory, command) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, {
      cwd: path.resolve(directory),
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Command failed: ${command} (exit code ${code})`));
      }
      resolve();
    });
    child.on('error', reject);
  });
}

function parsePackageJson(directory) {
  const packageJsonPath = path.resolve(directory, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${directory}`);
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function getPackageInfo(directory) {
  const packageInfo = parsePackageJson(directory);
  if (!packageInfo.name || !packageInfo.version) {
    throw new Error(`Invalid package.json in ${directory}: missing name or version`);
  }
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    scripts: packageInfo.scripts ?? {},
  };
}

function hasScript(directory, scriptName) {
  return Boolean(getPackageInfo(directory).scripts[scriptName]);
}

function hasYarnLock(directory) {
  return fs.existsSync(path.resolve(directory, 'yarn.lock'));
}

/**
 * Strip script entries that would re-invoke this orchestrator as an npm
 * lifecycle hook. npm runs the `publish` script in package.json as a lifecycle
 * step during `npm publish`, so leaving it in place would recurse into this
 * file. We back up the original, rewrite a filtered package.json, and restore
 * once publish is done.
 */
function stripOrchestratorScripts(directory) {
  const packageJsonPath = path.resolve(directory, 'package.json');
  const original = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(original);
  let changed = false;

  if (pkg.scripts) {
    for (const key of ['publish', 'publish:dry']) {
      if (pkg.scripts[key]) {
        delete pkg.scripts[key];
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`Stripped orchestrator scripts from ${directory}/package.json`);
  }

  return { original, changed, packageJsonPath };
}

function restorePackageJson({ original, changed, packageJsonPath }) {
  if (changed) {
    fs.writeFileSync(packageJsonPath, original, 'utf8');
    console.log(`Restored original package.json in ${path.dirname(packageJsonPath)}`);
  }
}

function checkIfVersionExists(packageName, version) {
  return new Promise((resolve) => {
    exec(`npm view ${packageName}@${version} version`, (error, stdout) => {
      if (error) {
        if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
          console.warn(`Network error checking ${packageName}@${version}. Proceeding with publish...`);
          resolve(false);
        } else {
          // Package or version not found — safe to proceed.
          resolve(false);
        }
      } else {
        const publishedVersion = stdout.trim();
        resolve(publishedVersion === version);
      }
    });
  });
}

async function waitIfNecessary(results) {
  const publishedPackages = results.filter((result) => result && result.published);
  if (publishedPackages.length > 0) {
    console.log(`Waiting 10 seconds for npm propagation of ${publishedPackages.length} newly published package(s)...`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } else {
    console.log('No new packages published in this level');
  }
}

async function getOtp() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      'Please enter your OTP from your authenticator app: ',
      (otp) => {
        rl.close();
        resolve(otp.trim());
      }
    );
  });
}

async function prepareAndBuild(dir) {
  // Validate lockfile matches package.json, then install. Skip when the
  // package ships no yarn.lock (e.g. create-miden-para-react has no deps).
  if (hasYarnLock(dir)) {
    await runCommand(dir, 'yarn install --frozen-lockfile');
  } else {
    console.log(`No yarn.lock in ${dir}, skipping install`);
  }

  if (hasScript(dir, 'build')) {
    await runCommand(dir, 'yarn build');
  } else {
    console.log(`No build script in ${dir}, skipping build`);
  }
}

async function publishPackages() {
  // Safety net: if this script is somehow re-entered (e.g. because a child
  // `npm publish` triggered a `publish` lifecycle that re-invoked us), bail
  // out immediately instead of fork-bombing. The normal path strips the
  // `publish` script out of package.json during `npm publish`, but this guard
  // protects against any future lifecycle edge cases.
  if (process.env.MIDEN_PARA_PUBLISH_IN_PROGRESS === '1') {
    console.error(
      'scripts/publish.js re-entered via npm lifecycle — refusing to recurse.'
    );
    process.exit(0);
  }
  process.env.MIDEN_PARA_PUBLISH_IN_PROGRESS = '1';

  const isDryRun = process.argv.includes('--dry-run');
  const useOtp = process.argv.includes('--otp');
  console.log(
    isDryRun
      ? 'DRY RUN MODE - No packages will be actually published'
      : '🚀 LIVE MODE - Packages will be published to npm'
  );
  const otp = isDryRun ? null : useOtp ? await getOtp() : null;

  const packageUpdates = [];

  for (let level = 0; level < buildOrder.length; level++) {
    const levelPackages = buildOrder[level];
    console.log(`Processing Level ${level + 1}: ${levelPackages.join(', ')}`);

    const levelPromises = levelPackages.map(async (dir) => {
      try {
        console.log(`Processing ${dir}...`);

        const { name: packageName, version: packageVersion } = getPackageInfo(dir);
        const versionExists = await checkIfVersionExists(packageName, packageVersion);
        if (versionExists) {
          console.log(`${packageName}@${packageVersion} already exists on npm. Skipping build and publish.`);
          packageUpdates.push(`${packageName}: ${packageVersion} unchanged`);
          return { published: false, packageName, packageVersion };
        }

        console.log(`Building ${packageName}@${packageVersion}...`);
        await prepareAndBuild(dir);

        const backup = stripOrchestratorScripts(dir);
        try {
          if (isDryRun) {
            console.log(`DRY RUN: Would publish ${packageName}@${packageVersion}`);
            await runInteractiveCommand(dir, `npm publish --dry-run --access=public`);
            console.log(`DRY RUN: Validation successful for ${packageName}@${packageVersion}`);
            packageUpdates.push(`${packageName}: New version ${packageVersion} (dry-run)`);
            return { published: true, packageName, packageVersion };
          } else {
            console.log(`Publishing ${packageName}@${packageVersion}...`);
            const otpFlag = otp ? ` --otp=${otp}` : '';
            await runInteractiveCommand(dir, `npm publish${otpFlag} --access=public`);
            console.log(`Successfully published ${packageName}@${packageVersion}`);
            packageUpdates.push(`${packageName}: New version ${packageVersion}`);
            return { published: true, packageName, packageVersion };
          }
        } finally {
          restorePackageJson(backup);
        }
      } catch (error) {
        console.error(`Failed to process ${dir}:`, error.message);
        throw error;
      }
    });

    const results = await Promise.all(levelPromises);

    if (level !== buildOrder.length - 1) {
      await waitIfNecessary(results);
    }

    console.log(`Level ${level + 1} completed successfully!\n\n`);
  }

  console.log('All packages published successfully!');
  console.log('Summary of updates:');
  packageUpdates.forEach((update) => console.log(`- ${update}`));
}

publishPackages().catch((error) => {
  console.error('Error publishing packages:', error);
  process.exit(1);
});
