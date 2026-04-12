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

const versionArg = getFlagValue("--version") || args.find((arg) => !arg.startsWith("--"));
const tag = getFlagValue("--tag") || "Minecraft";
const notes = getFlagValue("--releasenote") || getFlagValue("--notes");
const skipBuild = flags.has("--skip-build");
const isPrerelease = flags.has("--prerelease");
const REPO_OWNER = "phaseydaisy";
const REPO_NAME = "tigerclient";

const nodeExecPath = process.execPath;
const nodeDir = path.dirname(nodeExecPath);
const withNodeEnv = (env = {}) => ({
  ...process.env,
  NODEJS_HOME: process.env.NODEJS_HOME || nodeDir,
  NODE: process.env.NODE || nodeExecPath,
  ...env
});

if (!versionArg) {
  console.error("Usage: npm run publish -- <version> [--tag <tag>] [--releasenote <text>] [--notes <text>] [--skip-build] [--prerelease]");
  process.exit(1);
}

const nextVersion = String(versionArg).trim();

const resolveGhPath = () => {
  const envPath = process.env.GH_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const whichCmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(whichCmd, ["gh"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  if (result.status === 0) {
    const output = result.stdout.toString().trim();
    if (output) {
      return output.split(/\r?\n/)[0].trim();
    }
  }

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LocalAppData || "";
    const userProfile = process.env.UserProfile || "";

    const candidates = [
      path.join(programFiles, "GitHub CLI", "gh.exe"),
      path.join(programFilesX86, "GitHub CLI", "gh.exe"),
      path.join(localAppData, "GitHub CLI", "gh.exe"),
      path.join(localAppData, "Programs", "GitHub CLI", "gh.exe"),
      path.join(userProfile, "scoop", "shims", "gh.exe")
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const run = (command, commandArgs, options = {}) => {
  let execCommand = command;
  let execArgs = commandArgs;
  let execOptions = {
    stdio: "inherit",
    shell: false,
    ...options
  };

  if (command === "gh") {
    const ghPath = resolveGhPath();
    if (ghPath) {
      execCommand = ghPath;
    }
  }

  if (command === "npm") {
    const npmExec = process.env.npm_execpath;
    if (!npmExec) {
      console.error("npm_execpath is not set. Run this script via npm, e.g. npm run publish.");
      process.exit(1);
    }
    execCommand = process.execPath;
    execArgs = [npmExec, ...commandArgs];
  }

  const result = spawnSync(execCommand, execArgs, {
    ...execOptions,
    env: withNodeEnv(execOptions.env)
  });

  if (result.error) {
    console.error(`Failed to run ${execCommand}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const runCapture = (command, commandArgs) => {
  let execCommand = command;
  let execArgs = commandArgs;
  if (command === "gh") {
    const ghPath = resolveGhPath();
    if (ghPath) {
      execCommand = ghPath;
    }
  }
  if (command === "npm") {
    const npmExec = process.env.npm_execpath;
    if (!npmExec) {
      return {
        status: 1,
        stdout: "",
        stderr: "npm_execpath is not set"
      };
    }
    execCommand = process.execPath;
    execArgs = [npmExec, ...commandArgs];
  }

  const result = spawnSync(execCommand, execArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    cwd: repoRoot,
    env: withNodeEnv()
  });

  if (result.error) {
    return {
      status: 1,
      stdout: "",
      stderr: result.error.message
    };
  }

  return {
    status: result.status || 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim()
  };
};

const runCurlUpload = (uploadUrl, filePath) => {
  return new Promise((resolve, reject) => {
    const tokenResult = runCapture("gh", ["auth", "token"]);
    if (tokenResult.status !== 0 || !tokenResult.stdout) {
      console.error("Failed to fetch GitHub token for curl upload.");
      reject(new Error("Failed to fetch GitHub token"));
      return;
    }

    const curlArgs = [
      "--progress-bar",
      "--retry", "1",
      "--retry-delay", "1",
      "--retry-connrefused",
      "--connect-timeout", "10",
      "-H", `Authorization: token ${tokenResult.stdout}`,
      "-H", "Content-Type: application/octet-stream",
      "--data-binary", `@${filePath}`,
      uploadUrl
    ];

    try {
      run("curl.exe", curlArgs, { cwd: repoRoot });
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};

const findSquirrelDir = (baseDir) => {
  if (!fs.existsSync(baseDir)) {
    return null;
  }
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      const result = findSquirrelDir(fullPath);
      if (result) return result;
    } else if (entry.isFile() && entry.name === "RELEASES") {
      return path.dirname(fullPath);
    }
  }
  return null;
};

const repoRoot = path.resolve(__dirname, "..");

const ghCheck = runCapture("gh", ["--version"]);
if (ghCheck.status !== 0) {
  console.error("GitHub CLI (gh) is required. Install it with: winget install GitHub.cli");
  process.exit(1);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const packagePath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const versionPath = path.join(repoRoot, "version.json");

const pkg = readJson(packagePath);
pkg.version = nextVersion;
writeJson(packagePath, pkg);

if (fs.existsSync(packageLockPath)) {
  const lock = readJson(packageLockPath);
  lock.version = nextVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = nextVersion;
  }
  writeJson(packageLockPath, lock);
}

if (fs.existsSync(versionPath)) {
  const versionData = readJson(versionPath);
  versionData.latest_version = nextVersion;
  versionData.download_url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/TigerClientSetup.exe`;
  writeJson(versionPath, versionData);
}

console.log(`Prepared version ${nextVersion} for tag ${tag}.`);

if (!skipBuild) {
  console.log("Building Squirrel assets...");
  run("npm", ["run", "make"], { cwd: repoRoot });
}

const makeDir = path.join(repoRoot, "out", "make");
const squirrelDir = findSquirrelDir(makeDir);
if (!squirrelDir) {
  console.error("Could not find Squirrel output (RELEASES file not found). Run npm run make first.");
  process.exit(1);
}

const releasesFile = path.join(squirrelDir, "RELEASES");
const setupExe = path.join(squirrelDir, "TigerClientSetup.exe");
const nupkgFiles = fs.readdirSync(squirrelDir)
  .filter((file) => file.toLowerCase().endsWith(".nupkg"))
  .map((file) => path.join(squirrelDir, file));

const assets = [releasesFile, setupExe, ...nupkgFiles].filter((filePath) => fs.existsSync(filePath));
if (assets.length === 0) {
  console.error("No Squirrel assets found to upload.");
  process.exit(1);
}

const viewResult = runCapture("gh", ["release", "view", tag]);
if (viewResult.status !== 0) {
  console.log(`Creating release ${tag}${isPrerelease ? ' (prerelease)' : ''}...`);
  const createArgs = ["release", "create", tag, "--title", tag];
  if (isPrerelease) {
    createArgs.push("--prerelease");
  }
  if (notes) {
    createArgs.push("--notes", notes);
  } else {
    createArgs.push("--generate-notes");
  }
  run("gh", createArgs, { cwd: repoRoot });
} else {
  console.log(`Deleting existing assets from ${tag}...`);
  const assetsResult = runCapture("gh", ["release", "view", tag, "--json", "assets", "-q", ".assets[].name"]);
  if (assetsResult.status === 0 && assetsResult.stdout.trim()) {
    const existingAssets = assetsResult.stdout.trim().split("\n").filter(name => name.length > 0);
    for (const assetName of existingAssets) {
      const deleteResult = runCapture("gh", ["release", "delete-asset", tag, assetName]);
      if (deleteResult.status === 0) {
        console.log(`  ✓ Deleted ${assetName}`);
      } else {
        console.warn(`  ✗ Failed to delete ${assetName}`);
      }
    }
  }
}

(async () => {
  console.log(`Uploading ${assets.length} assets to ${tag}...`);
  const uploadUrlResult = runCapture("gh", [
    "api",
    `repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tag}`,
    "-q",
    ".upload_url"
  ]);

  if (uploadUrlResult.status !== 0 || !uploadUrlResult.stdout) {
    console.error("Failed to resolve upload URL. Falling back to gh release upload.");
    run("gh", ["release", "upload", tag, ...assets], { cwd: repoRoot });
  } else {
    const baseUploadUrl = uploadUrlResult.stdout.replace("{?name,label}", "");
    const uploadPromises = assets.map(assetPath => {
      const assetName = path.basename(assetPath);
      const uploadUrl = `${baseUploadUrl}?name=${encodeURIComponent(assetName)}`;
      console.log(`  -> Starting upload: ${assetName}...`);
      return runCurlUpload(uploadUrl, assetPath)
        .then(() => {
          console.log(`  ✓ Completed: ${assetName}`);
        })
        .catch(error => {
          console.error(`  ✗ Failed: ${assetName}`, error.message);
          throw error;
        });
    });
    
    await Promise.all(uploadPromises);
  }

  console.log(`Uploaded ${assets.length} Squirrel assets to release ${tag}.`);
})().catch(error => {
  console.error("Upload failed:", error);
  process.exit(1);
});
