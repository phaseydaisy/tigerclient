const state = {
  user: null,
  versions: [],
  alts: [],
  activeAltId: null,
  currentView: "home",
  skins: [],
  selectedModel: "classic",
  equippedSkin: null,
  isLaunching: false,
  launchCancelable: false,
  updateStatus: "idle",
};

const elements = {};
let modsRequestSeq = 0;

const qs = (selector) => document.querySelector(selector);

const getSelectedMinecraftVersion = () => {
  return elements.profileVersion?.value || "1.20.1";
};

const saveLastSelectedVersion = (version) => {
  try {
    localStorage.setItem("tigerLastMinecraftVersion", version);
  } catch (error) {
    console.warn("Could not save last version", error);
  }
};

const getLastSelectedVersion = () => {
  try {
    return localStorage.getItem("tigerLastMinecraftVersion") || null;
  } catch (error) {
    return null;
  }
};

const normalizeUuid = (uuid) => String(uuid || "").replace(/-/g, "").trim();

const getAvatarCandidates = (uuid, size = 64) => {
  const normalizedUuid = normalizeUuid(uuid);
  if (!normalizedUuid) return [];
  const encodedUuid = encodeURIComponent(normalizedUuid);
  return [
    `https://crafatar.com/avatars/${encodedUuid}?size=${size}&overlay`,
    `https://mc-heads.net/avatar/${encodedUuid}/${size}`,
    `https://minotar.net/helm/${encodedUuid}/${size}.png`
  ];
};

const getNameInitials = (name) => {
  const parts = String(name || "Player").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const buildAvatarPlaceholder = (name, size = 64) => {
  const initials = getNameInitials(name);
  const fontSize = Math.max(12, Math.floor(size * 0.35));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f1a351"/><stop offset="100%" stop-color="#c87422"/></linearGradient></defs><rect width="${size}" height="${size}" rx="10" fill="#1b1008"/><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="9" fill="url(#g)" opacity="0.22"/><text x="50%" y="50%" fill="#f7efe8" font-family="Inter,Segoe UI,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const setAvatarImage = (imgElement, uuid, name, size = 64) => {
  if (!imgElement) return;
  const queue = [...getAvatarCandidates(uuid, size), buildAvatarPlaceholder(name, size)];
  if (queue.length === 0) {
    imgElement.src = buildAvatarPlaceholder(name, size);
    return;
  }

  const loadNext = (index) => {
    if (index >= queue.length) return;
    imgElement.onerror = () => loadNext(index + 1);
    imgElement.src = queue[index];
  };

  loadNext(0);
};

const setStatus = (message, tone = "info") => {
  if (elements.status) {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
    addFadeIn(elements.status);
  }
};

const setUpdateStatus = (status, message) => {
  state.updateStatus = status;
  if (!elements.updateBtn) return;
  if (status === "downloaded") {
    elements.updateBtn.textContent = message || "Install Update";
    elements.updateBtn.classList.remove("hidden");
    elements.updateBtn.disabled = false;
    pulseElement(elements.updateBtn);
    addAnimation(elements.updateBtn, "slideInUp", 0.4);
  } else if (status === "downloading") {
    elements.updateBtn.textContent = message || "Downloading update...";
    elements.updateBtn.classList.remove("hidden");
    elements.updateBtn.disabled = true;
    addAnimation(elements.updateBtn, "slideInUp", 0.4);
  } else if (status === "checking") {
    elements.updateBtn.textContent = message || "Checking for updates...";
    elements.updateBtn.classList.remove("hidden");
    elements.updateBtn.disabled = true;
    addAnimation(elements.updateBtn, "slideInUp", 0.4);
  } else {
    elements.updateBtn.classList.add("hidden");
  }
  if (elements.checkUpdatesBtn) {
    elements.checkUpdatesBtn.textContent = status === "checking" ? "Checking..." : "Check";
    elements.checkUpdatesBtn.disabled = status === "checking";
  }
};

const showToast = (message, type = "success") => {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), slideOut 0.4s ease-out 1.6s";
  }, 10);

  setTimeout(() => {
    toast.remove();
  }, 2000);
};

/* Animation Helper Functions */
const addAnimation = (element, animationName, duration = 0.5) => {
  if (!element) return;
  element.style.animation = `${animationName} ${duration}s cubic-bezier(0.34, 1.56, 0.64, 1)`;
  element.addEventListener("animationend", () => {
    element.style.animation = "";
  }, { once: true });
};

const addFadeIn = (element) => {
  if (!element) return;
  element.style.animation = "fadeInScale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
  element.addEventListener("animationend", () => {
    element.style.animation = "";
  }, { once: true });
};

const addSlideUp = (element) => {
  if (!element) return;
  element.style.animation = "slideInUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
  element.addEventListener("animationend", () => {
    element.style.animation = "";
  }, { once: true });
};

const pulseElement = (element) => {
  if (!element) return;
  element.style.animation = "pulse-glow 1.5s ease-in-out";
};

const skinPreviewCache = new Map();

const loadSkinImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Failed to load skin image"));
  img.src = src;
});

const waitForFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const renderSkin3dPreview = async (imageDataUrl, model, size, mode = "full") => {
  if (!window.skinview3d) {
    throw new Error("skinview3d not available");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  let viewer;
  if (mode === "head" && window.skinview3d.HeadViewer) {
    viewer = new window.skinview3d.HeadViewer({
      canvas,
      width: size,
      height: size,
      skin: imageDataUrl
    });
  } else {
    viewer = new window.skinview3d.SkinViewer({
      canvas,
      width: size,
      height: size,
      skin: imageDataUrl
    });
    if (viewer.controls) {
      viewer.controls.enableRotate = false;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
    }
    if (typeof viewer.zoom === "number") {
      viewer.zoom = 0.9;
    }
    if (viewer.fov) {
      viewer.fov = 40;
    }
  }

  if (viewer.loadSkin) {
    await viewer.loadSkin(imageDataUrl, { model: model });
  }

  await waitForFrame();

  if (viewer.render) {
    viewer.render();
  }

  const url = canvas.toDataURL("image/png");
  if (viewer.dispose) {
    viewer.dispose();
  }
  return url;
};

const renderSkinPreview = async (imageDataUrl, model, size, mode = "full") => {
  const img = await loadSkinImage(imageDataUrl);
  const isSlim = model === "slim";
  const hasSecondLayer = img.height >= 64;
  const armWidth = isSlim ? 3 : 4;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  if (mode === "head") {
    const scale = Math.max(1, Math.floor(size / 8));
    canvas.width = 8 * scale;
    canvas.height = 8 * scale;
    const drawPart = (sx, sy, sw, sh, dx, dy) => {
      ctx.drawImage(img, sx, sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale);
    };
    drawPart(8, 8, 8, 8, 0, 0);
    if (hasSecondLayer) {
      drawPart(40, 8, 8, 8, 0, 0);
    }
    return canvas.toDataURL("image/png");
  }

  const scale = Math.max(1, Math.floor(size / 16));
  canvas.width = 16 * scale;
  canvas.height = 32 * scale;
  const drawPart = (sx, sy, sw, sh, dx, dy) => {
    ctx.drawImage(img, sx, sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale);
  };

  const offsetX = Math.floor((16 - (8 + armWidth * 2)) / 2);
  const rightArmX = offsetX;
  const bodyX = rightArmX + armWidth;
  const leftArmX = bodyX + 8;
  const headX = Math.floor((16 - 8) / 2);

  drawPart(8, 8, 8, 8, headX, 0);
  if (hasSecondLayer) drawPart(40, 8, 8, 8, headX, 0);

  drawPart(20, 20, 8, 12, bodyX, 8);
  if (hasSecondLayer) drawPart(20, 36, 8, 12, bodyX, 8);

  drawPart(44, 20, armWidth, 12, rightArmX, 8);
  if (hasSecondLayer) drawPart(44, 36, armWidth, 12, rightArmX, 8);

  if (hasSecondLayer) {
    drawPart(36, 52, armWidth, 12, leftArmX, 8);
    drawPart(52, 52, armWidth, 12, leftArmX, 8);
  } else {
    drawPart(44, 20, armWidth, 12, leftArmX, 8);
  }

  drawPart(4, 20, 4, 12, bodyX, 20);
  if (hasSecondLayer) drawPart(4, 36, 4, 12, bodyX, 20);

  if (hasSecondLayer) {
    drawPart(20, 52, 4, 12, bodyX + 4, 20);
    drawPart(4, 52, 4, 12, bodyX + 4, 20);
  } else {
    drawPart(4, 20, 4, 12, bodyX + 4, 20);
  }

  return canvas.toDataURL("image/png");
};

const getSkinPreviewUrl = async (skin, size, mode) => {
  const cacheKey = `${skin.id}-${skin.model}-${mode}-${size}`;
  if (skinPreviewCache.has(cacheKey)) return skinPreviewCache.get(cacheKey);
  try {
    const url = await renderSkin3dPreview(skin.imageData, skin.model, size, mode);
    skinPreviewCache.set(cacheKey, url);
    return url;
  } catch (error) {
    try {
      const url = await renderSkinPreview(skin.imageData, skin.model, size, mode);
      skinPreviewCache.set(cacheKey, url);
      return url;
    } catch (fallbackError) {
      return skin.imageData;
    }
  }
};

const getCurrentSkinForAvatar = () => {
  const equipped = state.skins.find((skin) => skin.id === state.equippedSkin);
  return equipped || state.skins[0] || null;
};

const updateUserAvatarFromSkins = async () => {
  if (!elements.userAvatar) return;
  const skin = getCurrentSkinForAvatar();
  if (!skin) return;
  const avatarUrl = await getSkinPreviewUrl(skin, 256, "head");
  elements.userAvatar.src = avatarUrl;
  elements.userAvatar.style.display = "block";
};

const formatRamValue = (valueMb) => {
  const numericValue = Number(valueMb) || 0;
  if (numericValue >= 1024) {
    const gb = numericValue / 1024;
    const rounded = Number.isInteger(gb) ? gb.toString() : gb.toFixed(1);
    return `${rounded} GB`;
  }
  return `${numericValue} MB`;
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const applyRamSettingsToUI = (settings) => {
  const ramSlider = document.getElementById("ram-slider");
  const ramValue = document.getElementById("ram-value");
  const autoRamToggle = document.getElementById("auto-ram-toggle");
  const ramMinLabel = document.getElementById("ram-min-label");
  const ramMaxLabel = document.getElementById("ram-max-label");
  const ramSystemTotal = document.getElementById("ram-system-total");
  const presetButtons = Array.from(document.querySelectorAll(".ram-preset"));

  // Start on boot toggle
  const startOnBootToggle = document.getElementById("start-on-boot-toggle");

  const sliderMin = ramSlider ? parseInt(ramSlider.min, 10) || 1024 : 1024;
  const sliderStep = ramSlider ? parseInt(ramSlider.step, 10) || 512 : 512;
  const dynamicMax = Number(settings.maxSelectableRam) || (ramSlider ? parseInt(ramSlider.max, 10) : 16384) || 16384;
  const sliderMax = Math.max(sliderMin, Math.floor(dynamicMax / sliderStep) * sliderStep);
  const isAuto = !!settings.autoRam;
  const ramAllocation = clampNumber(Number(settings.ramAllocation) || 2048, sliderMin, sliderMax);

  if (autoRamToggle) {
    autoRamToggle.checked = isAuto;
  }

  if (startOnBootToggle) {
    startOnBootToggle.checked = !!settings.startOnBoot;
  }

  if (ramSlider && ramValue) {
    ramSlider.max = String(sliderMax);
    ramSlider.value = String(ramAllocation);
    ramValue.textContent = isAuto
      ? `${formatRamValue(ramAllocation)} (Auto)`
      : formatRamValue(ramAllocation);
    ramSlider.disabled = isAuto;
    ramSlider.classList.toggle("disabled", isAuto);
  }

  if (ramMinLabel) {
    ramMinLabel.textContent = formatRamValue(sliderMin);
  }

  if (ramMaxLabel) {
    ramMaxLabel.textContent = formatRamValue(sliderMax);
  }

  if (ramSystemTotal) {
    const totalMB = Number(settings.totalMB) || 0;
    ramSystemTotal.textContent = totalMB > 0
      ? `System memory: ${formatRamValue(totalMB)}`
      : "System memory: --";
  }

  presetButtons.forEach((button) => {
    const presetValue = parseInt(button.dataset.ram, 10);
    const isValidPreset = Number.isFinite(presetValue) && presetValue >= sliderMin && presetValue <= sliderMax;
    button.disabled = isAuto || !isValidPreset;
    button.classList.toggle("active", !isAuto && isValidPreset && presetValue === ramAllocation);
    if (isValidPreset) {
      button.title = `Set RAM to ${formatRamValue(presetValue)}`;
    } else {
      button.title = "Preset not available on this system";
    }
  });
};

const openScreenshotModal = (screenshot) => {
  const modal = document.getElementById("screenshot-modal");
  const image = document.getElementById("screenshot-modal-image");
  const title = document.getElementById("screenshot-modal-title");
  if (!modal || !image) return;
  image.src = screenshot.imageData || "";
  if (title) {
    title.textContent = screenshot.name || "Screenshot";
  }
  modal.classList.remove("hidden");
};

const closeScreenshotModal = () => {
  const modal = document.getElementById("screenshot-modal");
  const image = document.getElementById("screenshot-modal-image");
  if (!modal || !image) return;
  modal.classList.add("hidden");
  image.src = "";
};

const setupScreenshotModal = () => {
  const modal = document.getElementById("screenshot-modal");
  const closeBtn = document.getElementById("screenshot-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeScreenshotModal);
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeScreenshotModal();
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeScreenshotModal();
    }
  });

  // Account switcher hotkey: Alt+Q (for in-game use)
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === 'q' && state.isLaunching) {
      e.preventDefault();
      showAccountSwitcher();
    }
  });
};

