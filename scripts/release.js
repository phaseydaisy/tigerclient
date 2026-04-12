const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

const getFlagValue = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
};

const versionArg = args.find((arg) => !arg.startsWith("--"));
if (!versionArg) {
  console.error("Usage: npm run release -- <version> [--tag <tag>] [--notes <text>] [--skip-build] [--force]");
  process.exit(1);
}

const nextVersion = versionArg.trim();
const tag = getFlagValue("--tag") || `v${nextVersion}`;
const notes = getFlagValue("--notes");
const skipBuild = flags.has("--skip-build");
const force = flags.has("--force");

const nodeExecPath = process.execPath;
const nodeDir = path.dirname(nodeExecPath);
const withNodeEnv = (env = {}) => ({
  ...process.env,
  NODEJS_HOME: process.env.NODEJS_HOME || nodeDir,
  NODE: process.env.NODE || nodeExecPath,
  ...env
});

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
    ...options,
    env: withNodeEnv(options.env)
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const runCapture = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: withNodeEnv()
  });

  if (result.status !== 0) {
    const error = result.stderr.toString().trim();
    throw new Error(error || `Command failed: ${command}`);
  }

  return result.stdout.toString().trim();
};

const ensureCleanGit = () => {
  const status = runCapture("git", ["status", "--porcelain"]);
  if (status && !force) {
    console.error("Working tree is not clean. Commit or stash changes, or run with --force.");
    process.exit(1);
  }
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const findInstaller = (baseDir, filename) => {
  if (!fs.existsSync(baseDir)) {
    return null;
  }
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      const result = findInstaller(fullPath, filename);
      if (result) return result;
    } else if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
  }
  return null;
};

const repoRoot = path.resolve(__dirname, "..");
const packagePath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const versionPath = path.join(repoRoot, "version.json");

ensureCleanGit();

const pkg = readJson(packagePath);
const lock = fs.existsSync(packageLockPath) ? readJson(packageLockPath) : null;
const versionData = readJson(versionPath);

const setupExe = pkg.config
  && pkg.config.forge
  && Array.isArray(pkg.config.forge.makers)
  ? (pkg.config.forge.makers.find((maker) => maker.name === "@electron-forge/maker-squirrel") || {}).config?.setupExe
  : null;

const defaultAssetName = setupExe || "TigerClientSetup.exe";

let repoOwner = null;
let repoName = null;
let assetName = defaultAssetName;

if (versionData.download_url) {
  const match = versionData.download_url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/[^/]+\/(.+)$/);
  if (match) {
    repoOwner = match[1];
    repoName = match[2];
    assetName = match[3];
  }
}

if (!repoOwner || !repoName) {
  console.error("Unable to infer GitHub repo from version.json. Set download_url or edit the script.");
  process.exit(1);
}

pkg.version = nextVersion;
if (lock) {
  lock.version = nextVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = nextVersion;
  }
}

versionData.latest_version = nextVersion;
versionData.download_url = `https://github.com/${repoOwner}/${repoName}/releases/download/${tag}/${assetName}`;

writeJson(packagePath, pkg);
if (lock) {
  writeJson(packageLockPath, lock);
}
writeJson(versionPath, versionData);

if (!skipBuild) {
  run("npm", ["run", "make"], { cwd: repoRoot });
}

const outDir = path.join(repoRoot, "out");
const installerPath = findInstaller(outDir, assetName);
if (!installerPath) {
  console.error(`Installer not found (looked for ${assetName} under ${outDir}).`);
  process.exit(1);
}

run("git", ["add", "package.json", "version.json", "package-lock.json"], { cwd: repoRoot });
run("git", ["commit", "-m", `chore: release ${tag}`], { cwd: repoRoot });
run("git", ["tag", tag], { cwd: repoRoot });
run("git", ["push", "origin", "HEAD"], { cwd: repoRoot });
run("git", ["push", "origin", "--tags"], { cwd: repoRoot });

const releaseArgs = ["release", "create", tag, installerPath, "--title", tag];
if (notes) {
  releaseArgs.push("--notes", notes);
} else {
  releaseArgs.push("--generate-notes");
}

run("gh", releaseArgs, { cwd: repoRoot });

console.log(`Release ${tag} created and version.json updated.`);
