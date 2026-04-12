const { app, BrowserWindow, ipcMain, shell, autoUpdater, clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { spawn, exec } = require("child_process");
const https = require("https");
const http = require("http");
const { createWriteStream, existsSync, readdirSync, statSync } = require("fs");
const os = require("os");
const config = require("./config");
const packageJson = require("./package.json");
const DiscordRPC = require("discord-rpc");

const APP_VERSION = packageJson.version;
const UPDATE_REPO_OWNER = "phaseydaisy";
const UPDATE_REPO_NAME = "tigerclient";

const DISCORD_CLIENT_ID = "1234567890123456789";
let rpcClient = null;
let gameStartTime = null;

const AUTH_FILE = "auth.json";
const ALTS_FILE = "alts.json";
const SETTINGS_FILE = "settings.json";
const SERVERS_FILE = "servers.json";

let minecraftProcess = null;
let minecraftTitleInterval = null;
let currentGameVersion = null;

const startMinecraftTitleBranding = (pid, version) => {
  if (!pid || process.platform !== "win32") return;
  if (minecraftTitleInterval) clearInterval(minecraftTitleInterval);

  const runBranding = () => {
    if (!minecraftProcess || minecraftProcess.pid !== pid) {
      if (minecraftTitleInterval) clearInterval(minecraftTitleInterval);
      minecraftTitleInterval = null;
      return;
    }

    const command = `powershell -Command "$p=Get-Process -Id ${pid}; if ($p -and $p.MainWindowHandle -ne 0) { $sig='[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr hWnd, string lpString);'; Add-Type -Namespace Native -Name Win32 -MemberDefinition $sig -ErrorAction SilentlyContinue; $t=$p.MainWindowTitle; if ([string]::IsNullOrWhiteSpace($t)) { $t='Minecraft ${version} - Tiger Client' } elseif ($t -notmatch 'Tiger Client') { $t=$t + ' - Tiger Client' } [Native.Win32]::SetWindowText($p.MainWindowHandle, $t) | Out-Null }"`;
    exec(command, (err) => {
      if (err) console.error('Failed to set window title:', err);
    });
  };

  runBranding();
  minecraftTitleInterval = setInterval(runBranding, 2000);

  setTimeout(() => {
    if (minecraftTitleInterval) {
      clearInterval(minecraftTitleInterval);
      minecraftTitleInterval = null;
    }
  }, 60000);
};

const getLauncherMinecraftDir = (version) => {
  if (version) {
    return path.join(app.getPath("userData"), "minecraft", version);
  }
  return path.join(app.getPath("userData"), "minecraft");
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0a0808",
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, "assets", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  win.loadFile("index.html");

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
    if (input.key === 'F12') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'c') {
      event.preventDefault();
    }
  });

  return win;
};

const setupDiscordRPC = () => {
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "1234567890123456789") {
    console.log("Discord RPC: Using placeholder client ID. Create your own at https://discord.com/developers/applications");
  }

  rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

  rpcClient.on('ready', () => {
    console.log('Discord RPC connected');
    updateRPCIdle();
  });

  rpcClient.on('disconnected', () => {
    console.log('Discord RPC disconnected');
  });

  rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(error => {
    console.error('Failed to connect to Discord RPC:', error.message);
  });
};

const updateRPCIdle = () => {
  if (!rpcClient || !rpcClient.user) return;

  rpcClient.setActivity({
    details: "In Launcher",
    state: "Choosing a version",
    largeImageKey: "tiger_logo",
    largeImageText: `Tiger Client v${APP_VERSION}`,
    instance: false,
  }).catch(error => {
    console.error('Failed to update Discord RPC (idle):', error.message);
  });
};

const updateRPCPlaying = (version) => {
  if (!rpcClient || !rpcClient.user) return;

  const startTimestamp = gameStartTime || Date.now();

  rpcClient.setActivity({
    details: `Playing Minecraft ${version}`,
    state: "In Game",
    startTimestamp,
    largeImageKey: "tiger_logo",
    largeImageText: `Tiger Client v${APP_VERSION}`,
    smallImageKey: "minecraft_icon",
    smallImageText: `Minecraft ${version}`,
    instance: false,
  }).catch(error => {
    console.error('Failed to update Discord RPC (playing):', error.message);
  });
};

let lastUpdateInfo = null;
let updateCheckTimeout = null;

const clearUpdateCheckTimeout = () => {
  if (updateCheckTimeout) {
    clearTimeout(updateCheckTimeout);
    updateCheckTimeout = null;
  }
};

const sendUpdateStatus = (window, payload) => {
  if (window) {
    window.webContents.send("update-status", payload);
  }
};

const compareVersions = (a, b) => {
  const aParts = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const bParts = String(b).split(".").map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
};

const checkForUpdatesFromGitHub = async () => {
  try {
    const currentVersion = app.getVersion();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: "api.github.com",
        path: `/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases`,
        method: "GET",
        headers: { "User-Agent": "TigerClient" }
      };

      https.request(options, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const releases = JSON.parse(data);

            let updateAvailable = null;
            for (const release of releases) {
              if (release.draft || release.prerelease) continue;

              const nupkgAsset = release.assets.find(a => a.name.includes(".nupkg"));
              if (!nupkgAsset) continue;

              const versionMatch = nupkgAsset.name.match(/TigerClient-(\d+\.\d+\.\d+)/);
              if (!versionMatch) continue;

              const tagVersion = versionMatch[1];
              if (compareVersions(tagVersion, currentVersion) > 0) {
                const hasSquirrelAssets = release.assets.some(a =>
                  a.name.includes("RELEASES") || a.name.includes(".nupkg") || a.name === "TigerClientSetup.exe"
                );

                if (hasSquirrelAssets) {
                  updateAvailable = {
                    version: tagVersion,
                    releaseUrl: release.html_url,
                    assets: release.assets
                  };
                  break;
                }
              }
            }

            resolve(updateAvailable);
          } catch (e) {
            reject(e);
          }
        });
      }).on("error", reject).end();
    });
  } catch (error) {
    console.error("Error checking for updates:", error);
    throw error;
  }
};