const loadScreenshots = async () => {
  const grid = document.getElementById("screenshots-grid");
  if (!grid) return;

  try {
    const currentVersion = getSelectedMinecraftVersion();
    const result = await window.launcher.getScreenshots(currentVersion);

    if (!result.ok) {
      grid.innerHTML = '<div class="empty">Error loading screenshots</div>';
      addLog(`Failed to load screenshots: ${result.error}`, "error");
      return;
    }

    if (result.screenshots.length === 0) {
      grid.innerHTML = '<div class="empty">No screenshots found. Take some screenshots in-game with F2!</div>';
      return;
    }

    grid.innerHTML = '';

    result.screenshots.forEach(screenshot => {
      const card = document.createElement('div');
      card.className = 'screenshot-card';

      const date = new Date(screenshot.date);
      const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const sizeMB = (screenshot.size / (1024 * 1024)).toFixed(2);

      card.innerHTML = `
        <img src="${screenshot.imageData}" alt="${screenshot.name}" loading="lazy" />
        <div class="screenshot-info">
          <div class="screenshot-name" title="${screenshot.name}">${screenshot.name}</div>
          <div class="screenshot-meta">${formattedDate} - ${sizeMB} MB</div>
        </div>
        <div class="screenshot-actions">
          <button class="screenshot-copy" data-path="${screenshot.path}" title="Copy screenshot" aria-label="Copy screenshot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <path d="M6 15H5C3.9 15 3 14.1 3 13V5C3 3.9 3.9 3 5 3H13C14.1 3 15 3.9 15 5V6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="screenshot-delete" data-path="${screenshot.path}" title="Delete screenshot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M9 7V5H15V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M7 7L8 19H16L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `;

      card.addEventListener("click", () => {
        openScreenshotModal(screenshot);
      });

      grid.appendChild(card);
    });


    document.querySelectorAll('.screenshot-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const result = await window.launcher.deleteScreenshot(btn.dataset.path);
          if (result.ok) {
            addLog('Screenshot deleted', 'success');
            loadScreenshots();
          } else {
            addLog(`Failed to delete: ${result.error}`, 'error');
          }
        } catch (error) {
          addLog(`Error deleting screenshot: ${error.message}`, 'error');
        }
      });
    });

    document.querySelectorAll('.screenshot-copy').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const copyResult = await window.launcher.copyScreenshot(btn.dataset.path);
          if (copyResult.ok) {
            showToast('Copied screenshot to clipboard', 'success');
            addLog('Copied screenshot to clipboard', 'success');
          } else {
            addLog(`Failed to copy screenshot: ${copyResult.error}`, 'error');
          }
        } catch (error) {
          addLog(`Error copying screenshot: ${error.message}`, 'error');
        }
      });
    });

    addLog(`Loaded ${result.screenshots.length} screenshot(s)`, 'success');
  } catch (error) {
    grid.innerHTML = '<div class="empty">Error loading screenshots</div>';
    addLog(`Error loading screenshots: ${error.message}`, 'error');
  }
};

const switchView = (viewName) => {
  state.currentView = viewName;

  if (viewName === "home") {
    elements.homeView.classList.remove("hidden");
    if (elements.modsView) elements.modsView.classList.add("hidden");
    if (elements.skinEditorView) elements.skinEditorView.classList.add("hidden");
    if (elements.logsView) elements.logsView.classList.add("hidden");
    if (elements.screenshotsView) elements.screenshotsView.classList.add("hidden");
    elements.homeBtn.classList.add("active");
    if (elements.modsBtn) elements.modsBtn.classList.remove("active");
    if (elements.skinEditorBtn) elements.skinEditorBtn.classList.remove("active");
    if (elements.logsBtn) elements.logsBtn.classList.remove("active");
    if (elements.screenshotsBtn) elements.screenshotsBtn.classList.remove("active");
  } else if (viewName === "mods") {
    elements.homeView.classList.add("hidden");
    if (elements.modsView) elements.modsView.classList.remove("hidden");
    if (elements.skinEditorView) elements.skinEditorView.classList.add("hidden");
    if (elements.logsView) elements.logsView.classList.add("hidden");
    if (elements.screenshotsView) elements.screenshotsView.classList.add("hidden");
    elements.homeBtn.classList.remove("active");
    if (elements.modsBtn) elements.modsBtn.classList.add("active");
    if (elements.skinEditorBtn) elements.skinEditorBtn.classList.remove("active");
    if (elements.logsBtn) elements.logsBtn.classList.remove("active");
    if (elements.screenshotsBtn) elements.screenshotsBtn.classList.remove("active");
  } else if (viewName === "skin-editor") {
    elements.homeView.classList.add("hidden");
    if (elements.modsView) elements.modsView.classList.add("hidden");
    if (elements.skinEditorView) elements.skinEditorView.classList.remove("hidden");
    if (elements.logsView) elements.logsView.classList.add("hidden");
    if (elements.screenshotsView) elements.screenshotsView.classList.add("hidden");
    elements.homeBtn.classList.remove("active");
    if (elements.modsBtn) elements.modsBtn.classList.remove("active");
    if (elements.skinEditorBtn) elements.skinEditorBtn.classList.add("active");
    if (elements.logsBtn) elements.logsBtn.classList.remove("active");
    if (elements.screenshotsBtn) elements.screenshotsBtn.classList.remove("active");
  } else if (viewName === "logs") {
    elements.homeView.classList.add("hidden");
    if (elements.modsView) elements.modsView.classList.add("hidden");
    if (elements.skinEditorView) elements.skinEditorView.classList.add("hidden");
    if (elements.logsView) elements.logsView.classList.remove("hidden");
    if (elements.screenshotsView) elements.screenshotsView.classList.add("hidden");
    elements.homeBtn.classList.remove("active");
    if (elements.modsBtn) elements.modsBtn.classList.remove("active");
    if (elements.skinEditorBtn) elements.skinEditorBtn.classList.remove("active");
    if (elements.logsBtn) elements.logsBtn.classList.add("active");
    if (elements.screenshotsBtn) elements.screenshotsBtn.classList.remove("active");
  } else if (viewName === "screenshots") {
    elements.homeView.classList.add("hidden");
    if (elements.modsView) elements.modsView.classList.add("hidden");
    if (elements.skinEditorView) elements.skinEditorView.classList.add("hidden");
    if (elements.logsView) elements.logsView.classList.add("hidden");
    if (elements.screenshotsView) elements.screenshotsView.classList.remove("hidden");
    elements.homeBtn.classList.remove("active");
    if (elements.modsBtn) elements.modsBtn.classList.remove("active");
    if (elements.skinEditorBtn) elements.skinEditorBtn.classList.remove("active");
    if (elements.logsBtn) elements.logsBtn.classList.remove("active");
    if (elements.screenshotsBtn) elements.screenshotsBtn.classList.add("active");
  }
};

const showApp = () => {
  elements.loginScreen.classList.add("hidden");
  elements.mainApp.classList.remove("hidden");
};

