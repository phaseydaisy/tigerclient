const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  msAuth: () => ipcRenderer.invoke("launcher:ms-auth"),
  getAuth: () => ipcRenderer.invoke("launcher:get-auth"),
  saveAuth: (data) => ipcRenderer.invoke("launcher:save-auth", data),
  refreshAuth: () => ipcRenderer.invoke("launcher:refresh-auth"),
  cancelLaunch: () => ipcRenderer.invoke("launcher:cancel-launch"),
  signOut: () => ipcRenderer.invoke("launcher:sign-out"),
  getAlts: () => ipcRenderer.invoke("launcher:get-alts"),
  saveAlts: (data) => ipcRenderer.invoke("launcher:save-alts", data),
  switchAccount: (altUuid) => ipcRenderer.invoke("launcher:switch-account", altUuid),
  loadServers: () => ipcRenderer.invoke("launcher:get-servers"),
  saveServers: (data) => ipcRenderer.invoke("launcher:save-servers", data),
  getVersions: () => ipcRenderer.invoke("launcher:get-versions"),
  launch: (payload) => ipcRenderer.invoke("launcher:launch", payload),
  getGameState: () => ipcRenderer.invoke("launcher:get-game-state"),
  closeGame: () => ipcRenderer.invoke("launcher:close-game"),
  onLaunchProgress: (callback) => {
    ipcRenderer.on("launch-progress", (_event, message) => callback(message));
  },
  onGameStateChanged: (callback) => {
    ipcRenderer.on("game-state-changed", (_event, isRunning) => callback(isRunning));
  },
  onDeviceCode: (callback) => {
    ipcRenderer.on("device-code", (_event, data) => callback(data));
  },
  onAuthStatus: (callback) => {
    ipcRenderer.on("auth-status", (_event, message) => callback(message));
  },
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  uninstallApp: () => ipcRenderer.invoke("launcher:uninstall"),
  searchMods: (query, gameVersion, sortBy) => ipcRenderer.invoke("launcher:search-mods", query, gameVersion, sortBy),
  getInstalledMods: (gameVersion) => ipcRenderer.invoke("launcher:get-installed-mods", gameVersion),
  downloadMod: (modId, gameVersion) => ipcRenderer.invoke("launcher:download-mod", modId, gameVersion),
  toggleMod: (fileName, isDisabled, gameVersion) => ipcRenderer.invoke("launcher:toggle-mod", fileName, isDisabled, gameVersion),
  deleteMod: (fileName, gameVersion) => ipcRenderer.invoke("launcher:delete-mod", fileName, gameVersion),
  updateMod: (modId, fileName, gameVersion) => ipcRenderer.invoke("launcher:update-mod", modId, fileName, gameVersion),
  updateAllMods: (gameVersion) => ipcRenderer.invoke("launcher:update-all-mods", gameVersion),
  importModFiles: (filePaths, gameVersion) => ipcRenderer.invoke("launcher:import-mod-files", filePaths, gameVersion),
  importModData: (files, gameVersion) => ipcRenderer.invoke("launcher:import-mod-data", files, gameVersion),
  openFolder: (gameVersion) => ipcRenderer.invoke("launcher:open-folder", gameVersion),
  onModDownloadProgress: (callback) => {
    ipcRenderer.on("mod-download-progress", (_event, data) => callback(data));
  },
  onGameLog: (callback) => {
    ipcRenderer.on("game-log", (_event, data) => callback(data));
  },
  uploadSkin: (skinData) => ipcRenderer.invoke("launcher:upload-skin", skinData),
  getSettings: () => ipcRenderer.invoke("launcher:get-settings"),
  saveSettings: (data) => ipcRenderer.invoke("launcher:save-settings", data),
  getScreenshots: (gameVersion) => ipcRenderer.invoke("launcher:get-screenshots", gameVersion),
  deleteScreenshot: (filePath) => ipcRenderer.invoke("launcher:delete-screenshot", filePath),
  copyScreenshot: (filePath) => ipcRenderer.invoke("launcher:copy-screenshot", filePath),
  openScreenshotsFolder: (gameVersion) => ipcRenderer.invoke("launcher:open-screenshots-folder", gameVersion),
  getVersion: () => ipcRenderer.invoke("launcher:get-version"),
  checkUpdates: () => ipcRenderer.invoke("launcher:check-updates"),
  installUpdate: () => ipcRenderer.invoke("launcher:install-update"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
  },
  onAccountSwitched: (callback) => {
    ipcRenderer.on("account-switched", (_event, data) => callback(data));
  },
  openExternal: (url) => ipcRenderer.invoke("launcher:open-external", url)
});