const setupAutoUpdater = (window) => {
  if (!app.isPackaged) {
    return;
  }

  let feedUrl = null;
  if (packageJson && packageJson.version) {
    try {
      const versionData = require("./version.json");
      if (versionData && versionData.download_url) {
        const parsed = new URL(versionData.download_url);
        feedUrl = `${parsed.origin}${parsed.pathname.replace(/\/[^/]*$/, "/")}`;
      }
    } catch (error) {
      feedUrl = null;
    }
  }

  if (!feedUrl) {
    feedUrl = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/download/latest/`;
  }

  autoUpdater.setFeedURL({ url: feedUrl });

  let downloadedUpdatePath = null;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for updates...");
    clearUpdateCheckTimeout();
    sendUpdateStatus(window, { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info);
    clearUpdateCheckTimeout();
    sendUpdateStatus(window, { status: "downloading", version: info && info.version ? info.version : null });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("No update available");
    clearUpdateCheckTimeout();
    sendUpdateStatus(window, { status: "none" });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded:", info);
    clearUpdateCheckTimeout();
    sendUpdateStatus(window, { status: "downloaded", version: info && info.version ? info.version : null });
  });

  autoUpdater.on("error", (error) => {
    console.error("Update error:", error);
    clearUpdateCheckTimeout();
    sendUpdateStatus(window, { status: "error", message: error ? error.message : "Update error" });
  });

};
const getAuthEncryptionKey = () => {
  const secret = `${app.getPath("userData")}-${os.userInfo().username}-TigerLauncherAuth`;
  return crypto.createHash("sha256").update(secret).digest();
};

const encryptAuthData = (payload) => {
  const key = getAuthEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptAuthData = (payload) => {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid auth payload format");
  }
  const key = getAuthEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
};

const readAuth = async () => {
  const filePath = path.join(app.getPath("userData"), AUTH_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      return JSON.parse(raw);
    } catch (plainJsonError) {
      try {
        return decryptAuthData(raw);
      } catch (decryptError) {
        console.error("Failed to decrypt auth data:", decryptError.message);
        return null;
      }
    }
  } catch (error) {
    return null;
  }
};

const writeAuth = async (data) => {
  const filePath = path.join(app.getPath("userData"), AUTH_FILE);
  const authPayload = {
    ...data,
    lastUpdated: Date.now()
  };
  const encrypted = encryptAuthData(authPayload);
  await fs.writeFile(filePath, encrypted, { encoding: "utf-8", mode: 0o600 });
};

const readAlts = async () => {
  const filePath = path.join(app.getPath("userData"), ALTS_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
};

const writeAlts = async (data) => {
  const filePath = path.join(app.getPath("userData"), ALTS_FILE);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
};

const readServers = async () => {
  const filePath = path.join(app.getPath("userData"), SERVERS_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
};

const writeServers = async (data) => {
  const filePath = path.join(app.getPath("userData"), SERVERS_FILE);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
};

const RAM_MIN_MB = 1024;
const RAM_ABSOLUTE_MAX_MB = 16384;
const RAM_STEP_MB = 512;

const toNearestStep = (value, step) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue / step) * step;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getRamLimits = () => {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024);
  const reservedForSystem = 2048;
  const available = totalMB - reservedForSystem;
  const steppedMax = Math.floor(available / RAM_STEP_MB) * RAM_STEP_MB;
  const maxSelectableRam = clamp(steppedMax, RAM_MIN_MB, RAM_ABSOLUTE_MAX_MB);
  return { totalMB, maxSelectableRam };
};

const getAutoRamSettings = () => {
  const { totalMB, maxSelectableRam } = getRamLimits();
  const target = Math.floor(totalMB * 0.45);
  const ramAllocation = clamp(toNearestStep(target, RAM_STEP_MB), RAM_MIN_MB, maxSelectableRam);
  const minRam = clamp(Math.floor(ramAllocation / 2), 512, ramAllocation);
  return { ramAllocation, minRam, totalMB, maxSelectableRam };
};

const normalizeRamSettings = (data = {}) => {
  const { totalMB, maxSelectableRam } = getRamLimits();
  const autoRam = data.autoRam !== false;

  if (autoRam) {
    const auto = getAutoRamSettings();
    return {
      autoRam: true,
      ramAllocation: auto.ramAllocation,
      minRam: auto.minRam,
      totalMB,
      maxSelectableRam
    };
  }

  const requestedMax = toNearestStep(data.ramAllocation || RAM_MIN_MB, RAM_STEP_MB);
  const ramAllocation = clamp(requestedMax, RAM_MIN_MB, maxSelectableRam);

  const fallbackMin = clamp(Math.floor(ramAllocation / 2), 512, ramAllocation);
  const requestedMin = Number(data.minRam);
  const minRam = Number.isFinite(requestedMin)
    ? clamp(Math.floor(requestedMin), 512, ramAllocation)
    : fallbackMin;

  return {
    autoRam: false,
    ramAllocation,
    minRam,
    totalMB,
    maxSelectableRam
  };
};


const readSettings = async () => {
  const filePath = path.join(app.getPath("userData"), SETTINGS_FILE);
  const defaults = {
    ramAllocation: RAM_MIN_MB * 2,
    minRam: RAM_MIN_MB,
    autoRam: true,
    startOnBoot: false
  };
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return normalizeRamSettings({ ...defaults, ...parsed, startOnBoot: parsed.startOnBoot ?? false });
  } catch (error) {
    return normalizeRamSettings(defaults);
  }
};

// Helper to manage Windows startup shortcut
const setStartupShortcut = async (enable) => {
  if (process.platform !== "win32") return;
  const appData = process.env.APPDATA;
  if (!appData) return;

  const startupFolder = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const shortcutPath = path.join(startupFolder, 'Tiger Client.lnk');
  const exePath = process.execPath;

  if (enable) {
    const ws = require('windows-shortcuts');
    if (!existsSync(shortcutPath)) {
      ws.create(shortcutPath, {
        target: exePath,
        args: '',
        workingDir: path.dirname(exePath),
        runStyle: 1,
        desc: 'Launch Tiger Client on Windows startup',
        icon: exePath
      }, function(err) {
        if (err) console.error('Failed to create startup shortcut:', err);
      });
    }
  } else {
    if (existsSync(shortcutPath)) {
      try { require('fs').unlinkSync(shortcutPath); } catch (e) { console.error('Failed to remove startup shortcut:', e); }
    }
  }
};

const writeSettings = async (data) => {
  const filePath = path.join(app.getPath("userData"), SETTINGS_FILE);
  let prev = {};
  try { prev = JSON.parse(await fs.readFile(filePath, "utf-8")); } catch {}
  const normalized = normalizeRamSettings({ ...prev, ...data });

  if (typeof data.startOnBoot !== 'undefined' && data.startOnBoot !== prev.startOnBoot) {
    setStartupShortcut(!!data.startOnBoot);
  }

  const output = {
    ...prev,
    ...data,
    autoRam: normalized.autoRam,
    ramAllocation: normalized.ramAllocation,
    minRam: normalized.minRam,
    startOnBoot: typeof data.startOnBoot !== 'undefined' ? data.startOnBoot : prev.startOnBoot ?? false
  };

  delete output.totalMB;
  delete output.maxSelectableRam;

  await fs.writeFile(filePath, JSON.stringify(output, null, 2), "utf-8");
};

const fetchJson = (url, headers = {}) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: headers
    };

    https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);

          if (res.statusCode && res.statusCode >= 400) {
            const errorMsg = parsed.error || `HTTP ${res.statusCode}`;
            reject(new Error(errorMsg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
};

const getMinecraftVersions = async () => {
  try {
    const manifest = await fetchJson("https://launchermeta.mojang.com/mc/game/version_manifest.json");
    const releases = manifest.versions.filter(v => v.type === "release");
    const selected = releases
      .slice(0, 20)
      .map(v => ({ id: v.id, url: v.url }));

    const ensureIds = ["1.8.9", "1.8"];
    for (const id of ensureIds) {
      if (!selected.some(v => v.id === id)) {
        const match = releases.find(v => v.id === id);
        if (match) {
          selected.push({ id: match.id, url: match.url });
        }
      }
    }

    return selected;
  } catch (error) {
    return [
      { id: "1.21.4", url: "" },
      { id: "1.20.4", url: "" },
      { id: "1.20.1", url: "" },
      { id: "1.19.4", url: "" },
      { id: "1.8.9", url: "" }
    ];
  }
};

const fetchJsonPost = (url, body, headers = {}) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isFormData = headers["Content-Type"] === "application/x-www-form-urlencoded";
    const postData = isFormData ? body : JSON.stringify(body);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": isFormData ? "application/x-www-form-urlencoded" : "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);

          if (res.statusCode && res.statusCode >= 400) {
            const errorMsg = parsed.error || parsed.error_description || `HTTP ${res.statusCode}`;
            reject(new Error(errorMsg));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
};

const MS_CLIENT_ID = "00000000402B5328";
const MS_REDIRECT_URI = "https://login.live.com/oauth20_desktop.srf";

const parseMsTokenResponse = (tokenResponse, fallbackRefreshToken = null) => {
  const now = Date.now();
  const accessTokenExpiresIn = Number(tokenResponse.expires_in) || 3600;
  const refreshTokenExpiresIn = Number(tokenResponse.refresh_token_expires_in) || null;

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || fallbackRefreshToken,
    accessTokenExpiresAt: now + accessTokenExpiresIn * 1000,
    refreshExpiresAt: refreshTokenExpiresIn ? now + refreshTokenExpiresIn * 1000 : null
  };
};

const refreshMicrosoftAccessToken = async (refreshToken) => {
  const tokenResponse = await fetchJsonPost(
    "https://login.live.com/oauth20_token.srf",
    new URLSearchParams({
      client_id: MS_CLIENT_ID,
      refresh_token: refreshToken,
      redirect_uri: MS_REDIRECT_URI,
      grant_type: "refresh_token"
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
    true
  );

  if (!tokenResponse.access_token) {
    throw new Error("Failed to refresh Microsoft access token");
  }

  return parseMsTokenResponse(tokenResponse, refreshToken);
};

const isTokenExpiring = (expiresAt, bufferMs = 5 * 60 * 1000) => {
  if (!expiresAt) return true;
  return Date.now() > expiresAt - bufferMs;
};

const refreshValidAuth = async (auth) => {
  if (!auth) {
    throw new Error("No saved auth available");
  }

  const accessExpired = !auth.accessToken || isTokenExpiring(auth.accessTokenExpiresAt);
  const xstsExpired = !auth.xstsToken || isTokenExpiring(auth.xstsExpiresAt, 10 * 60 * 1000);

  if (!accessExpired && !xstsExpired) {
    return auth;
  }

  if (!auth.refreshToken) {
    throw new Error("No saved refresh token available");
  }

  if (auth.refreshExpiresAt && Date.now() > auth.refreshExpiresAt) {
    throw new Error("Microsoft refresh token has expired");
  }

  const refreshed = await refreshMicrosoftAccessToken(auth.refreshToken);
  const session = await getMinecraftSession(refreshed.accessToken, { checkOwnership: false });

  const updatedAuth = {
    ...auth,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: refreshed.refreshToken,
    refreshExpiresAt: refreshed.refreshExpiresAt,
    uuid: session.profile.uuid,
    name: session.profile.name,
    xblToken: session.xblToken,
    xblExpiresAt: session.xblExpiresAt,
    xstsToken: session.xstsToken,
    xstsExpiresAt: session.xstsExpiresAt,
    lastRefreshedAt: Date.now()
  };

  await writeAuth(updatedAuth);
  return updatedAuth;
};

const refreshMinecraftSession = async (auth, { checkOwnership = false } = {}) => {
  if (!auth || !auth.refreshToken) {
    throw new Error("Missing refresh token");
  }

  if (auth.refreshExpiresAt && Date.now() > auth.refreshExpiresAt) {
    throw new Error("Microsoft refresh token has expired");
  }

  const refreshed = await refreshMicrosoftAccessToken(auth.refreshToken);
  const session = await getMinecraftSession(refreshed.accessToken, { checkOwnership });

  const updatedAuth = {
    ...auth,
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: refreshed.refreshToken,
    refreshExpiresAt: refreshed.refreshExpiresAt,
    uuid: session.profile.uuid,
    name: session.profile.name,
    xblToken: session.xblToken,
    xblExpiresAt: session.xblExpiresAt,
    xstsToken: session.xstsToken,
    xstsExpiresAt: session.xstsExpiresAt,
    lastRefreshedAt: Date.now()
  };

  await writeAuth(updatedAuth);
  return updatedAuth;
};

const getMinecraftProfileFromAccessToken = async (accessToken) => {
  const profileResponse = await fetchJson(
    "https://api.minecraftservices.com/minecraft/profile",
    { Authorization: `Bearer ${accessToken}` }
  );

  if (!profileResponse.id || !profileResponse.name) {
    throw new Error("Failed to get Minecraft profile");
  }

  return {
    uuid: profileResponse.id,
    name: profileResponse.name
  };
};

const getMinecraftSession = async (msAccessToken, { checkOwnership = true } = {}) => {
  const xblResponse = await fetchJsonPost(
    "https://user.auth.xboxlive.com/user/authenticate",
    {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT"
    }
  );

  if (!xblResponse.Token) {
    throw new Error("Failed to get Xbox Live token");
  }

  const xblToken = xblResponse.Token;
  const xblExpiresAt = xblResponse.NotAfter ? Date.parse(xblResponse.NotAfter) : Date.now() + 4 * 60 * 60 * 1000;
  const userHash = xblResponse.DisplayClaims?.xui?.[0]?.uhs;

  const xstsResponse = await fetchJsonPost(
    "https://xsts.auth.xboxlive.com/xsts/authorize",
    {
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xblToken]
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT"
    }
  );

  if (!xstsResponse.Token) {
    throw new Error("Failed to get XSTS token");
  }

  const xstsToken = xstsResponse.Token;
  const xstsExpiresAt = xstsResponse.NotAfter ? Date.parse(xstsResponse.NotAfter) : Date.now() + 4 * 60 * 60 * 1000;

  const mcResponse = await fetchJsonPost(
    "https://api.minecraftservices.com/authentication/login_with_xbox",
    {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`
    }
  );

  if (!mcResponse.access_token) {
    throw new Error("Failed to authenticate with Minecraft");
  }

  if (checkOwnership) {
    const ownershipResponse = await fetchJson(
      "https://api.minecraftservices.com/entitlements/mcstore",
      { Authorization: `Bearer ${mcResponse.access_token}` }
    );

    if (!ownershipResponse.items || ownershipResponse.items.length === 0) {
      throw new Error("Minecraft Java Edition not found on this account");
    }
  }

  const profile = await getMinecraftProfileFromAccessToken(mcResponse.access_token);
  const mcExpiresAt = mcResponse.expires_in ? Date.now() + Number(mcResponse.expires_in) * 1000 : Date.now() + 60 * 60 * 1000;

  return {
    accessToken: mcResponse.access_token,
    accessTokenExpiresAt: mcExpiresAt,
    profile,
    xblToken,
    xblExpiresAt,
    xstsToken,
    xstsExpiresAt
  };
};