const populateVersions = async () => {
  const result = await window.launcher.getVersions();
  if (result.ok && result.versions.length > 0) {
    state.versions = result.versions;
    elements.profileVersion.innerHTML = result.versions
      .map(v => `<option value="${v.id}">${v.id}</option>`)
      .join("");
    
    const lastVersion = getLastSelectedVersion();
    if (lastVersion && result.versions.some(v => v.id === lastVersion)) {
      elements.profileVersion.value = lastVersion;
    } else if (result.versions.length > 0) {
      elements.profileVersion.value = result.versions[0].id;
      saveLastSelectedVersion(result.versions[0].id);
    }
  }
};

const handleMsLogin = async () => {
  setStatus("Opening Microsoft sign-in...", "info");
  elements.msLogin.disabled = true;

  try {
    console.log("handleMsLogin: Starting Microsoft auth");
    const result = await window.launcher.msAuth();
    
    console.log("handleMsLogin: Auth result received:", result);

    if (result && result.ok && result.mockUser) {
      console.log("handleMsLogin: Auth succeeded, user:", result.mockUser.name);
      elements.msLogin.disabled = false;

      state.user = result.mockUser;
      updateUserDisplay();
      showApp();

      try {
        await window.launcher.saveAuth(result.mockUser);
        persistAuthInStorage(result.mockUser);
      } catch (writeError) {
        console.warn("handleMsLogin: Failed to save auth after login", writeError);
      }

      const existingAlt = state.alts.find(alt => alt.uuid === result.mockUser.uuid);
      if (!existingAlt) {
        state.alts.push(result.mockUser);
      } else {
        Object.assign(existingAlt, result.mockUser);
      }

      try {
        await window.launcher.saveAlts(state.alts);
      } catch (altsError) {
        console.warn("handleMsLogin: Failed to save alts", altsError);
      }

      try {
        await populateVersions();
      } catch (versionError) {
        console.warn("handleMsLogin: Failed to load versions after login", versionError);
      }

      setStatus("Signed in successfully.", "ok");
      showToast(`Welcome, ${result.mockUser.name}!`, "success");
      addLog(`Signed in as ${result.mockUser.name}`, "success");
    } else {
      console.warn("handleMsLogin: Auth failed", result?.message || "No message");
      elements.msLogin.disabled = false;
      setStatus(result?.message || "Sign-in failed.", "warn");
      showToast(result?.message || "Sign-in failed", "error");
      addLog(result?.message || "Sign-in failed", "error");
    }
  } catch (error) {
    console.error("handleMsLogin: Error occurred", error);
    elements.msLogin.disabled = false;
    setStatus("Authentication cancelled or failed.", "warn");
    if (error.message !== 'Authentication window closed') {
      showToast(`Error: ${error.message}`, "error");
      addLog(`Auth error: ${error.message}`, "error");
    }
  }
};

const updateUserDisplay = () => {
  if (state.user) {
    elements.userName.textContent = state.user.name;
    const skin = getCurrentSkinForAvatar();
    if (skin) {
      updateUserAvatarFromSkins();
    } else {
      setAvatarImage(elements.userAvatar, state.user.uuid, state.user.name, 256);
      elements.userAvatar.style.display = "block";
    }
  }
};

const toggleUserDropdown = () => {
  const dropdown = elements.userDropdown;
  const isHidden = dropdown.classList.contains("hidden");

  if (isHidden) {
    dropdown.classList.remove("hidden");
    elements.userInfoBtn.classList.add("open");
  } else {
    dropdown.classList.add("hidden");
    elements.userInfoBtn.classList.remove("open");
  }
};

const handleSignOut = async () => {
  if (!confirm('Are you sure you want to sign out?')) {
    return;
  }

  await window.launcher.signOut();
  clearAuthStorage();
  state.user = null;
  elements.mainApp.classList.add("hidden");
  elements.loginScreen.classList.remove("hidden");
  elements.userDropdown.classList.add("hidden");
  elements.userInfoBtn.classList.remove("open");
  setStatus("Signed out successfully.", "ok");
};