const msAuth = async () => {
  const clientId = MS_CLIENT_ID;
  const redirectUri = MS_REDIRECT_URI;
  let mainWindow = BrowserWindow.getAllWindows()[0];

  if (!mainWindow) {
    return {
      ok: false,
      message: "Main window not found. Please restart the app."
    };
  }

  const sendStatus = (message) => {
    if (mainWindow) {
      mainWindow.webContents.send("auth-status", message);
    }
  };

  try {
    sendStatus("Opening Microsoft sign-in...");

    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = new URL("https://login.live.com/oauth20_authorize.srf");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "XboxLive.signin offline_access");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    const accessToken = await new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        parent: mainWindow,
        modal: true,
        autoHideMenuBar: true,
        title: "Sign in with Microsoft"
      });

      let settled = false;
      let authCodeHandled = false;
      const settle = (type, value) => {
        if (settled) return;
        settled = true;
        if (!authWindow.isDestroyed()) {
          authWindow.close();
        }
        if (type === "resolve") {
          resolve(value);
        } else {
          reject(value);
        }
      };

      authWindow.loadURL(authUrl.toString());
      authWindow.once("ready-to-show", () => {
        if (!authWindow.isDestroyed()) {
          authWindow.show();
        }
      });

      const handleUrl = async (url) => {
        if (!url.startsWith(redirectUri) || settled) return;

        try {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get("code");
          const returnedState = urlObj.searchParams.get("state");
          const error = urlObj.searchParams.get("error");
          const errorDescription = urlObj.searchParams.get("error_description");

          if (error) {
            settle("reject", new Error(errorDescription || error));
            return;
          }

          if (!code) {
            settle("reject", new Error("No authorization code received"));
            return;
          }

          if (authCodeHandled) {
            return;
          }
          authCodeHandled = true;

          if (returnedState !== state) {
            settle("reject", new Error("State verification failed"));
            return;
          }

          sendStatus("Exchanging authorization code...");
          const tokenResponse = await fetchJsonPost(
            "https://login.live.com/oauth20_token.srf",
            new URLSearchParams({
              client_id: clientId,
              code: code,
              redirect_uri: redirectUri,
              grant_type: "authorization_code"
            }).toString(),
            { "Content-Type": "application/x-www-form-urlencoded" },
            true
          );

          if (!tokenResponse.access_token) {
            settle("reject", new Error("Failed to get access token"));
            return;
          }

          settle("resolve", {
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token,
            expires_in: tokenResponse.expires_in,
            refresh_token_expires_in: tokenResponse.refresh_token_expires_in
          });
        } catch (err) {
          settle("reject", err);
        }
      };

      const redirectHandler = async (event, url) => {
        if (!url.startsWith(redirectUri) || settled) return;
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        await handleUrl(url);
      };

      authWindow.webContents.on("will-redirect", redirectHandler);
      authWindow.webContents.on("will-navigate", redirectHandler);
      authWindow.webContents.on("did-get-redirect-request", async (_event, oldUrl, newUrl) => {
        if (!newUrl || settled || !newUrl.startsWith(redirectUri)) return;
        await handleUrl(newUrl);
      });
      authWindow.webContents.on("did-navigate", async (_event, url) => {
        if (!url.startsWith(redirectUri) || settled) return;
        await handleUrl(url);
      });

      authWindow.on("closed", () => {
        if (!settled) {
          settle("reject", new Error("Authentication window closed"));
        }
      });
    });

    sendStatus("Authenticating with Xbox Live...");
    const msTokens = parseMsTokenResponse(accessToken, accessToken.refreshToken);
    sendStatus("Authenticating with Minecraft...");
    const session = await getMinecraftSession(msTokens.accessToken, { checkOwnership: true });

    sendStatus("Login successful!");
    return {
      ok: true,
      message: "Successfully authenticated with Microsoft",
      mockUser: {
        name: session.profile.name,
        email: `${session.profile.name}@xbox.com`,
        uuid: session.profile.uuid,
        accessToken: session.accessToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        refreshToken: msTokens.refreshToken,
        refreshExpiresAt: msTokens.refreshExpiresAt,
        xblToken: session.xblToken,
        xblExpiresAt: session.xblExpiresAt,
        xstsToken: session.xstsToken,
        xstsExpiresAt: session.xstsExpiresAt,
        lastRefreshedAt: Date.now()
      }
    };
  } catch (error) {
    sendStatus(`Error: ${error.message}`);
    return {
      ok: false,
      message: `Authentication error: ${error.message}`,
      mockUser: null
    };
  }
};

const uploadSkinToMicrosoft = async (accessToken, skinDataUrl, variant) => {
  return new Promise((resolve, reject) => {
    try {

      const base64Data = skinDataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');


      const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;


      const formData = [];


      formData.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="variant"\r\n\r\n`,
        `${variant}\r\n`
      );


      formData.push(
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="skin.png"\r\n`,
        `Content-Type: image/png\r\n\r\n`
      );


      const formDataBuffer = Buffer.concat([
        Buffer.from(formData.join('')),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

      const options = {
        hostname: 'api.minecraftservices.com',
        port: 443,
        path: '/minecraft/profile/skins',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formDataBuffer.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            resolve({ ok: true, message: 'Skin uploaded successfully' });
          } else {
            reject(new Error(`Skin upload failed: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(formDataBuffer);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
};

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = createWriteStream(dest);

    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest).catch(() => {});
      reject(err);
    });

    file.on("error", (err) => {
      file.close();
      fs.unlink(dest).catch(() => {});
      reject(err);
    });
  });
};


const downloadFilesInBatch = async (downloads, concurrency = 10, onProgress = null) => {
  const results = [];
  let completedCount = 0;

  for (let i = 0; i < downloads.length; i += concurrency) {
    const batch = downloads.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (download) => {
        try {
          await downloadFile(download.url, download.dest);
          completedCount++;
          if (onProgress) {
            onProgress(completedCount, downloads.length);
          }
          return { success: true, ...download };
        } catch (err) {
          return { success: false, error: err, ...download };
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
};

const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
};

const copyMinecraftSettings = async (targetDir) => {
  try {
    const defaultMinecraftDir = path.join(app.getPath("appData"), ".minecraft");
    const settingsFiles = ['options.txt', 'servers.dat', 'optionsof.txt'];

    for (const fileName of settingsFiles) {
      const sourcePath = path.join(defaultMinecraftDir, fileName);
      const targetPath = path.join(targetDir, fileName);

      try {

        await fs.access(targetPath);
      } catch (targetErr) {

        try {
          await fs.access(sourcePath);
          await fs.copyFile(sourcePath, targetPath);
        } catch (sourceErr) {

        }
      }
    }


    const sourceResourcepacks = path.join(defaultMinecraftDir, 'resourcepacks');
    const targetResourcepacks = path.join(targetDir, 'resourcepacks');

    try {
      await fs.access(sourceResourcepacks);
      await ensureDir(targetResourcepacks);


      const existingFiles = await fs.readdir(targetResourcepacks);
      if (existingFiles.length === 0) {
        const files = await fs.readdir(sourceResourcepacks);
        for (const file of files) {
          const srcFile = path.join(sourceResourcepacks, file);
          const destFile = path.join(targetResourcepacks, file);
          try {
            const stat = await fs.stat(srcFile);
            if (stat.isFile()) {
              await fs.copyFile(srcFile, destFile);
            }
          } catch (err) {

          }
        }
      }
    } catch (err) {

    }
  } catch (err) {

  }
};

const downloadGameFiles = async (versionId, minecraftDir, sendProgress) => {
  try {
    sendProgress(`Fetching version manifest for ${versionId}...`);

    const manifestUrl = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
    const manifest = await fetchJson(manifestUrl);
    const versionInfo = manifest.versions.find(v => v.id === versionId);

    if (!versionInfo) {
      throw new Error(`Version ${versionId} not found`);
    }

    sendProgress(`Downloading version data...`);
    const versionJson = await fetchJson(versionInfo.url);

    const versionsDir = path.join(minecraftDir, "versions", versionId);
    await ensureDir(versionsDir);

    const versionJsonPath = path.join(versionsDir, `${versionId}.json`);
    let cachedVersionJson = null;
    if (existsSync(versionJsonPath)) {
      cachedVersionJson = JSON.parse(await fs.readFile(versionJsonPath, "utf-8"));
    }

    if (cachedVersionJson) {
      versionJson = cachedVersionJson;
    } else {
      sendProgress(`Downloading version data...`);
      versionJson = await fetchJson(versionInfo.url);
      await fs.writeFile(versionJsonPath, JSON.stringify(versionJson, null, 2));
    }

    const clientJarPath = path.join(versionsDir, `${versionId}.jar`);
    if (!existsSync(clientJarPath)) {
      sendProgress(`Downloading Minecraft ${versionId}...`);
      await downloadFile(versionJson.downloads.client.url, clientJarPath);
    }

    sendProgress(`Downloading libraries...`);
    const librariesDir = path.join(minecraftDir, "libraries");
    await ensureDir(librariesDir);

    const libraryPaths = [];
    const libraryDownloads = [];


    for (const lib of versionJson.libraries) {
      if (lib.rules) {
        const allowed = lib.rules.some(rule => {
          if (rule.action === "allow") {
            if (!rule.os) return true;
            return rule.os.name === "windows";
          }
          return false;
        });
        if (!allowed) continue;
      }

      if (lib.downloads.artifact) {
        const artifact = lib.downloads.artifact;
        const libPath = path.join(librariesDir, artifact.path);
        libraryPaths.push(libPath);

        if (!existsSync(libPath)) {
          await ensureDir(path.dirname(libPath));
          libraryDownloads.push({ url: artifact.url, dest: libPath });
        }
      }

      if (lib.downloads.classifiers && lib.natives) {
        const nativeKey = lib.natives.windows || lib.natives["windows-x64"];
        if (nativeKey && lib.downloads.classifiers[nativeKey]) {
          const native = lib.downloads.classifiers[nativeKey];
          const nativePath = path.join(librariesDir, native.path);

          if (!existsSync(nativePath)) {
            await ensureDir(path.dirname(nativePath));
            libraryDownloads.push({ url: native.url, dest: nativePath });
          }
        }
      }
    }


    if (libraryDownloads.length > 0) {
      await downloadFilesInBatch(libraryDownloads, 10, (completed, total) => {
        if (completed % 5 === 0 || completed === total) {
          sendProgress(`Downloaded ${completed}/${total} libraries...`);
        }
      });
    }


    sendProgress(`Downloading asset index...`);
    const assetsDir = path.join(minecraftDir, "assets");
    const assetsIndexDir = path.join(assetsDir, "indexes");
    await ensureDir(assetsIndexDir);

    const assetIndex = versionJson.assetIndex;
    const assetIndexPath = path.join(assetsIndexDir, `${assetIndex.id}.json`);

    if (!existsSync(assetIndexPath)) {
      await downloadFile(assetIndex.url, assetIndexPath);
    }

    const assetIndexJson = JSON.parse(await fs.readFile(assetIndexPath, "utf-8"));
    const assetObjects = Object.values(assetIndexJson.objects);

    sendProgress(`Downloading ${assetObjects.length} assets...`);
    const objectsDir = path.join(assetsDir, "objects");


    const assetDownloads = [];
    for (const asset of assetObjects) {
      const hash = asset.hash;
      const subPath = hash.substring(0, 2);
      const assetPath = path.join(objectsDir, subPath, hash);

      if (!existsSync(assetPath)) {
        await ensureDir(path.dirname(assetPath));
        assetDownloads.push({
          url: `https://resources.download.minecraft.net/${subPath}/${hash}`,
          dest: assetPath
        });
      }
    }


    if (assetDownloads.length > 0) {
      await downloadFilesInBatch(assetDownloads, 20, (completed, total) => {
        if (completed % 50 === 0 || completed === total) {
          sendProgress(`Downloaded ${completed}/${total} assets...`);
        }
      });
    }

    return {
      versionJson,
      libraryPaths,
      clientJarPath
    };
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
};

const searchModrinthMods = async (query, gameVersion, sortBy = 'popular') => {
  const normalizedQuery = String(query || '').trim();

  const sortMap = {
    relevance: 'relevance',
    trending: 'updated',
    popular: 'follows',
    downloads: 'downloads'
  };

  const selectedSort = String(sortBy || 'popular').toLowerCase();
  const index = sortMap[selectedSort] || sortMap.popular;

  try {
    const encodedQuery = encodeURIComponent(normalizedQuery);
    const facets = gameVersion
      ? `[["project_type:mod"],["categories:fabric"],["versions:${gameVersion}"]]`
      : `[["project_type:mod"],["categories:fabric"]]`;
    const searchUrl = `https://api.modrinth.com/v2/search?query=${encodedQuery}&facets=${encodeURIComponent(facets)}&index=${index}&limit=24`;

    return new Promise((resolve) => {
      let timedOut = false;

      const req = https.get(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Tiger-Launcher/1.0'
        }
      }, (res) => {
        if (timedOut) return;
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (timedOut) return;
          if (res.statusCode !== 200) {
            resolve({ ok: false, error: `API error (${res.statusCode})`, mods: [] });
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const mods = parsed.hits || [];
            const formatted = mods.map(mod => ({
              id: mod.project_id,
              name: mod.title,
              summary: mod.description,
              downloadCount: mod.downloads,
              author: mod.author,
              logo: mod.icon_url || '',
              dateModified: mod.date_modified,
              slug: mod.slug
            }));
            resolve({ ok: true, mods: formatted, sortBy: selectedSort });
          } catch (err) {
            resolve({ ok: false, error: 'Failed to parse results', mods: [] });
          }
        });
      });

      req.on('error', (err) => {
        if (!timedOut) {
          resolve({ ok: false, error: `Network error: ${err.message}`, mods: [] });
        }
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        req.destroy();
        resolve({ ok: false, error: 'Search timed out. Try again.', mods: [] });
      }, 8000);

      req.on('end', () => clearTimeout(timeout));
    });
  } catch (err) {
    return { ok: false, error: err.message, mods: [] };
  }
};