const handleCopyCode = () => {
  const code = elements.deviceCode.textContent;
  navigator.clipboard.writeText(code).then(() => {
    elements.copyCodeBtn.classList.add("copied");
    elements.copyCodeBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M16.6667 5L7.50004 14.1667L3.33337 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      elements.copyCodeBtn.classList.remove("copied");
      elements.copyCodeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M13.3333 10.75V14.25C13.3333 15.2165 12.5498 16 11.5833 16H5.75C4.78349 16 4 15.2165 4 14.25V8.41667C4 7.45016 4.78349 6.66667 5.75 6.66667H9.25M13.3333 10.75H15.25C16.2165 10.75 17 9.9665 17 9V5.75C17 4.7835 16.2165 4 15.25 4H11.5833C10.6168 4 9.83333 4.7835 9.83333 5.75V6.66667M13.3333 10.75H11.5833C10.6168 10.75 9.83333 9.9665 9.83333 9V6.66667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Copy
      `;
    }, 2000);
  });
};

const handleCancelAuth = () => {
  elements.deviceCodeModal.classList.add("hidden");
  elements.msLogin.disabled = false;
  setStatus("Authentication cancelled.", "warn");
};

const showAltsModal = () => {
  elements.altsModal.classList.remove("hidden");
  buildAltsList();
};

const hideAltsModal = () => {
  elements.altsModal.classList.add("hidden");
};

const showSettingsModal = async () => {
  if (elements.userDropdown) {
    elements.userDropdown.classList.add("hidden");
  }

  if (elements.settingsModal) {
    elements.settingsModal.classList.remove("hidden");
  }


  try {
    const settings = await window.launcher.getSettings();
    applyRamSettingsToUI(settings);
    // Set start on boot toggle
    const startOnBootToggle = document.getElementById("start-on-boot-toggle");
    if (startOnBootToggle) {
      startOnBootToggle.checked = !!settings.startOnBoot;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }


  try {
    const versionResult = await window.launcher.getVersion();
    const appVersionElement = document.getElementById('app-version');

    if (appVersionElement && versionResult.ok) {
      appVersionElement.textContent = versionResult.version;
    }
  } catch (error) {
    console.error('Failed to load version:', error);
  }
};

const hideSettingsModal = () => {
  if (elements.settingsModal) {
    elements.settingsModal.classList.add("hidden");
  }
};

const handleUninstall = async () => {
  const confirmed = confirm(
    "Are you sure you want to uninstall Tiger Launcher?\n\n" +
    "This will remove the application from your system.\n" +
    "Your skins and settings will be deleted."
  );

  if (!confirmed) return;

  try {
    const result = await window.launcher.uninstallApp();
    if (result.ok) {
      alert("Tiger Launcher will now uninstall. Thank you for using our launcher!");
    } else {
      alert("Uninstall failed: " + result.message);
    }
  } catch (error) {
    alert("Uninstall error: " + error.message);
  }
};

const buildAltsList = () => {
  elements.altsList.innerHTML = "";

  if (state.alts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "alts-empty";
    empty.textContent = "No alts added yet. Click 'Add Alt' to sign in with another account.";
    elements.altsList.appendChild(empty);
    return;
  }

  state.alts.forEach((alt) => {
    const altItem = document.createElement("div");
    altItem.className = "alt-item";
    if (alt.uuid === state.user?.uuid) {
      altItem.classList.add("active");
    }

    altItem.innerHTML = `
      <img class="alt-avatar" src="" alt="${alt.name} avatar" />
      <div class="alt-info">
        <div class="alt-name">${alt.name}</div>
        <div class="alt-status">${alt.uuid === state.user?.uuid ? "Active" : "Click to switch"}</div>
      </div>
      <button class="alt-remove" data-uuid="${alt.uuid}">Remove</button>
    `;

    altItem.addEventListener("click", (e) => {
      if (!e.target.classList.contains("alt-remove")) {
        switchToAlt(alt);
      }
    });

    const removeBtn = altItem.querySelector(".alt-remove");
    const avatarImg = altItem.querySelector(".alt-avatar");
    setAvatarImage(avatarImg, alt.uuid, alt.name, 64);

    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAlt(alt.uuid);
    });

    elements.altsList.appendChild(altItem);
    addFadeIn(altItem);
  });
};

const switchToAlt = async (alt) => {
  try {
    const result = await window.launcher.switchAccount(alt.uuid);
    if (!result.ok) {
      setStatus(`Failed to switch: ${result.error}`, "warn");
      showToast(`Could not switch account: ${result.error}`, "error");
      return;
    }

    state.user = result.user;
    updateUserDisplay();
    hideAltsModal();
    elements.userDropdown.classList.add("hidden");
    elements.userInfoBtn.classList.remove("open");
    setStatus(`Switched to ${result.user.name}`, "ok");
  } catch (error) {
    setStatus(`Switch failed: ${error.message}`, "warn");
    showToast(`Switch failed: ${error.message}`, "error");
  }
};

const showAccountSwitcher = () => {
  const modal = document.getElementById("account-switcher-modal");
  if (modal) {
    modal.classList.remove("hidden");
    buildAccountSwitcherList();
  }
};

const hideAccountSwitcher = () => {
  const modal = document.getElementById("account-switcher-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
};

const buildAccountSwitcherList = () => {
  const list = document.getElementById("account-switcher-list");
  if (!list) return;

  list.innerHTML = "";

  if (!state.alts || state.alts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "alts-empty";
    empty.textContent = "No accounts available to switch to.";
    list.appendChild(empty);
    return;
  }

  state.alts.forEach((alt) => {
    const item = document.createElement("div");
    item.className = "account-switch-item";

    if (alt.uuid === state.user?.uuid) {
      item.classList.add("current");
    }

    const isCurrent = alt.uuid === state.user?.uuid;
    const badge = isCurrent ? '<span class="account-switch-badge">CURRENT</span>' : '';

    item.innerHTML = `
      <img class="account-switch-avatar" src="" alt="${alt.name} avatar" />
      <div class="account-switch-info">
        <div class="account-switch-name">${alt.name}${badge}</div>
      </div>
    `;

    if (!isCurrent) {
      item.style.cursor = "pointer";
      item.addEventListener("click", async () => {
        await switchAccountInGame(alt);
      });
    }

    const avatarImg = item.querySelector(".account-switch-avatar");
    setAvatarImage(avatarImg, alt.uuid, alt.name, 88);

    list.appendChild(item);
  });
};

const switchAccountInGame = async (alt) => {
  try {
    setStatus(`Switching to ${alt.name}...`, "info");
    const result = await window.launcher.switchAccount(alt.uuid);

    if (result.ok) {
      state.user = result.user;
      updateUserDisplay();
      hideAccountSwitcher();
      setStatus(`Switched to ${alt.name}!`, "ok");
      showToast(`Now playing as ${alt.name}`, "success");
    } else {
      setStatus(`Failed to switch: ${result.error}`, "warn");
      showToast(`Could not switch account: ${result.error}`, "error");
    }
  } catch (error) {
    setStatus(`Switch failed: ${error.message}`, "warn");
    showToast(`Switch failed: ${error.message}`, "error");
    console.error('Account switch error:', error);
  }
};

const removeAlt = async (uuid) => {
  state.alts = state.alts.filter(alt => alt.uuid !== uuid);
  await window.launcher.saveAlts(state.alts);
  buildAltsList();
  setStatus("Alt removed", "ok");
};

const handleAddAlt = async () => {
  hideAltsModal();
  elements.userDropdown.classList.add("hidden");
  elements.userInfoBtn.classList.remove("open");

  setStatus("Opening Microsoft sign-in...", "info");

  try {
    const result = await window.launcher.msAuth();

    if (result.ok && result.mockUser) {
      state.user = result.mockUser;
      await window.launcher.saveAuth(result.mockUser);

      const existingAlt = state.alts.find(alt => alt.uuid === result.mockUser.uuid);
      if (!existingAlt) {
        state.alts.push(result.mockUser);
      } else {
        Object.assign(existingAlt, result.mockUser);
      }
      await window.launcher.saveAlts(state.alts);

      if (!state.versions || state.versions.length === 0) {
        await populateVersions();
        showApp();
      }

      updateUserDisplay();
      setStatus(`Added ${result.mockUser.name} successfully`, "ok");
      showToast(`Added ${result.mockUser.name}!`, "success");
    } else {
      setStatus(result.message || "Sign-in failed.", "warn");
      showToast(result.message || "Sign-in failed", "error");
    }
  } catch (error) {
    setStatus("Authentication cancelled or failed.", "warn");
    if (error.message !== 'Authentication window closed') {
      showToast(`Error: ${error.message}`, "error");
    }
  }
};

const setModsStatus = (message, tone = "info") => {
  const modsStatus = document.getElementById("mods-status");
  if (modsStatus) {
    modsStatus.textContent = message;
    modsStatus.dataset.tone = tone;
  }
};

const summarizeImportResults = (results) => {
  const normalized = Array.isArray(results) ? results : [results];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  normalized.forEach((result) => {
    if (!result) return;
    imported += Number(result.count || 0);
    skipped += Array.isArray(result.skipped) ? result.skipped.length : 0;
    failed += Array.isArray(result.failed) ? result.failed.length : 0;
    if (result.ok === false && result.error) {
      errors.push(result.error);
    }
  });

  return { imported, skipped, failed, errors };
};

const importDroppedMods = async (fileList) => {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    setModsStatus("No files detected", "warn");
    return;
  }

  const currentVersion = getSelectedMinecraftVersion();
  setModsStatus(`Importing ${files.length} file(s)...`, "info");

  try {
    const filePaths = files
      .map((file) => file?.path)
      .filter(Boolean);

    const payloadFiles = [];
    for (const file of files) {
      if (file?.path) continue;
      if (!file?.name) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      payloadFiles.push({ name: file.name, bytes });
    }

    const importResults = [];
    if (filePaths.length > 0) {
      importResults.push(await window.launcher.importModFiles(filePaths, currentVersion));
    }
    if (payloadFiles.length > 0) {
      importResults.push(await window.launcher.importModData(payloadFiles, currentVersion));
    }

    const summary = summarizeImportResults(importResults);
    if (summary.errors.length > 0 && summary.imported === 0) {
      setModsStatus(summary.errors[0] || "Failed to import mods", "warn");
      return;
    }

    const parts = [`Imported ${summary.imported}`];
    if (summary.skipped > 0) parts.push(`Skipped ${summary.skipped}`);
    if (summary.failed > 0) parts.push(`Failed ${summary.failed}`);

    setModsStatus(parts.join(" • "), summary.failed > 0 ? "warn" : "ok");
    addLog(`Mod import result: ${parts.join(", ")}`, summary.failed > 0 ? "warn" : "success");
    await refreshInstalledMods();
  } catch (error) {
    setModsStatus(error.message || "Failed to import mods", "warn");
  }
};

const openModImportPicker = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".jar";
  input.multiple = true;
  input.addEventListener("change", async () => {
    if (!input.files || input.files.length === 0) return;
    await importDroppedMods(input.files);
  });
  input.click();
};

const setupModDropZone = () => {
  const modsView = document.getElementById("mods-view");
  if (!modsView) return;

  let dragDepth = 0;

  const hasFiles = (event) => {
    const types = event?.dataTransfer?.types;
    return types && Array.from(types).includes("Files");
  };

  const clearDropState = () => {
    dragDepth = 0;
    modsView.classList.remove("mod-drop-active");
  };

  modsView.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    modsView.classList.add("mod-drop-active");
  });

  modsView.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  modsView.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      modsView.classList.remove("mod-drop-active");
    }
  });

  modsView.addEventListener("drop", async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    clearDropState();
    await importDroppedMods(event.dataTransfer?.files || []);
  });
};

const searchMods = async () => {
  const searchInput = document.getElementById("mod-search");
  const query = searchInput?.value || "";
  const sortSelect = document.getElementById("mods-sort");
  const sortBy = sortSelect?.value || "popular";
  const currentVersion = getSelectedMinecraftVersion();

  setModsStatus("Searching Modrinth...", "info");

  let result;
  try {
    result = await window.launcher.searchMods(query, currentVersion, sortBy);
  } catch (error) {
    const modsList = document.getElementById("mods-list");
    if (modsList) {
      modsList.innerHTML = `<div class="empty" style="color: var(--warn); padding: 2rem; text-align: center;">Warning: ${error.message || "Search failed"}</div>`;
    }
    setModsStatus(error.message || "Search failed", "warn");
    return;
  }

  if (result.ok && result.mods && result.mods.length > 0) {
    await displayModSearchResults(result.mods);
    setModsStatus(`Found ${result.mods.length} mods (${sortBy})`, "ok");
  } else if (!result.ok) {
    const modsList = document.getElementById("mods-list");
    if (modsList) {
      modsList.innerHTML = `<div class="empty" style="color: var(--warn); padding: 2rem; text-align: center;">Warning: ${result.error || "Search failed"}</div>`;
    }
    setModsStatus(result.error || "Search failed", "warn");
  } else {
    const modsList = document.getElementById("mods-list");
    if (modsList) {
      modsList.innerHTML = '<div class="empty">No mods found. Try a different search!</div>';
    }
    setModsStatus("No mods found", "info");
  }
};

const displayModSearchResults = async (mods) => {
  const modsList = document.getElementById("mods-list");
  if (!modsList) return;

  if (mods.length === 0) {
    modsList.innerHTML = '<div class="empty">No mods found. Try a different search!</div>';
    return;
  }


  const currentVersion = getSelectedMinecraftVersion();
  let installedModIds = [];
  try {
    const installedResult = await window.launcher.getInstalledMods(currentVersion);
    if (installedResult.ok && installedResult.mods) {
      installedModIds = installedResult.mods
        .filter(m => m.modId)
        .map(m => m.modId);
    }
  } catch (error) {

  }

  modsList.innerHTML = "";

  mods.forEach(mod => {
    const modCard = document.createElement("div");
    modCard.className = "mod-card";

    const logoImg = mod.logo
      ? `<img src="${mod.logo}" alt="${mod.name}" class="mod-logo" />`
      : `<div class="mod-logo-placeholder" aria-hidden="true">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
             <path d="M3 7L12 3L21 7V17L12 21L3 17V7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
             <path d="M3 7L12 11L21 7" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
             <path d="M12 11V21" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
           </svg>
         </div>`;

    const isInstalled = installedModIds.includes(mod.id);

    modCard.innerHTML = `
      ${logoImg}
      <div class="mod-info">
        <h3 class="mod-name">${mod.name}</h3>
        <p class="mod-author">by ${mod.author}</p>
        <p class="mod-summary">${mod.summary || 'No description available.'}</p>
        <div class="mod-stats">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5 20H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            ${formatDownloadCount(mod.downloadCount)}
          </span>
        </div>
      </div>
      <button class="mod-install-btn ${isInstalled ? 'installed' : ''}" data-mod-id="${mod.id}" ${isInstalled ? 'disabled' : ''}>
        ${isInstalled ? 'Installed' : 'Install'}
      </button>
    `;

    // install button handled by delegated listener on #mods-list

    modsList.appendChild(modCard);
    addSlideUp(modCard);
  });
};

const formatDownloadCount = (count) => {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
};

const installMod = async (modId, modName, buttonEl) => {
  const currentVersion = getSelectedMinecraftVersion();
  setModsStatus(`Installing ${modName}...`, "info");
  addLog(`Installing mod: ${modName}`, "info");
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Installing...";
  }

  try {
    const result = await window.launcher.downloadMod(modId, currentVersion);

    if (result.ok) {
      setModsStatus(`${modName} installed successfully!`, "ok");
      addLog(`Mod installed: ${modName}`, "success");
      setTimeout(() => refreshInstalledMods(), 1000);
    } else {
      setModsStatus(result.error || "Installation failed", "warn");
      addLog(`Mod installation failed: ${modName} - ${result.error}`, "error");
    }
  } catch (error) {
    setModsStatus(error.message || "Installation failed", "warn");
    addLog(`Mod installation error: ${modName} - ${error.message}`, "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Install";
    }
  }
};

const openModsFolder = async () => {
  const currentVersion = getSelectedMinecraftVersion();
  try {
    await window.launcher.openFolder(currentVersion);
  } catch (error) {
    setModsStatus(`Failed to open folder: ${error.message}`, "warn");
  }
};

const refreshInstalledMods = async () => {
  const currentVersion = getSelectedMinecraftVersion();
  setModsStatus("Refreshing installed mods...", "info");

  const result = await window.launcher.getInstalledMods(currentVersion);

  const modsList = document.getElementById("mods-list");
  const updateAllBtn = document.getElementById("update-all-mods");
  if (!modsList) return;

  if (result.ok && result.mods && result.mods.length > 0) {
    modsList.innerHTML = "";
    let hasUpdates = false;

    result.mods.forEach(mod => {
      const modItem = document.createElement("div");
      modItem.className = "installed-mod-item";

      const isDisabled = mod.fileName.endsWith('.disabled');
      const displayName = isDisabled ? mod.name.replace('.disabled', '') : mod.name;
      const hasUpdate = mod.hasUpdate || false;
      if (hasUpdate) hasUpdates = true;

      const compatibilityIssues = (mod.compatibility && mod.compatibility.issues) ? mod.compatibility.issues : [];
      const missingMods = compatibilityIssues.filter(i => i.type === "missing").map(i => i.name);
      const incompatibleMods = compatibilityIssues.filter(i => i.type === "incompatible").map(i => i.name);
      let compatibilityHtml = "";
      if (missingMods.length || incompatibleMods.length) {
        const parts = [];
        if (missingMods.length) parts.push(`Missing: ${missingMods.join(", ")}`);
        if (incompatibleMods.length) parts.push(`Incompatible: ${incompatibleMods.join(", ")}`);
        compatibilityHtml = `<div class="mod-compat-warning"><strong>Warning:</strong> ${parts.join(" | ")}</div>`;
      }

      const modIconHtml = mod.icon
        ? `<img src="${mod.icon}" alt="${displayName} icon" loading="lazy" />`
        : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 7L12 3L21 7V17L12 21L3 17V7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M3 7L12 11L21 7" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M12 11V21" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>`;

      modItem.innerHTML = `
        <div class="mod-icon" aria-hidden="true">
          ${modIconHtml}
        </div>
        <div class="mod-info">
          <div class="mod-name" style="${isDisabled ? 'opacity: 0.5; text-decoration: line-through;' : ''}">${displayName}</div>
          <div class="mod-size">${formatSize(mod.size)}${hasUpdate ? ' <span style="color: var(--accent);"> - Update available</span>' : ''}</div>
          ${compatibilityHtml}
        </div>
        <div class="mod-actions">
          ${hasUpdate && !isDisabled ? '<button class="mod-update-btn" data-filename="' + mod.fileName + '" data-modid="' + (mod.modId || '') + '" title="Update" aria-label="Update mod"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5V19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 10L12 5L17 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : ''}
          <button class="mod-toggle-btn" data-filename="${mod.fileName}" title="${isDisabled ? 'Enable' : 'Disable'}">
            ${isDisabled
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5V19L19 12L8 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="6" width="3" height="12" rx="1" fill="currentColor"/><rect x="14" y="6" width="3" height="12" rx="1" fill="currentColor"/></svg>'}
          </button>
          <button class="mod-delete-btn" data-filename="${mod.fileName}" title="Delete" aria-label="Delete mod">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M9 7V5H15V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M7 7L8 19H16L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `;

      // action buttons are handled by delegated listener on #mods-list

      if (mod.modId) {
        modItem.style.cursor = 'pointer';
        modItem.addEventListener('click', () => {
          window.launcher.openExternal(`https://modrinth.com/mod/${mod.modId}`);
        });
      }

      modsList.appendChild(modItem);
    });

    if (updateAllBtn) {
      updateAllBtn.style.display = hasUpdates ? 'inline-block' : 'none';
      updateAllBtn.onclick = hasUpdates ? (e => {
        e.stopPropagation();
        const currentVersion = getSelectedMinecraftVersion();
        updateAllMods(updateAllBtn, currentVersion);
      }) : null;
    }

    setModsStatus(`${result.mods.length} mods installed${hasUpdates ? ' (updates available)' : ''}`, "ok");
  } else if (result.ok) {
    modsList.innerHTML = '<div class="empty">No mods installed yet. Search and install some mods!</div>';
    if (updateAllBtn) updateAllBtn.style.display = 'none';
    setModsStatus("No mods installed", "info");
  } else {
    setModsStatus(result.error || "Failed to load mods", "warn");
  }
};