const downloadFabricLoader = async (minecraftVersion, minecraftDir, sendProgress) => {
  try {
    sendProgress('Downloading Fabric loader...');

    const fabricMetaUrl = `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}`;
    const loaderVersions = await fetchJson(fabricMetaUrl);

    if (!loaderVersions || loaderVersions.length === 0) {
      throw new Error('No Fabric loader found for this version');
    }

    const latestLoader = loaderVersions[0];
    const loaderVersion = latestLoader.loader.version;

    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/profile/json`;
    const fabricProfile = await fetchJson(profileUrl);

    const fabricDir = path.join(minecraftDir, 'fabric');
    await ensureDir(fabricDir);

    const fabricLibraries = fabricProfile.libraries || [];
    const fabricLibPaths = [];
    const fabricArtifactNames = new Set();

    for (const lib of fabricLibraries) {
      if (lib.url && lib.name) {
        const libPath = lib.name.split(':');
        const artifactName = libPath[1];
        const fileName = `${libPath[1]}-${libPath[2]}.jar`;
        const libFilePath = path.join(fabricDir, fileName);

        if (artifactName) {
          fabricArtifactNames.add(String(artifactName).toLowerCase());
        }

        if (!existsSync(libFilePath)) {
          const downloadUrl = `${lib.url}${libPath[0].replace(/\./g, '/')}/${libPath[1]}/${libPath[2]}/${fileName}`;
          await downloadFile(downloadUrl, libFilePath);
        }
        fabricLibPaths.push(libFilePath);
      }
    }


    sendProgress('Installing Fabric API...');
    try {
      await downloadFabricAPI(minecraftVersion, minecraftDir);
    } catch (apiError) {
      console.error('Failed to install Fabric API:', apiError);

    }

    return {
      mainClass: fabricProfile.mainClass,
      libraryPaths: fabricLibPaths,
      artifactNames: Array.from(fabricArtifactNames)
    };
  } catch (error) {
    throw new Error(`Fabric download failed: ${error.message}`);
  }
};

const downloadFabricAPI = async (minecraftVersion, minecraftDir) => {
  try {
    const modsDir = path.join(minecraftDir, 'mods');
    await ensureDir(modsDir);


    const files = readdirSync(modsDir);
    const hasFabricAPI = files.some(f => f.toLowerCase().includes('fabric') && f.toLowerCase().includes('api'));
    if (hasFabricAPI) {
      return;
    }


    const apiFacets = `[["project_type:mod"],["categories:fabric"],["versions:${minecraftVersion}"]]`;
    const apiQuery = encodeURIComponent("fabric api");
    const searchUrl = `https://api.modrinth.com/v2/search?query=${apiQuery}&facets=${encodeURIComponent(apiFacets)}`;
    const searchResult = await fetchJson(searchUrl);

    if (!searchResult || !searchResult.hits || searchResult.hits.length === 0) {
      throw new Error('Fabric API not found');
    }

    const fabricAPIProject = searchResult.hits[0];
    const projectId = fabricAPIProject.project_id;


    const loaderParam = encodeURIComponent(JSON.stringify(["fabric"]));
    const versionParam = encodeURIComponent(JSON.stringify([minecraftVersion]));
    const versionsUrl = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=${loaderParam}&game_versions=${versionParam}`;
    const versions = await fetchJson(versionsUrl);

    if (!versions || versions.length === 0) {
      throw new Error('No compatible Fabric API version found');
    }

    const latestVersion = versions[0];
    const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];

    if (!primaryFile) {
      throw new Error('No download file found');
    }

    const filePath = path.join(modsDir, primaryFile.filename);
    await downloadFile(primaryFile.url, filePath);

    return { ok: true };
  } catch (error) {
    throw new Error(`Fabric API install failed: ${error.message}`);
  }
};

const modProjectNameCache = new Map();
const modProjectInfoCache = new Map();

const normalizeModIdentifier = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getProjectInfo = async (projectId) => {
  if (!projectId) {
    return { name: "Unknown", icon: "", slug: "" };
  }

  if (modProjectInfoCache.has(projectId)) {
    return modProjectInfoCache.get(projectId);
  }

  try {
    const data = await fetchJson(`https://api.modrinth.com/v2/project/${projectId}`);
    const info = {
      name: data && data.title ? data.title : projectId,
      icon: data && data.icon_url ? data.icon_url : "",
      slug: data && data.slug ? data.slug : ""
    };
    modProjectInfoCache.set(projectId, info);
    return info;
  } catch (error) {
    const fallback = { name: projectId, icon: "", slug: "" };
    modProjectInfoCache.set(projectId, fallback);
    return fallback;
  }
};

const getProjectName = async (projectId) => {
  if (!projectId) return "Unknown";
  if (modProjectNameCache.has(projectId)) {
    return modProjectNameCache.get(projectId);
  }
  try {
    const info = await getProjectInfo(projectId);
    const name = info.name;
    modProjectNameCache.set(projectId, name);
    return name;
  } catch (error) {
    return projectId;
  }
};

const checkModCompatibility = async (modId, gameVersion, installedModIds, installedModNames = []) => {
  if (!modId || !gameVersion) return { issues: [] };
  try {
    const versionParam = encodeURIComponent(JSON.stringify([gameVersion]));
    const loaderParam = encodeURIComponent(JSON.stringify(["fabric"]));
    const versionUrl = `https://api.modrinth.com/v2/project/${modId}/version?loaders=${loaderParam}&game_versions=${versionParam}`;
    const versions = await fetchJson(versionUrl);
    if (!versions || versions.length === 0) return { issues: [] };
    const latest = versions[0];
    if (!latest.dependencies) return { issues: [] };

    const issues = [];
    for (const dep of latest.dependencies) {
      if (!dep.project_id || !dep.dependency_type) continue;
      const depInfo = await getProjectInfo(dep.project_id);
      const depName = depInfo.name;
      const depIdInstalled = installedModIds.includes(dep.project_id);
      const depNameToken = normalizeModIdentifier(depName);
      const depSlugToken = normalizeModIdentifier(depInfo.slug);
      const depInstalledByName = installedModNames.some((installedName) => {
        const installedToken = normalizeModIdentifier(installedName);
        if (!installedToken || !depNameToken) return false;
        return installedToken === depNameToken
          || installedToken.includes(depNameToken)
          || depNameToken.includes(installedToken)
          || (depSlugToken && (installedToken === depSlugToken || installedToken.includes(depSlugToken) || depSlugToken.includes(installedToken)));
      });

      if (dep.dependency_type === "required" && !depIdInstalled && !depInstalledByName) {
        const name = depName;
        issues.push({ type: "missing", id: dep.project_id, name });
      }

      if (dep.dependency_type === "incompatible" && (depIdInstalled || depInstalledByName)) {
        const name = depName;
        issues.push({ type: "incompatible", id: dep.project_id, name });
      }
    }

    return { issues };
  } catch (error) {
    return { issues: [] };
  }
};

const getInstalledMods = async (minecraftDir, gameVersion) => {
  try {
    const modsDir = path.join(minecraftDir, 'mods');

    try {
      await fs.access(modsDir);
    } catch {
      return { ok: true, mods: [] };
    }

    const files = readdirSync(modsDir);
    const jarFiles = files.filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));

    const mods = await Promise.all(jarFiles.map(async (file) => {
      const filePath = path.join(modsDir, file);
      const stats = statSync(filePath);


      const nameWithoutExt = file.replace('.jar.disabled', '').replace('.jar', '');
      const modId = await tryGetModIdFromName(nameWithoutExt, gameVersion);

      let hasUpdate = false;
      let icon = "";
      if (modId) {
        hasUpdate = await checkModUpdate(modId, stats.mtime, gameVersion);
        const projectInfo = await getProjectInfo(modId);
        icon = projectInfo.icon;
      }

      return {
        fileName: file,
        name: nameWithoutExt,
        size: stats.size,
        dateAdded: stats.mtime,
        modId: modId,
        hasUpdate: hasUpdate,
        icon: icon
      };
    }));

    const installedModIds = mods
      .filter(mod => mod.modId)
      .map(mod => mod.modId);
    const installedModNames = mods.map((mod) => mod.name);

    const modsWithCompatibility = await Promise.all(mods.map(async (mod) => {
      if (!mod.modId) return { ...mod, compatibility: { issues: [] } };
      const compatibility = await checkModCompatibility(mod.modId, gameVersion, installedModIds, installedModNames);
      return { ...mod, compatibility };
    }));

    return { ok: true, mods: modsWithCompatibility };
  } catch (err) {
    return { ok: false, error: err.message, mods: [] };
  }
};