const formatSize = (bytes) => {
  if (bytes >= 1048576) {
    return (bytes / 1048576).toFixed(1) + ' MB';
  } else if (bytes >= 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return bytes + ' B';
};

const toggleMod = async (fileName, isDisabled, btn, gameVersion) => {
  if (btn) btn.disabled = true;
  try {
    const result = await window.launcher.toggleMod(fileName, isDisabled, gameVersion);
    if (result.ok) {
      setModsStatus(isDisabled ? 'Mod enabled' : 'Mod disabled', 'ok');
      setTimeout(() => refreshInstalledMods(), 300);
    } else {
      setModsStatus(result.error || 'Failed to toggle mod', 'warn');
    }
  } catch (error) {
    setModsStatus(error.message || 'Failed to toggle mod', 'warn');
    addLog(`toggleMod error: ${error.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

const deleteMod = async (fileName, btn, gameVersion) => {
  if (btn) btn.disabled = true;
  try {
    const result = await window.launcher.deleteMod(fileName, gameVersion);
    if (result.ok) {
      setModsStatus('Mod deleted', 'ok');
      addLog(`Mod deleted: ${fileName}`, 'info');
      setTimeout(() => refreshInstalledMods(), 300);
    } else {
      setModsStatus(result.error || 'Failed to delete mod', 'warn');
      addLog(`Failed to delete mod: ${fileName}`, 'error');
    }
  } catch (error) {
    setModsStatus(error.message || 'Failed to delete mod', 'warn');
    addLog(`Error deleting mod: ${fileName} - ${error.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

const updateMod = async (modId, oldFileName, btn, gameVersion) => {
  if (btn) btn.disabled = true;
  if (!modId) {
    setModsStatus('Cannot update: mod ID unknown', 'warn');
    addLog('Mod update failed: mod ID unknown', 'error');
    if (btn) btn.disabled = false;
    return;
  }
  setModsStatus(`Updating mod...`, 'info');
  addLog(`Updating mod: ${oldFileName}`, 'info');
  try {
    const result = await window.launcher.updateMod(modId, oldFileName, gameVersion);
    if (result.ok) {
      setModsStatus('Mod updated successfully!', 'ok');
      addLog(`Mod updated: ${oldFileName}`, 'success');

      // Optimistically update UI: remove the update button for this file and its badge
      try {
        const modsList = document.getElementById('mods-list');
        if (modsList) {
          const updateBtn = modsList.querySelector(`.mod-update-btn[data-filename="${oldFileName}"]`);
          if (updateBtn) {
            const item = updateBtn.closest('.installed-mod-item');
            updateBtn.remove();
            if (item) {
              const sizeEl = item.querySelector('.mod-size');
              if (sizeEl) {
                const badge = sizeEl.querySelector('span');
                if (badge && /Update available/i.test(badge.textContent || '')) {
                  badge.remove();
                }
              }
            }
          }
        }
      } catch (err) {
        // ignore UI update errors
      }

      // Refresh installed mods now and again to ensure consistency
      refreshInstalledMods();
      setTimeout(() => refreshInstalledMods(), 1000);
      setTimeout(() => refreshInstalledMods(), 2500);
    } else {
      setModsStatus(result.error || 'Update failed', 'warn');
    }
  } catch (error) {
    setModsStatus(error.message || 'Update failed', 'warn');
    addLog(`updateMod error: ${error.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

let updatingAllMods = false;
const updateAllMods = async (btn, gameVersion) => {
  if (updatingAllMods) return;
  updatingAllMods = true;
  if (btn) btn.disabled = true;
  setModsStatus('Updating all mods...', 'info');
  const refreshBtn = document.getElementById('refresh-mods');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const result = await window.launcher.updateAllMods(gameVersion);
    if (result.ok) {
      setModsStatus(`Updated ${result.updated || 0} mods`, 'ok');

      // Optimistically update UI: remove update buttons and badges
      try {
        const modsList = document.getElementById('mods-list');
        if (modsList) {
          modsList.querySelectorAll('.mod-update-btn').forEach(b => b.remove());
          modsList.querySelectorAll('.mod-size').forEach(sz => {
            const badge = sz.querySelector('span');
            if (badge && /Update available/i.test(badge.textContent || '')) badge.remove();
          });
        }
        const updateAllBtnEl = document.getElementById('update-all-mods');
        if (updateAllBtnEl) updateAllBtnEl.style.display = 'none';
      } catch (err) {
        // ignore UI update errors
      }

      // Refresh several times to ensure the filesystem and API state converges
      refreshInstalledMods();
      setTimeout(() => refreshInstalledMods(), 1200);
      setTimeout(() => refreshInstalledMods(), 3000);
    } else {
      setModsStatus(result.error || 'Update failed', 'warn');
    }
  } catch (error) {
    setModsStatus(error.message || 'Update failed', 'warn');
    addLog(`updateAllMods error: ${error.message}`, 'error');
  } finally {
    updatingAllMods = false;
    if (btn) btn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
};

const normalizeAuthUser = (authUser) => {
  if (!authUser || typeof authUser !== "object") return null;

  const normalized = { ...authUser };
  if (!normalized.accessToken && normalized.access_token) normalized.accessToken = normalized.access_token;
  if (!normalized.refreshToken && normalized.refresh_token) normalized.refreshToken = normalized.refresh_token;

  if ((!normalized.name || !normalized.uuid) && normalized.profile) {
    if (!normalized.name && normalized.profile.name) normalized.name = normalized.profile.name;
    if (!normalized.uuid && (normalized.profile.uuid || normalized.profile.id)) {
      normalized.uuid = normalized.profile.uuid || normalized.profile.id;
    }
  }

  return normalized;
};

const loadAuthFromStorage = () => {
  try {
    const stored = localStorage.getItem("tigerClientAuth");
    if (!stored) return null;
    return normalizeAuthUser(JSON.parse(stored));
  } catch (error) {
    return null;
  }
};

const persistAuthInStorage = (authData) => {
  try {
    localStorage.setItem("tigerClientAuth", JSON.stringify(authData));
  } catch (error) {
    console.warn("Could not persist auth to localStorage", error);
  }
};

const clearAuthStorage = () => {
  try {
    localStorage.removeItem("tigerClientAuth");
  } catch (error) {
    console.warn("Could not clear auth from localStorage", error);
  }
};

const checkAuth = async () => {
  let savedUser = normalizeAuthUser(await window.launcher.getAuth()) || loadAuthFromStorage();
  if (savedUser && savedUser.name && savedUser.uuid) {
    state.user = savedUser;
    updateUserDisplay();
    showApp();

    if (savedUser.refreshToken) {
      const refreshResult = await window.launcher.refreshAuth();
      if (refreshResult.ok && refreshResult.auth) {
        const refreshedUser = normalizeAuthUser(refreshResult.auth);
        if (refreshedUser) {
          state.user = refreshedUser;
          updateUserDisplay();
          await window.launcher.saveAuth(refreshedUser);
          persistAuthInStorage(refreshedUser);
        }
      }
    }

    return true;
  }
  return false;
};

const updateLaunchButton = () => {
  const launchBtn = document.getElementById("launch-game");
  if (!launchBtn) return;

  const label = launchBtn.querySelector("span");
  const icon = launchBtn.querySelector("svg");
  if (!label) return;

  if (state.isGameRunning) {
    label.textContent = "STOP GAME";
    launchBtn.disabled = false;
    launchBtn.style.opacity = "1";
    launchBtn.style.cursor = "pointer";
    launchBtn.classList.add("stop-mode");
    if (icon) {
      icon.innerHTML = '<path d="M6 6h12v12H6z"/>';
    }
    setStatus("Minecraft is running", "ok");
  } else if (state.isLaunching) {
    label.textContent = "CANCEL";
    launchBtn.disabled = false;
    launchBtn.style.opacity = "1";
    launchBtn.style.cursor = "pointer";
    launchBtn.classList.remove("stop-mode");
    if (icon) {
      icon.innerHTML = '<path d="M6 6h12v12H6z"/>';
    }
  } else {
    label.textContent = launchBtn.dataset.originalLabel || "PLAY";
    launchBtn.disabled = false;
    launchBtn.style.opacity = "1";
    launchBtn.style.cursor = "pointer";
    launchBtn.classList.remove("stop-mode");
    if (icon) {
      icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
  }
};

const handleLaunch = async (event) => {

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (state.isGameRunning) {

    try {
      const result = await window.launcher.closeGame();
      if (result.ok) {
        state.isGameRunning = false;
        updateLaunchButton();
        setStatus("Game closed", "ok");
        addLog("Minecraft closed by user", "info");
      } else {
        setStatus(result.message || "Failed to close game", "warn");
      }
    } catch (error) {
      console.error("Failed to close game:", error);
      setStatus("Failed to close game", "error");
    }
    return;
  }

  if (state.isLaunching && !state.launchCancelable) {
    setStatus("Launch is starting, please wait...", "info");
    return;
  }

  if (state.isLaunching) {
    setStatus("Cancelling launch...", "warn");
    try {
      const result = await window.launcher.cancelLaunch();
      if (result.ok) {
        state.isLaunching = false;
        state.launchCancelable = false;
        updateLaunchButton();
        setStatus("Launch cancelled", "warn");
        addLog("Launch cancelled by user", "info");
      } else {
        setStatus(result.message || "Failed to cancel", "error");
      }
    } catch (error) {
      console.error("Failed to cancel launch:", error);
      setStatus("Failed to cancel launch", "error");
    }
    return;
  }

  const launchBtn = elements.launchButton;

  if (launchBtn && launchBtn.disabled) {
    return;
  }

  const selectedVersion = getSelectedMinecraftVersion();

  if (!selectedVersion) {
    setStatus("Please select a Minecraft version", "warn");
    return;
  }

  if (!state.user) {
    setStatus("Not signed in", "warn");
    return;
  }

  state.isLaunching = true;
  state.launchCancelable = false;
  saveLastSelectedVersion(selectedVersion);

  if (launchBtn) {
    const label = launchBtn.querySelector("span");
    if (label) {
      if (!launchBtn.dataset.originalLabel) {
        launchBtn.dataset.originalLabel = label.textContent || "PLAY";
      }
      label.textContent = "LAUNCHING";
    }
    launchBtn.disabled = true;
    launchBtn.style.opacity = "1";
    launchBtn.style.cursor = "not-allowed";

    setTimeout(() => {
      if (state.isLaunching) {
        state.launchCancelable = true;
        launchBtn.disabled = false;
        launchBtn.style.cursor = "pointer";
      }
    }, 800);
  }

  setStatus("Preparing to launch...", "info");
  addLog(`Launching Minecraft ${selectedVersion}`, "info");

  const profile = {
    version: selectedVersion,
    serverAddress: ""
  };

  try {
    const result = await window.launcher.launch({ profile, user: state.user });

    if (result.ok) {
      setStatus(result.message, "ok");
      addLog(result.message, "success");
    } else {
      setStatus(result.message || "Launch failed", "warn");
      addLog(result.message || "Launch failed", "error");
    }
  } catch (error) {
    setStatus("Launch error: " + error.message, "warn");
    addLog("Launch error: " + error.message, "error");
  } finally {
    state.isLaunching = false;
    state.launchCancelable = false;
    updateLaunchButton();
    if (launchBtn) {
      const label = launchBtn.querySelector("span");
      if (label) {
        label.textContent = launchBtn.dataset.originalLabel || "PLAY";
      }
      launchBtn.disabled = false;
      launchBtn.style.opacity = "1";
      launchBtn.style.cursor = "pointer";
    }
  }
};

const loadSavedSkins = () => {
  try {
    const saved = localStorage.getItem('tiger-skins');
    if (saved) {
      const data = JSON.parse(saved);
      state.skins = data.skins || [];
      state.equippedSkin = data.equippedSkin || null;
      state.selectedModel = data.selectedModel || 'classic';
    }
  } catch (err) {
    console.error('Failed to load skins:', err);
    state.skins = [];
    state.equippedSkin = null;
    state.selectedModel = 'classic';
  }


  setModelType(state.selectedModel);
  updateUserAvatarFromSkins();
};

const saveSkins = () => {
  try {
    const data = {
      skins: state.skins,
      equippedSkin: state.equippedSkin,
      selectedModel: state.selectedModel
    };
    localStorage.setItem('tiger-skins', JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save skins:', err);
    state.skins = [];
    state.equippedSkin = null;
    state.selectedModel = 'classic';
  }
};

const equipSkin = async (skinId) => {
  const skin = state.skins.find(s => s.id === skinId);
  if (!skin) return;

  setStatus("Uploading skin...", "info");

  try {
    const result = await window.launcher.uploadSkin({
      imageData: skin.imageData,
      variant: skin.model === 'slim' ? 'slim' : 'classic'
    });

    if (!result.ok) {
      setStatus(`Failed to upload skin: ${result.error}`, "error");
      showToast(`Failed to upload skin: ${result.error}`, "error");
      return;
    }

    state.equippedSkin = skin.id;
    saveSkins();
    displaySkinLibrary();
    updateUserAvatarFromSkins();
    setStatus(`Skin "${skin.name}" equipped and uploaded!`, "ok");
    showToast(`Skin "${skin.name}" equipped!`, "success");
  } catch (error) {
    setStatus(`Error uploading skin: ${error.message}`, "error");
    showToast(`Error uploading skin: ${error.message}`, "error");
  }
};

const removeSkin = (skinId) => {
  state.skins = state.skins.filter(s => s.id !== skinId);
  if (state.equippedSkin === skinId) {
    state.equippedSkin = null;
  }
  saveSkins();
  displaySkinLibrary();
  updateUserAvatarFromSkins();
  setStatus("Skin removed", "info");
};

const addSkinToLibrary = async (imageData, skinName, model) => {
  const skin = {
    id: `skin-${Date.now()}`,
    name: skinName,
    imageData: imageData,
    model: model
  };
  state.skins.unshift(skin);
  state.equippedSkin = skin.id;
  saveSkins();
  displaySkinLibrary();
  updateUserAvatarFromSkins();
  setStatus(`Skin "${skinName}" added. Uploading to Minecraft...`, "info");
  addLog(`Skin added: ${skinName}`, "success");

  await equipSkin(skin.id);
};

const changeSkinModel = async (skinId) => {
  const skin = state.skins.find(s => s.id === skinId);
  if (!skin) return;

  const newModel = skin.model === 'slim' ? 'classic' : 'slim';
  skin.model = newModel;
  state.equippedSkin = skin.id;
  saveSkins();

  setStatus("Updating skin model...", "info");

  try {
    const result = await window.launcher.uploadSkin({
      imageData: skin.imageData,
      variant: newModel
    });

    if (!result.ok) {
      setStatus(`Failed to update skin model: ${result.error}`, "error");
      showToast(`Failed to update skin model: ${result.error}`, "error");
      skin.model = skin.model === 'slim' ? 'classic' : 'slim';
      saveSkins();
      displaySkinLibrary();
      return;
    }

    displaySkinLibrary();
    updateUserAvatarFromSkins();
    setStatus(`Model changed to: ${newModel === 'slim' ? 'Slim' : 'Classic'} and re-uploaded!`, 'ok');
    showToast(`Skin model updated to ${newModel === 'slim' ? 'Slim' : 'Classic'}!`, 'success');
  } catch (error) {
    setStatus(`Error updating skin model: ${error.message}`, "error");
    showToast(`Error updating skin model: ${error.message}`, "error");
    skin.model = skin.model === 'slim' ? 'classic' : 'slim';
    saveSkins();
    displaySkinLibrary();
  }
};

const renameSkin = (skinId) => {
  const skin = state.skins.find(s => s.id === skinId);
  if (skin) {
    const newName = prompt('Enter new skin name:', skin.name);
    if (newName && newName.trim()) {
      skin.name = newName.trim();
      saveSkins();
      displaySkinLibrary();
      setStatus(`Renamed to: ${newName}`, 'ok');
    }
  }
};
const displaySkinLibrary = () => {
  const library = document.getElementById('skin-library');
  if (!library) return;

  if (state.skins.length === 0) {
    library.innerHTML = '<div class="empty">No skins yet. Upload one to get started!</div>';
    return;
  }

  library.innerHTML = '';

  state.skins.forEach(skin => {
    const skinCard = document.createElement('div');
    const isEquipped = state.equippedSkin === skin.id;
    skinCard.className = `skin-card ${isEquipped ? 'equipped' : ''}`;
    skinCard.innerHTML = `
      <div class="skin-card-preview">
        <img class="skin-preview-img" data-skin-id="${skin.id}" alt="${skin.name}" />
        ${isEquipped ? '<div class="equipped-badge" aria-label="Equipped"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13L10 18L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' : ''}
      </div>
      <div class="skin-card-info">
        <div class="skin-card-name">${skin.name}</div>
        <button class="skin-card-model-toggle" data-skin-id="${skin.id}" title="Toggle between Slim and Classic">
          ${skin.model === 'slim' ? 'Slim' : 'Classic'}
        </button>
      </div>
      <div class="skin-card-actions">
        <button class="skin-card-rename" data-skin-id="${skin.id}" title="Rename skin">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 14L4.5 12.5L12.5 4.5L14 6L6 14H2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="skin-card-delete" data-skin-id="${skin.id}" title="Delete skin">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    const renameBtn = skinCard.querySelector('.skin-card-rename');
    const deleteBtn = skinCard.querySelector('.skin-card-delete');
    const modelBtn = skinCard.querySelector('.skin-card-model-toggle');
    const previewImg = skinCard.querySelector('.skin-preview-img');

    skinCard.addEventListener('click', () => {
      equipSkin(skin.id);
    });

    modelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      changeSkinModel(skin.id);
    });

    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renameSkin(skin.id);
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSkin(skin.id);
    });

    if (previewImg) {
      getSkinPreviewUrl(skin, 512, "full").then((url) => {
        if (previewImg.isConnected) {
          previewImg.src = url;
        }
      });
    }

    library.appendChild(skinCard);
    addFadeIn(skinCard);
  });
};

const uploadSkinFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatus('Please select a valid PNG image', 'warn');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if ((img.width === 64 && img.height === 64) || (img.width === 64 && img.height === 32)) {
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          console.log('Image loaded, calling showSkinNamePrompt with name:', baseName);
          showSkinNamePrompt(event.target.result, baseName);
        } else {
          setStatus('Invalid skin dimensions. Must be 64x64 or 64x32', 'warn');
        }
      };
      img.onerror = () => {
        setStatus('Failed to load image', 'error');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
};

const showSkinNamePrompt = (imageData, defaultName) => {
  const modal = document.getElementById('skin-name-modal');
  const input = document.getElementById('skin-name-input');
  const preview = document.getElementById('skin-name-preview');
  const confirmBtn = document.getElementById('confirm-skin-name');
  const cancelBtn = document.getElementById('cancel-skin-name');

  if (!modal || !input || !preview || !confirmBtn || !cancelBtn) {
    console.error('Skin modal elements not found:', {
      modal: !!modal, input: !!input, preview: !!preview,
      confirmBtn: !!confirmBtn, cancelBtn: !!cancelBtn
    });
    setStatus('Error: Skin upload interface not found', 'error');
    return;
  }

  input.value = defaultName;

  renderSkin3dPreview(imageData, state.selectedModel, 256, "full")
    .then((url) => {
      if (preview.isConnected) {
        preview.src = url;
        console.log('3D skin preview loaded');
      }
    })
    .catch((err) => {
      console.log('3D preview failed, trying 2D fallback:', err);
      renderSkinPreview(imageData, state.selectedModel, 128, "full")
        .then((url) => {
          if (preview.isConnected) {
            preview.src = url;
            console.log('2D skin preview loaded');
          }
        })
        .catch((e) => {
          console.error('Both preview renderers failed:', e);
        });
    });

  modal.classList.remove('hidden');
  input.focus();
  input.select();

  const handleConfirm = () => {
    const skinName = input.value.trim() || defaultName;
    console.log('Adding skin:', skinName);
    addSkinToLibrary(imageData, skinName, state.selectedModel);
    modal.classList.add('hidden');
    cleanup();
  };

  const handleCancel = () => {
    console.log('Cancelling skin upload');
    modal.classList.add('hidden');
    cleanup();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const cleanup = () => {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
    input.removeEventListener('keypress', handleKeyPress);
    console.log('Skin modal event listeners cleaned up');
  };

  confirmBtn.removeEventListener('click', handleConfirm);
  cancelBtn.removeEventListener('click', handleCancel);
  input.removeEventListener('keypress', handleKeyPress);

  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
  input.addEventListener('keypress', handleKeyPress);

  console.log('Skin modal opened, listeners attached');
};

const setModelType = (modelType) => {
  state.selectedModel = modelType;

  const classicBtn = document.getElementById('model-classic');
  const slimBtn = document.getElementById('model-slim');

  if (classicBtn && slimBtn) {
    if (modelType === 'slim') {
      classicBtn.classList.remove('active');
      slimBtn.classList.add('active');
    } else {
      classicBtn.classList.add('active');
      slimBtn.classList.remove('active');
    }
  }


  saveSkins();
  addLog(`Model type set to: ${modelType === 'slim' ? 'Slim' : 'Classic'}`, 'info');
};

const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
};