const tryGetModIdFromName = async (modName, gameVersion) => {
  try {

    const normalizedName = (modName || "").toLowerCase();
    if (normalizedName.includes("fabric-api") || normalizedName.includes("fabricapi")) {
      return "P7dR8mSH";
    }

    const cleanedName = String(modName || "")
      .replace(/\.(jar|disabled)$/gi, "")
      .replace(/[+_.-]?mc\d+(?:\.\d+)*(?:[-+_.]?\d+)*/gi, " ")
      .replace(/\b(fabric|forge|quilt|neoforge|loader|beta|alpha|release)\b/gi, " ")
      .replace(/[0-9]+(?:\.[0-9]+)*/g, " ")
      .replace(/[_+.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const queryName = cleanedName || modName;
    const encodedQuery = encodeURIComponent(queryName);
    const facets = gameVersion
      ? `[["project_type:mod"],["categories:fabric"],["versions:${gameVersion}"]]`
      : `[["project_type:mod"],["categories:fabric"]]`;
    const searchUrl = `https://api.modrinth.com/v2/search?query=${encodedQuery}&facets=${encodeURIComponent(facets)}`;

    const result = await fetchJson(searchUrl);
    if (result && result.hits && result.hits.length > 0) {
      const targetToken = normalizeModIdentifier(queryName || modName);
      const scored = result.hits.map((hit) => {
        const titleToken = normalizeModIdentifier(hit.title);
        const slugToken = normalizeModIdentifier(hit.slug);
        let score = 0;
        if (titleToken === targetToken || slugToken === targetToken) score += 100;
        if (titleToken.includes(targetToken) || targetToken.includes(titleToken)) score += 50;
        if (slugToken.includes(targetToken) || targetToken.includes(slugToken)) score += 40;
        return { hit, score };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0]?.hit;
      if (best) {
        return best.project_id;
      }
    }
  } catch (err) {

  }
  return null;
};

const checkModUpdate = async (modId, currentFileDate, gameVersion) => {
  try {
    const versionParam = encodeURIComponent(JSON.stringify([gameVersion]));
    const loaderParam = encodeURIComponent(JSON.stringify(["fabric"]));
    const versionsUrl = `https://api.modrinth.com/v2/project/${modId}/version?loaders=${loaderParam}&game_versions=${versionParam}`;
    const versions = await fetchJson(versionsUrl);

    if (versions && versions.length > 0) {
      const latestVersion = versions[0];
      const latestDate = new Date(latestVersion.date_published);
      return latestDate > currentFileDate;
    }
  } catch (err) {

  }
  return false;
};

const updateSingleMod = async (modId, fileName, gameVersion) => {
  try {
    const minecraftDir = getLauncherMinecraftDir(gameVersion);
    const modsDir = path.join(minecraftDir, "mods");
    const oldPath = path.join(modsDir, fileName);

    // Download the new file first to a temp file and atomically replace.
    // downloadMod writes to a temp file and will attempt to rename/copy into place.
    const result = await downloadMod(modId, minecraftDir, null, gameVersion);

    // If download succeeded and the new filename differs from the old one,
    // try to remove the old file (cleanup duplicate filenames).
    if (result && result.ok && result.fileName && result.fileName !== fileName) {
      try {
        const existingOld = path.join(modsDir, fileName);
        if (existsSync(existingOld)) {
          await fs.unlink(existingOld);
        }
      } catch (err) {
        // ignore cleanup errors
      }
    }

    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const importModFiles = async (filePaths, minecraftDir) => {
  try {
    const modsDir = path.join(minecraftDir, "mods");
    await ensureDir(modsDir);

    const incomingFiles = Array.isArray(filePaths) ? filePaths : [];
    const imported = [];
    const skipped = [];
    const failed = [];

    for (const rawPath of incomingFiles) {
      const sourcePath = String(rawPath || "").trim();
      if (!sourcePath) continue;

      const sourceName = path.basename(sourcePath);
      if (!sourceName.toLowerCase().endsWith(".jar")) {
        skipped.push(sourceName || sourcePath);
        continue;
      }

      try {
        await fs.access(sourcePath);

        const parsed = path.parse(sourceName);
        let targetName = sourceName;
        let targetPath = path.join(modsDir, targetName);
        let duplicateIndex = 1;

        while (existsSync(targetPath)) {
          targetName = `${parsed.name} (${duplicateIndex})${parsed.ext}`;
          targetPath = path.join(modsDir, targetName);
          duplicateIndex += 1;
        }

        await fs.copyFile(sourcePath, targetPath);
        imported.push(targetName);
      } catch (error) {
        failed.push({ file: sourceName || sourcePath, error: error.message });
      }
    }

    return {
      ok: true,
      imported,
      skipped,
      failed,
      count: imported.length
    };
  } catch (error) {
    return { ok: false, error: error.message, imported: [], skipped: [], failed: [], count: 0 };
  }
};

const importModData = async (files, minecraftDir) => {
  try {
    const modsDir = path.join(minecraftDir, "mods");
    await ensureDir(modsDir);

    const incomingFiles = Array.isArray(files) ? files : [];
    const imported = [];
    const skipped = [];
    const failed = [];

    for (const file of incomingFiles) {
      const fileName = String(file?.name || "").trim();
      const bytes = file?.bytes;

      if (!fileName || !fileName.toLowerCase().endsWith(".jar")) {
        skipped.push(fileName || "unknown");
        continue;
      }

      try {
        const parsed = path.parse(fileName);
        let targetName = fileName;
        let targetPath = path.join(modsDir, targetName);
        let duplicateIndex = 1;

        while (existsSync(targetPath)) {
          targetName = `${parsed.name} (${duplicateIndex})${parsed.ext}`;
          targetPath = path.join(modsDir, targetName);
          duplicateIndex += 1;
        }

        const fileBytes = bytes instanceof Uint8Array
          ? bytes
          : (Array.isArray(bytes) ? Uint8Array.from(bytes) : null);

        if (!fileBytes || fileBytes.length === 0) {
          throw new Error("File data is empty");
        }

        await fs.writeFile(targetPath, fileBytes);
        imported.push(targetName);
      } catch (error) {
        failed.push({ file: fileName || "unknown", error: error.message });
      }
    }

    return {
      ok: true,
      imported,
      skipped,
      failed,
      count: imported.length
    };
  } catch (error) {
    return { ok: false, error: error.message, imported: [], skipped: [], failed: [], count: 0 };
  }
};

const downloadMod = async (modId, minecraftDir, mainWindow, gameVersion) => {
  try {
    const modsDir = path.join(minecraftDir, 'mods');
    await ensureDir(modsDir);

    const sendProgress = (message) => {
      if (mainWindow) {
        mainWindow.webContents.send('mod-download-progress', message);
      }
    };

    sendProgress('Fetching mod versions...');

    const gameVersionParam = gameVersion ? `?game_versions=["${gameVersion}"]` : "";
    const versionsUrl = `https://api.modrinth.com/v2/project/${modId}/version${gameVersionParam}`;

    return new Promise((resolve) => {
      let timedOut = false;
      const versionsReq = https.get(versionsUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Tiger-Launcher/1.0'
        }
      }, (res) => {
        if (timedOut) return;
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          if (timedOut) return;
          if (res.statusCode !== 200) {
            resolve({ ok: false, error: `Versions API error (${res.statusCode})` });
            return;
          }
          try {
            const versions = JSON.parse(data);
            if (!versions || versions.length === 0) {
              resolve({ ok: false, error: 'No versions available' });
              return;
            }

            const targetVersion = versions.find(version =>
              Array.isArray(version.game_versions) && version.game_versions.includes(gameVersion) &&
              Array.isArray(version.loaders) && version.loaders.includes('fabric')
            );
            if (!targetVersion) {
              resolve({ ok: false, error: `No Fabric version available for ${gameVersion}` });
              return;
            }

            const file = targetVersion.files && targetVersion.files[0];

            if (!file || !file.url) {
              resolve({ ok: false, error: 'Download URL not found' });
              return;
            }

            const fileName = file.filename;
            const downloadUrl = file.url;
            const outputPath = path.join(modsDir, fileName);
            const tempPath = path.join(modsDir, fileName + '.download');

            sendProgress(`Downloading ${fileName}...`);

            const downloadReq = https.get(downloadUrl, (downloadRes) => {
              if (downloadRes.statusCode !== 200) {
                resolve({ ok: false, error: `Download failed (${downloadRes.statusCode})` });
                return;
              }
              const fileStream = createWriteStream(tempPath);
              const totalSize = parseInt(downloadRes.headers['content-length'], 10);
              let downloaded = 0;

              downloadRes.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize) {
                  const percent = ((downloaded / totalSize) * 100).toFixed(1);
                  sendProgress(`Downloading ${fileName}... ${percent}%`);
                }
              });

              downloadRes.pipe(fileStream);

              fileStream.on('finish', async () => {
                fileStream.close();
                try {
                  // Try an atomic replace; if rename fails, fallback to copy
                  try {
                    await fs.rename(tempPath, outputPath);
                  } catch (err) {
                    await fs.copyFile(tempPath, outputPath);
                    await fs.unlink(tempPath);
                  }
                  sendProgress(`${fileName} installed successfully!`);
                  resolve({ ok: true, fileName });
                } catch (err) {
                  resolve({ ok: false, error: err.message });
                }
              });
              fileStream.on('error', (err) => {
                resolve({ ok: false, error: err.message });
              });
            }).on('error', (err) => {
              resolve({ ok: false, error: err.message });
            });
            downloadReq.setTimeout(15000, () => {
              downloadReq.destroy();
              resolve({ ok: false, error: 'Download timed out' });
            });

          } catch (err) {
            resolve({ ok: false, error: err.message });
          }
        });
      });

      versionsReq.on('error', (err) => {
        if (!timedOut) {
          resolve({ ok: false, error: err.message });
        }
      });

      versionsReq.setTimeout(8000, () => {
        timedOut = true;
        versionsReq.destroy();
        resolve({ ok: false, error: 'Versions request timed out' });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const findJava = async () => {
  const { exec } = require("child_process");
  return new Promise((resolve) => {
    exec("java -version", (error) => {
      if (!error) {
        resolve("java");
      } else {
        const commonPaths = [
          "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",
          "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
          "C:\\Program Files\\Java\\jre-1.8\\bin\\java.exe",
          "C:\\Program Files (x86)\\Java\\jre-1.8\\bin\\java.exe"
        ];

        for (const javaPath of commonPaths) {
          if (existsSync(javaPath)) {
            resolve(javaPath);
            return;
          }
        }
        resolve("java");
      }
    });
  });
};

const gotTheLock = app.requestSingleInstanceLock();

const handleSquirrelEvent = () => {
  if (process.platform !== 'win32') {
    return false;
  }

  const squirrelCommand = process.argv[1];
  const exeName = path.basename(process.execPath);
  const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const target = path.basename(process.execPath);

  const spawnUpdate = (args) => {
    let spawnedProcess;
    try {
      spawnedProcess = spawn(updateDotExe, args, { detached: true });
    } catch (error) {
      console.error('Error spawning Update.exe:', error);
    }
    return spawnedProcess;
  };

  switch (squirrelCommand) {
    case '--squirrel-install':
    case '--squirrel-updated':

      spawnUpdate(['--createShortcut', target]);
      setTimeout(app.quit, 1000);
      return true;
    case '--squirrel-uninstall':

      spawnUpdate(['--removeShortcut', target]);
      setTimeout(app.quit, 1000);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
  }

  return false;
};

if (handleSquirrelEvent()) {
  return;
}

if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow = null;
  let isGameLaunching = false;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("com.tiger.launcher");
  }

  app.whenReady().then(() => {
    mainWindow = createWindow();
    setupAutoUpdater(mainWindow);
    setupDiscordRPC();


  ipcMain.on("window:minimize", () => {
    mainWindow.minimize();
  });

  ipcMain.on("window:maximize", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on("window:close", () => {
    mainWindow.close();
  });

  ipcMain.handle("launcher:ms-auth", async () => {
    const result = await msAuth();
    if (result.mockUser) {
      await writeAuth(result.mockUser);
    }
    return result;
  });

  ipcMain.handle("launcher:get-auth", async () => {
    const auth = await readAuth();
    if (!auth) return null;
    try {
      return await refreshValidAuth(auth);
    } catch (error) {
      console.error("Failed to refresh auth during get-auth:", error.message);
      return null;
    }
  });

  ipcMain.handle("launcher:save-auth", async (_event, data) => {
    await writeAuth(data);
    return { ok: true };
  });

  ipcMain.handle("launcher:refresh-auth", async () => {
    try {
      const auth = await readAuth();
      if (!auth || !auth.refreshToken) {
        return { ok: false, message: "No saved refresh token available" };
      }

      const refreshedAuth = await refreshValidAuth(auth);
      return { ok: true, auth: refreshedAuth };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle("launcher:cancel-launch", async () => {
    if (minecraftProcess && !minecraftProcess.killed) {
      try {
        minecraftProcess.kill();
        minecraftProcess = null;
        isGameLaunching = false;
        return { ok: true, message: "Launch cancelled" };
      } catch (error) {
        return { ok: false, message: `Failed to cancel: ${error.message}` };
      }
    }
    isGameLaunching = false;
    return { ok: true, message: "Launch cancelled" };
  });

  ipcMain.handle("launcher:upload-skin", async (_event, skinData) => {
    try {
      const user = await readAuth();
      if (!user || !user.accessToken) {
        return { ok: false, error: 'Not authenticated' };
      }

      const result = await uploadSkinToMicrosoft(user.accessToken, skinData.imageData, skinData.variant);
      return result;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:sign-out", async () => {
    const authPath = path.join(app.getPath("userData"), AUTH_FILE);
    try {
      await fs.unlink(authPath);
    } catch (err) {
    }
    return { ok: true };
  });

  ipcMain.handle("launcher:uninstall", async () => {
    try {
      const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
      const target = path.basename(process.execPath);

      if (existsSync(updateDotExe)) {

        spawn(updateDotExe, ['--removeShortcut', target], { detached: true });

        setTimeout(() => {

          app.quit();
        }, 500);

        return { ok: true };
      } else {
        return { ok: false, message: "Uninstaller not found. Please uninstall from Windows Settings." };
      }
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });



  ipcMain.handle("launcher:get-alts", async () => {
    return await readAlts();
  });

  ipcMain.handle("launcher:save-alts", async (_event, data) => {
    await writeAlts(data);
    return { ok: true };
  });

  ipcMain.handle("launcher:switch-account", async (_event, targetAltUuid) => {
    try {
      // Kill the running game if it's playing
      if (minecraftProcess && !minecraftProcess.killed) {
        minecraftProcess.kill();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Load the alt account data
      const alts = await readAlts();
      const selectedAlt = alts.find(alt => alt.uuid === targetAltUuid);

      if (!selectedAlt) {
        return { ok: false, error: "Account not found" };
      }

      let updatedAlt = { ...selectedAlt };
      let refreshFailed = false;

      if (selectedAlt.refreshToken) {
        try {
          const refreshed = await refreshMicrosoftAccessToken(selectedAlt.refreshToken);
          const session = await getMinecraftSession(refreshed.accessToken, { checkOwnership: false });
          updatedAlt = {
            ...selectedAlt,
            accessToken: session.accessToken,
            uuid: session.profile.uuid,
            name: session.profile.name,
            refreshToken: refreshed.refreshToken
          };
        } catch (error) {
          refreshFailed = true;
        }
      }

      if (refreshFailed || !updatedAlt.accessToken) {
        try {
          const profile = await getMinecraftProfileFromAccessToken(updatedAlt.accessToken);
          updatedAlt = {
            ...updatedAlt,
            uuid: profile.uuid,
            name: profile.name
          };
        } catch (error) {
          return { ok: false, error: "Alt session expired. Please sign in again." };
        }
      }

      const updatedAlts = alts.map(alt => alt.uuid === selectedAlt.uuid ? updatedAlt : alt);
      await writeAlts(updatedAlts);

      // Update auth.json with the new account
      const authData = {
        accessToken: updatedAlt.accessToken,
        uuid: updatedAlt.uuid,
        name: updatedAlt.name,
        refreshToken: updatedAlt.refreshToken
      };
      await writeAuth(authData);

      // Update the main window's state
      if (mainWindow) {
        mainWindow.webContents.send('account-switched', {
          user: updatedAlt
        });
      }

      return { ok: true, user: updatedAlt };
    } catch (error) {
      console.error('Account switch error:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:get-servers", async () => {
    return await readServers();
  });

  ipcMain.handle("launcher:save-servers", async (_event, data) => {
    await writeServers(data);
    return { ok: true };
  });

  ipcMain.handle("launcher:get-settings", async () => {
    return await readSettings();
  });

  ipcMain.handle("launcher:check-updates", async () => {
    if (!app.isPackaged) {
      sendUpdateStatus(mainWindow, { status: "error", message: "Updates are only available in the packaged app" });
      return { ok: false, error: "Updates are only available in the packaged app" };
    }
    try {
      clearUpdateCheckTimeout();
      updateCheckTimeout = setTimeout(() => {
        console.warn("Update check timed out");
        sendUpdateStatus(mainWindow, { status: "error", message: "Update check timed out" });
      }, 15000);
      autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      clearUpdateCheckTimeout();
      sendUpdateStatus(mainWindow, { status: "error", message: error.message });
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:install-update", async () => {
    if (!app.isPackaged) {
      return { ok: false, error: "Updates are only available in the packaged app" };
    }
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:open-external", async (_event, url) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:save-settings", async (_event, data) => {
    await writeSettings(data);
    return { ok: true };
  });

  ipcMain.handle("launcher:get-screenshots", async (_event, gameVersion) => {
    try {
      const baseDir = gameVersion ? getLauncherMinecraftDir(gameVersion) : getLauncherMinecraftDir();
      const screenshotsDir = path.join(baseDir, "screenshots");

      if (!existsSync(screenshotsDir)) {
        return { ok: true, screenshots: [] };
      }

      const files = readdirSync(screenshotsDir)
        .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
        .map(file => {
          const filePath = path.join(screenshotsDir, file);
          const stats = statSync(filePath);


          let imageData = null;
          try {
            const buffer = require('fs').readFileSync(filePath);
            imageData = `data:image/png;base64,${buffer.toString('base64')}`;
          } catch (err) {
            console.error(`Failed to read screenshot: ${file}`, err);
          }

          return {
            name: file,
            path: filePath,
            imageData: imageData,
            size: stats.size,
            date: stats.mtime.getTime()
          };
        })
        .filter(screenshot => screenshot.imageData !== null)
        .sort((a, b) => b.date - a.date);

      return { ok: true, screenshots: files };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:delete-screenshot", async (_event, filePath) => {
    try {
      await fs.unlink(filePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:copy-screenshot", async (_event, filePath) => {
    try {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { ok: false, error: "Failed to read screenshot image" };
      }
      clipboard.writeImage(image);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:open-screenshots-folder", async (_event, gameVersion) => {
    try {
      const baseDir = gameVersion ? getLauncherMinecraftDir(gameVersion) : getLauncherMinecraftDir();
      const screenshotsDir = path.join(baseDir, "screenshots");
      await ensureDir(screenshotsDir);
      shell.openPath(screenshotsDir);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:get-version", async () => {
    return { ok: true, version: APP_VERSION };
  });

  ipcMain.handle("launcher:get-versions", async () => {
    const versions = await getMinecraftVersions();
    return { ok: true, versions };
  });

  ipcMain.handle("launcher:search-mods", async (event, query, gameVersion, sortBy) => {
    return await searchModrinthMods(query, gameVersion, sortBy);
  });

  ipcMain.handle("launcher:get-installed-mods", async (event, gameVersion) => {
    return await getInstalledMods(getLauncherMinecraftDir(gameVersion), gameVersion);
  });

  ipcMain.handle("launcher:download-mod", async (event, modId, gameVersion) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    return await downloadMod(modId, getLauncherMinecraftDir(gameVersion), mainWindow, gameVersion);
  });

  ipcMain.handle("launcher:import-mod-files", async (event, filePaths, gameVersion) => {
    return await importModFiles(filePaths, getLauncherMinecraftDir(gameVersion));
  });

  ipcMain.handle("launcher:import-mod-data", async (event, files, gameVersion) => {
    return await importModData(files, getLauncherMinecraftDir(gameVersion));
  });

  ipcMain.handle("launcher:toggle-mod", async (event, fileName, isDisabled, gameVersion) => {
    try {
      const modsDir = path.join(getLauncherMinecraftDir(gameVersion), "mods");
      const oldPath = path.join(modsDir, fileName);
      const newFileName = isDisabled ? fileName.replace('.disabled', '') : fileName + '.disabled';
      const newPath = path.join(modsDir, newFileName);

      await fs.rename(oldPath, newPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:delete-mod", async (event, fileName, gameVersion) => {
    try {
      const modsDir = path.join(getLauncherMinecraftDir(gameVersion), "mods");
      const filePath = path.join(modsDir, fileName);
      await fs.unlink(filePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:open-folder", async (event, gameVersion) => {
    try {
      const modsDir = path.join(getLauncherMinecraftDir(gameVersion), "mods");
      await ensureDir(modsDir);
      const result = await shell.openPath(modsDir);
      if (result) {
        throw new Error(result);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:update-mod", async (event, modId, fileName, gameVersion) => {
    return await updateSingleMod(modId, fileName, gameVersion);
  });

  ipcMain.handle("launcher:update-all-mods", async (event, gameVersion) => {
    try {
      const minecraftDir = getLauncherMinecraftDir(gameVersion);
      const modsResult = await getInstalledMods(minecraftDir, gameVersion);

      if (!modsResult.ok) {
        return { ok: false, error: modsResult.error };
      }

      const modsToUpdate = modsResult.mods.filter(mod => mod.hasUpdate && mod.modId);
      let updated = 0;
      let failed = 0;

      for (const mod of modsToUpdate) {
        const result = await updateSingleMod(mod.modId, mod.fileName, gameVersion);
        if (result && result.ok) {
          updated++;
        } else {
          failed++;
        }
      }

      return { ok: true, updated, failed, total: modsToUpdate.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("launcher:get-game-state", async () => {
    return { isRunning: minecraftProcess !== null };
  });

  ipcMain.handle("launcher:close-game", async () => {
    if (minecraftProcess && !minecraftProcess.killed) {
      try {
        minecraftProcess.kill();
        minecraftProcess = null;
        currentGameVersion = null;
        gameStartTime = null;
        if (minecraftTitleInterval) {
          clearInterval(minecraftTitleInterval);
          minecraftTitleInterval = null;
        }
        updateRPCIdle();
        return { ok: true, message: "Game closed successfully" };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    return { ok: false, message: "No game is running" };
  });

  ipcMain.handle("launcher:launch", async (_event, payload) => {
    if (minecraftProcess !== null) {
      return {
        ok: false,
        message: "Minecraft is already running!"
      };
    }

    if (isGameLaunching) {
      return {
        ok: false,
        message: "A game is already launching. Please wait..."
      };
    }

    isGameLaunching = true;

    const { profile } = payload;
    const mainWindow = BrowserWindow.getAllWindows()[0];

    const sendProgress = (message) => {
      if (mainWindow) {
        mainWindow.webContents.send("launch-progress", message);
      }
    };

    try {
      let launchUser = await readAuth();
      if (!launchUser) {
        throw new Error("Not authenticated. Please sign in again.");
      }

      try {
        launchUser = await refreshValidAuth(launchUser);
        if (mainWindow) {
          mainWindow.webContents.send("account-switched", { user: launchUser });
        }
      } catch (error) {
        throw new Error("Session expired. Please sign in again.");
      }

      const minecraftDir = getLauncherMinecraftDir(profile.version);
      await ensureDir(minecraftDir);

      sendProgress("Copying settings from Minecraft...");
      await copyMinecraftSettings(minecraftDir);

      const { versionJson, libraryPaths, clientJarPath } = await downloadGameFiles(
        profile.version,
        minecraftDir,
        sendProgress
      );

      sendProgress("Installing Fabric loader...");

      const fabricData = await downloadFabricLoader(
        profile.version,
        minecraftDir,
        sendProgress
      );

      sendProgress("Preparing launch...");

      const javaPath = await findJava();
      const settings = normalizeRamSettings(await readSettings());
      const maxRam = settings.ramAllocation;
      const minRam = settings.minRam;

      const separator = process.platform === "win32" ? ";" : ":";

      const replacedArtifacts = new Set((fabricData.artifactNames || []).map((name) => String(name).toLowerCase()));
      const filteredVanillaLibraries = libraryPaths.filter((libraryPath) => {
        const fileName = path.basename(libraryPath).toLowerCase();
        for (const artifactName of replacedArtifacts) {
          if (fileName.startsWith(`${artifactName}-`)) {
            return false;
          }
        }
        return true;
      });

      const allLibraries = [...new Set([...filteredVanillaLibraries, ...fabricData.libraryPaths, clientJarPath])];
      const classpath = allLibraries.join(separator);
      const launchArgs = [
        `-Xmx${maxRam}M`,
        `-Xms${minRam}M`,
        "-Dminecraft.launcher.brand=Tiger Client",
        `-Dminecraft.launcher.version=${APP_VERSION}`,
        "-Dminecraft.client.brand=Tiger Client",
        `-Djava.library.path=${path.join(minecraftDir, "natives")}`,
        "-cp",
        classpath,
        fabricData.mainClass,
        "--username", launchUser.name,
        "--uuid", launchUser.uuid,
        "--accessToken", launchUser.accessToken,
        "--userType", "msa",
        "--version", profile.version,
        "--versionType", "Tiger Client",
        "--gameDir", minecraftDir,
        "--assetsDir", path.join(minecraftDir, "assets"),
        "--assetIndex", versionJson.assetIndex.id
      ];

      if (profile.serverAddress) {
        const [host, port] = profile.serverAddress.split(":");
        launchArgs.push("--server", host);
        if (port) launchArgs.push("--port", port);
      }

      sendProgress(`Launching Minecraft ${profile.version}...`);
      console.log(`[LAUNCH] Java: ${javaPath}, Main: ${fabricData.mainClass}`);

      minecraftProcess = spawn(javaPath, launchArgs, {
        cwd: minecraftDir,
        stdio: "pipe"
      });

      if (!minecraftProcess.pid) throw new Error('Failed to spawn process');
      console.log(`[LAUNCH] PID: ${minecraftProcess.pid}`);


      if (minecraftProcess.stdout) {
        minecraftProcess.stdout.on('data', (data) => {
          const logMessage = data.toString().trim();
          if (logMessage) {
            const allWindows = BrowserWindow.getAllWindows();
            if (allWindows.length > 0) {
              allWindows[0].webContents.send('game-log', { message: logMessage, type: 'info' });
            }
          }
        });
      }


      if (minecraftProcess.stderr) {
        minecraftProcess.stderr.on('data', (data) => {
          const logMessage = data.toString().trim();
          if (logMessage) {
            const allWindows = BrowserWindow.getAllWindows();
            if (allWindows.length > 0) {

              const isError = logMessage.toLowerCase().includes('error') ||
                             logMessage.toLowerCase().includes('exception') ||
                             logMessage.toLowerCase().includes('fatal');
              allWindows[0].webContents.send('game-log', {
                message: logMessage,
                type: isError ? 'error' : 'warning'
              });
            }
          }
        });
      }

      minecraftProcess.on("error", (err) => {
        console.error(`[LAUNCH-ERR] ${err.message}`);
        sendProgress(`Launch error: ${err.message}`);
      });

      minecraftProcess.on("exit", (code, signal) => {
        console.log(`[LAUNCH] Exit code ${code}, signal ${signal}`);
        minecraftProcess = null;
        currentGameVersion = null;
        gameStartTime = null;
        if (minecraftTitleInterval) {
          clearInterval(minecraftTitleInterval);
          minecraftTitleInterval = null;
        }

        updateRPCIdle();

        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
          if (code !== 0) {
            allWindows[0].webContents.send('launch-progress', 'Minecraft has crashed');
            allWindows[0].webContents.send('game-log', {
              message: `Minecraft exited unexpectedly (code: ${code}${signal ? `, signal: ${signal}` : ''})`,
              type: 'error'
            });
          } else {
            allWindows[0].webContents.send('launch-progress', 'Minecraft closed');
          }
          allWindows[0].webContents.send('game-state-changed', false);
        }
      });

      startMinecraftTitleBranding(minecraftProcess.pid, profile.version);

      currentGameVersion = profile.version;
      gameStartTime = Date.now();
      updateRPCPlaying(profile.version);

      if (mainWindow) {
        mainWindow.webContents.send('game-state-changed', true);
      }

      return {
        ok: true,
        message: `Minecraft ${profile.version} launched successfully!`
      };
    } catch (error) {
      return {
        ok: false,
        message: "Launch failed: " + error.message
      };
    } finally {

      setTimeout(() => {
        isGameLaunching = false;
      }, 2000);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (minecraftProcess && !minecraftProcess.killed) {
    try {
      minecraftProcess.kill();
      console.log('Minecraft process terminated');
    } catch (error) {
      console.error('Error killing Minecraft process:', error);
    }
  }

  if (rpcClient) {
    try {
      rpcClient.destroy();
      console.log('Discord RPC disconnected');
    } catch (error) {
      console.error('Error disconnecting Discord RPC:', error);
    }
  }
});