const wireEvents = () => {
  elements.msLogin.addEventListener("click", handleMsLogin);
  if (elements.loginUninstallBtn) {
    elements.loginUninstallBtn.addEventListener("click", handleUninstall);
  }
  
  if (elements.profileVersion) {
    elements.profileVersion.addEventListener("change", (e) => {
      saveLastSelectedVersion(e.target.value);
    });
  }
  
  elements.launchButton.addEventListener("click", handleLaunch);
  elements.userInfoBtn.addEventListener("click", toggleUserDropdown);
  elements.signOutBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSignOut();
  });
  elements.altsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showAltsModal();
  });
  elements.closeAltsBtn.addEventListener("click", hideAltsModal);
  elements.addAltBtn.addEventListener("click", handleAddAlt);

  const closeSwitcherBtn = document.getElementById("close-switcher-btn");
  if (closeSwitcherBtn) {
    closeSwitcherBtn.addEventListener("click", hideAccountSwitcher);
  }

  const accountSwitcherModal = document.getElementById("account-switcher-modal");
  if (accountSwitcherModal) {
    accountSwitcherModal.addEventListener("click", (e) => {
      if (e.target === accountSwitcherModal) {
        hideAccountSwitcher();
      }
    });
  }

  elements.settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showSettingsModal();
  });
  elements.settingsCloseBtn.addEventListener("click", hideSettingsModal);
  elements.uninstallBtn.addEventListener("click", handleUninstall);

  if (elements.checkUpdatesBtn) {
    elements.checkUpdatesBtn.addEventListener("click", async () => {
      if (window.launcher.checkUpdates) {
        setUpdateStatus("checking", "Checking for updates...");
        await window.launcher.checkUpdates();
      }
    });
  }

  if (elements.updateBtn) {
    elements.updateBtn.addEventListener("click", async () => {
      if (state.updateStatus === "downloaded" && window.launcher.installUpdate) {
        await window.launcher.installUpdate();
      }
    });
  }


  const ramSlider = document.getElementById("ram-slider");
  const autoRamToggle = document.getElementById("auto-ram-toggle");
  const ramPresetButtons = Array.from(document.querySelectorAll(".ram-preset"));
  let pendingRamSave = null;

  const saveManualRam = async (ramAllocation) => {
    const numericValue = parseInt(ramAllocation, 10);
    if (!Number.isFinite(numericValue)) return;
    try {
      const current = await window.launcher.getSettings();
      await window.launcher.saveSettings({
        ...current,
        autoRam: false,
        ramAllocation: numericValue,
        minRam: Math.floor(numericValue / 2)
      });
      const updated = await window.launcher.getSettings();
      applyRamSettingsToUI(updated);
    } catch (error) {
      console.error("Failed to save RAM settings:", error);
    }
  };

  const queueRamSave = (ramAllocation) => {
    if (pendingRamSave) {
      clearTimeout(pendingRamSave);
    }
    pendingRamSave = setTimeout(() => {
      pendingRamSave = null;
      saveManualRam(ramAllocation);
    }, 160);
  };

  if (ramSlider) {
    ramSlider.addEventListener("input", (e) => {
      if (autoRamToggle && autoRamToggle.checked) return;
      const value = parseInt(e.target.value, 10);
      if (!Number.isFinite(value)) return;
      updateRamPreview(value, false);
      queueRamSave(value);
    });

    ramSlider.addEventListener("change", (e) => {
      if (autoRamToggle && autoRamToggle.checked) return;
      addLog(`RAM allocation set to ${formatRamValue(parseInt(e.target.value, 10))}`, "success");
    });
  }

  ramPresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!ramSlider || (autoRamToggle && autoRamToggle.checked)) return;
      const value = parseInt(button.dataset.ram, 10);
      if (!Number.isFinite(value)) return;
      ramSlider.value = String(value);
      updateRamPreview(value, false);
      queueRamSave(value);
      addLog(`RAM preset applied: ${formatRamValue(value)}`, "info");
    });
  });

  if (autoRamToggle) {
    autoRamToggle.addEventListener("change", async (e) => {
      try {
        const autoEnabled = !!e.target.checked;
        const current = await window.launcher.getSettings();
        if (autoEnabled) {
          await window.launcher.saveSettings({ ...current, autoRam: true });
        } else {
          const ramValue = ramSlider ? parseInt(ramSlider.value, 10) : 2048;
          await window.launcher.saveSettings({
            ...current,
            autoRam: false,
            ramAllocation: Number.isFinite(ramValue) ? ramValue : 2048,
            minRam: Math.floor((Number.isFinite(ramValue) ? ramValue : 2048) / 2)
          });
        }
        const updated = await window.launcher.getSettings();
        applyRamSettingsToUI(updated);
        addLog(`Auto RAM ${autoEnabled ? "enabled" : "disabled"}`, "info");
      } catch (error) {
        console.error("Failed to save auto RAM setting:", error);
      }
    });
  }

  // Start on boot toggle handler
  const startOnBootToggle = document.getElementById("start-on-boot-toggle");
  if (startOnBootToggle) {
    startOnBootToggle.addEventListener("change", async (e) => {
      try {
        const enabled = !!e.target.checked;
        const current = await window.launcher.getSettings();
        await window.launcher.saveSettings({ ...current, startOnBoot: enabled });
        addLog(`Start on Windows launch ${enabled ? "enabled" : "disabled"}`, "info");
      } catch (error) {
        console.error("Failed to save start on boot setting:", error);
      }
    });
  }


  elements.settingsModal.addEventListener("click", (e) => {
    if (e.target === elements.settingsModal) {
      hideSettingsModal();
    }
  });

  if (elements.minimizeBtn) {
    elements.minimizeBtn.addEventListener("click", () => {
      window.launcher.minimizeWindow();
    });
  }

  if (elements.maximizeBtn) {
    elements.maximizeBtn.addEventListener("click", () => {
      window.launcher.maximizeWindow();
    });
  }

  if (elements.closeBtn) {
    elements.closeBtn.addEventListener("click", () => {
      window.launcher.closeWindow();
    });
  }

  elements.homeBtn = qs("#home-btn");
  elements.modsBtn = qs("#mods-btn");
  elements.skinEditorBtn = qs("#skin-editor-btn");
  elements.logsBtn = qs("#logs-btn");
  elements.screenshotsBtn = qs("#screenshots-btn");
  elements.homeView = qs("#home-view");
  elements.modsView = qs("#mods-view");
  elements.skinEditorView = qs("#skin-editor-view");
  elements.logsView = qs("#logs-view");
  elements.screenshotsView = qs("#screenshots-view");

  elements.homeBtn.addEventListener("click", () => {
    switchView("home");
    setStatus("Home view", "info");
  });

  elements.modsBtn.addEventListener("click", () => {
    switchView("mods");
    refreshInstalledMods();
    setModsStatus("Mod manager ready", "info");
  });

  if (elements.skinEditorBtn) {
    elements.skinEditorBtn.addEventListener("click", () => {
      switchView("skin-editor");
      setStatus("Skins library", "info");
      displaySkinLibrary();
    });
  }

  if (elements.logsBtn) {
    elements.logsBtn.addEventListener("click", () => {
      switchView("logs");
    });
  }

  if (elements.screenshotsBtn) {
    elements.screenshotsBtn.addEventListener("click", () => {
      switchView("screenshots");
      loadScreenshots();
    });
  }

  const refreshScreenshotsBtn = document.getElementById("refresh-screenshots");
  if (refreshScreenshotsBtn) {
    refreshScreenshotsBtn.addEventListener("click", () => {
      loadScreenshots();
      addLog("Screenshots refreshed", "info");
    });
  }

  const openScreenshotsFolderBtn = document.getElementById("open-screenshots-folder");
  if (openScreenshotsFolderBtn) {
    openScreenshotsFolderBtn.addEventListener("click", async () => {
      const currentVersion = getSelectedMinecraftVersion();
      await window.launcher.openScreenshotsFolder(currentVersion);
      addLog("Opened screenshots folder", "info");
    });
  }

  const clearLogsBtn = document.getElementById("clear-logs");
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", clearLogs);
  }

  const uploadSkinBtn = document.getElementById("upload-skin");
  const modelClassicBtn = document.getElementById("model-classic");
  const modelSlimBtn = document.getElementById("model-slim");

  if (uploadSkinBtn) {
    uploadSkinBtn.addEventListener("click", uploadSkinFile);
  }

  if (modelClassicBtn) {
    modelClassicBtn.addEventListener("click", () => setModelType('classic'));
  }

  if (modelSlimBtn) {
    modelSlimBtn.addEventListener("click", () => setModelType('slim'));
  }

  const browseMods = document.getElementById("browse-mods");
  const refreshModsBtn = document.getElementById("refresh-mods");
  const importModFilesBtn = document.getElementById("import-mod-files");
  const updateAllModsBtn = document.getElementById("update-all-mods");
  const openModsFolderBtn = document.getElementById("open-mods-folder");
  const modSearchInput = document.getElementById("mod-search");
  const modsSortSelect = document.getElementById("mods-sort");

  if (browseMods) {
    browseMods.addEventListener("click", searchMods);
  }

  if (refreshModsBtn) {
    refreshModsBtn.addEventListener("click", refreshInstalledMods);
  }

  if (importModFilesBtn) {
    importModFilesBtn.addEventListener("click", openModImportPicker);
  }

  if (updateAllModsBtn) {
    updateAllModsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentVersion = getSelectedMinecraftVersion();
      updateAllMods(updateAllModsBtn, currentVersion);
    });
  }

  if (openModsFolderBtn) {
    openModsFolderBtn.addEventListener("click", openModsFolder);
  }

  if (modSearchInput) {
    modSearchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        searchMods();
      }
    });
  }

  if (modsSortSelect) {
    modsSortSelect.addEventListener("change", () => {
      searchMods();
    });
  }

  // Event delegation for mod action buttons so handlers persist
  const modsListEl = document.getElementById("mods-list");
  if (modsListEl) {
    modsListEl.addEventListener("click", (e) => {
      const updateBtnEl = e.target.closest(".mod-update-btn");
      if (updateBtnEl) {
        e.stopPropagation();
        const currentVersion = getSelectedMinecraftVersion();
        const modid = updateBtnEl.dataset.modid;
        const fileName = updateBtnEl.dataset.filename;
        updateMod(modid, fileName, updateBtnEl, currentVersion);
        return;
      }
      const toggleBtnEl = e.target.closest(".mod-toggle-btn");
      if (toggleBtnEl) {
        e.stopPropagation();
        const currentVersion = getSelectedMinecraftVersion();
        const fileName = toggleBtnEl.dataset.filename;
        const isDisabled = fileName && fileName.endsWith('.disabled');
        toggleMod(fileName, isDisabled, toggleBtnEl, currentVersion);
        return;
      }
      const deleteBtnEl = e.target.closest(".mod-delete-btn");
      if (deleteBtnEl) {
        e.stopPropagation();
        const currentVersion = getSelectedMinecraftVersion();
        deleteMod(deleteBtnEl.dataset.filename, deleteBtnEl, currentVersion);
        return;
      }
      const installBtnEl = e.target.closest(".mod-install-btn");
      if (installBtnEl) {
        e.stopPropagation();
        const currentVersion = getSelectedMinecraftVersion();
        const modCard = installBtnEl.closest(".mod-card");
        const modNameEl = modCard ? modCard.querySelector('.mod-name') : null;
        const modName = modNameEl ? modNameEl.textContent.trim() : '';
        installMod(installBtnEl.dataset.modId, modName, installBtnEl);
        return;
      }
    });
  }

  window.launcher.onLaunchProgress((message) => {
    const normalizedMessage = String(message || "").toLowerCase();
    const isCrash = normalizedMessage.includes("has crashed") || normalizedMessage.includes("exited unexpectedly");
    setStatus(message, isCrash ? "warn" : "info");
    addLog(message, isCrash ? "error" : "info");
  });

  window.launcher.onModDownloadProgress((message) => {
    setModsStatus(message, "info");
    addLog(message, "info");
  });

  document.addEventListener("click", (e) => {
    if (!elements.userInfoBtn.contains(e.target) && !elements.userDropdown.contains(e.target)) {
      elements.userDropdown.classList.add("hidden");
      elements.userInfoBtn.classList.remove("open");
    }
  });

  window.launcher.onAuthStatus((message) => {
    console.log("Renderer: Auth status:", message);
    setStatus(message, "info");
    addLog(`Auth: ${message}`, "info");
  });

  window.launcher.onGameStateChanged((isRunning) => {
    state.isGameRunning = isRunning;
    updateLaunchButton();
    if (isRunning) {
      addLog("Minecraft game started", "success");
    } else {
      addLog("Minecraft game closed", "info");
    }
  });

  window.launcher.onGameLog((data) => {

    addLog(`[GAME] ${data.message}`, data.type);
    const message = (data.message || "").toLowerCase();
    if (message.includes("saved screenshot")) {
      showToast("Saved to screenshot panel", "success");
    }
    
    // Check for account switcher request from mod
    if (data.message && data.message.includes("[TIGER_CLIENT] ACCOUNT_SWITCHER_REQUESTED")) {
      showAccountSwitcher();
    }
  });

  window.launcher.onUpdateStatus((data) => {
    if (!data) return;
    if (data.status === "downloading") {
      const label = data.version ? `Downloading v${data.version}` : "Downloading update...";
      setUpdateStatus("downloading", label);
      showToast(`Downloading update ${data.version ? 'v' + data.version : ''}...`, "info");
    } else if (data.status === "downloaded") {
      const label = data.version ? `Install v${data.version}` : "Install Update";
      setUpdateStatus("downloaded", label);
      showToast(`Update ${data.version ? 'v' + data.version : ''} ready to install!`, "success");
      addLog(`Update downloaded successfully`, "success");
    } else if (data.status === "none") {
      setUpdateStatus("idle");
    } else if (data.status === "error") {
      setUpdateStatus("idle");
      if (data.message) {
        addLog(`Update error: ${data.message}`, "error");
        showToast(`Update failed: ${data.message}`, "error");
      }
    } else if (data.status === "checking") {
      setUpdateStatus("checking", "Checking for updates...");
    }
  });

  window.launcher.onAccountSwitched((data) => {
    if (data && data.user) {
      state.user = data.user;
      updateUserDisplay();
      setStatus(`Switched to ${data.user.name}`, "ok");
    }
  });
};

const init = async () => {
  elements.loginScreen = qs("#login-screen");
  elements.mainApp = qs("#main-app");
  elements.msLogin = qs("#ms-login");
  elements.loginUninstallBtn = qs("#login-uninstall-btn");
  elements.profileVersion = qs("#profile-version");
  elements.launchButton = qs("#launch-game");
  elements.status = qs("#status");
  elements.userName = qs("#user-name");
  elements.userAvatar = qs("#user-avatar");
  elements.userInfoBtn = qs("#user-info-btn");
  elements.userDropdown = qs("#user-dropdown");
  elements.signOutBtn = qs("#sign-out-btn");
  elements.settingsBtn = qs("#settings-btn");
  elements.settingsModal = qs("#settings-modal");
  elements.settingsCloseBtn = qs("#settings-close-btn");
  elements.uninstallBtn = qs("#uninstall-btn");
  elements.altsModal = qs("#alts-modal");
  elements.altsList = qs("#alts-list");
  elements.altsBtn = qs("#alts-btn");
  elements.closeAltsBtn = qs("#close-alts-btn");
  elements.addAltBtn = qs("#add-alt-btn");
  elements.minimizeBtn = qs("#minimize-btn");
  elements.maximizeBtn = qs("#maximize-btn");
  elements.closeBtn = qs("#close-btn");
  elements.updateBtn = qs("#update-btn");
  elements.checkUpdatesBtn = qs("#check-updates-btn");


  console.log("Setting up event listeners...");
  wireEvents();
  setupScreenshotModal();
  setupModDropZone();


  try {
    const versionResult = await window.launcher.getVersion();

    if (versionResult.ok) {
      const currentVersion = versionResult.version;
      const lastKnownVersion = localStorage.getItem('lastKnownVersion');

      if (lastKnownVersion && lastKnownVersion !== currentVersion) {
        setTimeout(() => {
          showToast(`Successfully updated to v${currentVersion}!`, 'success');
          addLog(`App updated from v${lastKnownVersion} to v${currentVersion}`, 'success');
        }, 1500);
      }

      localStorage.setItem('lastKnownVersion', currentVersion);
    }
  } catch (error) {
    console.error('Failed to load version on init:', error);
  }

  const altsData = await window.launcher.getAlts();
  state.alts = altsData || [];

  loadSavedSkins();
  displaySkinLibrary();

  const isAuthenticated = await checkAuth();
  if (isAuthenticated) {
    await populateVersions();
  }

  if (window.launcher.checkUpdates) {
    window.launcher.checkUpdates();
  }
};



window.addEventListener("DOMContentLoaded", init);
