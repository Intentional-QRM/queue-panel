const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  screen,
  ipcMain,
  shell,
  dialog
} = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { createModalOperationGuard } = require("./modal-operation-guard");

let tray = null;
let panel = null;
const modalOperationGuard = createModalOperationGuard(() => panel);

let trayMenuState = {
  currentParkId: null,
  parks: []
};

let panelBottomY = null;

const PANEL_WIDTH = 340;
const PANEL_BASE_HEIGHT = 510;
const MIN_PANEL_HEIGHT = 100;
const MAX_TRAY_PARKS = 100;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

function isPanelSender(event) {
  return panel && !panel.isDestroyed() && event.sender === panel.webContents;
}

function isAllowedExternalUrl(value) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "queue-times.com") return true;

    return (
      url.hostname === "github.com" &&
      (url.pathname === "/Intentional-QRM/queue-panel" ||
        url.pathname.startsWith("/Intentional-QRM/queue-panel/"))
    );
  } catch {
    return false;
  }
}

function normalizeTrayMenuData(data) {
  if (!data || typeof data !== "object") {
    return { currentParkId: null, parks: [] };
  }

  const parks = Array.isArray(data.parks)
    ? data.parks
        .slice(0, MAX_TRAY_PARKS)
        .filter((park) =>
          park &&
          (typeof park.id === "string" || Number.isFinite(park.id)) &&
          typeof park.name === "string" &&
          park.name.trim()
        )
        .map((park) => ({
          id: String(park.id),
          name: park.name.trim().slice(0, 200)
        }))
    : [];

  const requestedCurrentParkId =
    typeof data.currentParkId === "string" || Number.isFinite(data.currentParkId)
      ? String(data.currentParkId)
      : null;

  return {
    currentParkId: parks.some((park) => park.id === requestedCurrentParkId)
      ? requestedCurrentParkId
      : null,
    parks
  };
}

function createPanelWindow() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;

  panelBottomY = workArea.y + workArea.height - 8;

  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_BASE_HEIGHT,
    x: Math.min(cursor.x - PANEL_WIDTH, workArea.x + workArea.width - PANEL_WIDTH - 8),
    y: panelBottomY - PANEL_BASE_HEIGHT,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  panel.loadFile(path.join(__dirname, "panel.html"));

  panel.on("blur", () => {
    if (
      modalOperationGuard.shouldAutoHide() &&
      panel &&
      !panel.isDestroyed()
    ) {
      panel.hide();
    }
  });
}

function createPanel() {
  if (panel && !panel.isDestroyed()) {
    if (panel.isVisible()) {
      panel.hide();
    } else {
      panel.show();
      panel.focus();
    }
    return;
  }

  createPanelWindow();
}

function showPanel() {
  if (!panel || panel.isDestroyed()) {
    createPanelWindow();
  }

  panel.show();
  panel.focus();
}

function showPanelPage(page) {
  showPanel();

  const sendPage = () => {
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send("show-page", page);
    }
  };

  if (panel.webContents.isLoading()) {
    panel.webContents.once("did-finish-load", sendPage);
  } else {
    sendPage();
  }
}

ipcMain.on("resize-panel", (event, requestedHeight) => {
  if (!isPanelSender(event)) return;
  if (!panel || panel.isDestroyed()) return;
  if (panelBottomY === null) return;
  if (!Number.isFinite(requestedHeight)) return;

  const currentBounds = panel.getBounds();
  const workArea = screen.getDisplayMatching(currentBounds).workArea;
  const height = Math.min(
    Math.max(Math.round(requestedHeight), MIN_PANEL_HEIGHT),
    workArea.height
  );

  if (
    currentBounds.height !== height ||
    currentBounds.y !== panelBottomY - height
  ) {
    panel.setBounds({
      x: currentBounds.x,
      y: panelBottomY - height,
      width: PANEL_WIDTH,
      height
    });
  }

  if (!panel.isVisible()) {
    panel.show();
  }
});

ipcMain.on("open-external", (event, url) => {
  if (!isPanelSender(event) || !isAllowedExternalUrl(url)) return;

  shell.openExternal(url);
});

ipcMain.on("update-tray-menu", (event, data) => {
  if (!isPanelSender(event)) return;
  trayMenuState = normalizeTrayMenuData(data);

  rebuildTrayMenu();
});

ipcMain.handle("export-backup", async (event, data) => {
  if (!isPanelSender(event)) return { canceled: true };
  if (
    !data ||
    typeof data.content !== "string" ||
    Buffer.byteLength(data.content, "utf8") > MAX_BACKUP_BYTES
  ) {
    throw new Error("Invalid backup data");
  }

  const suggestedName =
    typeof data.fileName === "string" &&
    /^QueuePanel_Backup_\d{4}-\d{2}-\d{2}(?:_[\d-]+)?\.json$/.test(data.fileName)
      ? data.fileName
      : "QueuePanel_Backup.json";
  return modalOperationGuard.run(async () => {
    const result = await dialog.showSaveDialog(panel, {
      title: "Export Queue Panel Data",
      defaultPath: path.join(app.getPath("downloads"), suggestedName),
      filters: [{ name: "JSON files", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    await fs.writeFile(result.filePath, data.content, "utf8");
    return {
      canceled: false,
      filePath: result.filePath,
      fileName: path.basename(result.filePath)
    };
  });
});

ipcMain.handle("import-backup", async (event) => {
  if (!isPanelSender(event)) return { canceled: true };

  return modalOperationGuard.run(async () => {
    const result = await dialog.showOpenDialog(panel, {
      title: "Import Queue Panel Data",
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }]
    });

    if (result.canceled || result.filePaths.length !== 1) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const file = await fs.readFile(filePath);
    if (file.length > MAX_BACKUP_BYTES) {
      throw new Error("Backup file is too large");
    }

    return {
      canceled: false,
      content: file.toString("utf8"),
      fileName: path.basename(filePath)
    };
  });
});

function rebuildTrayMenu() {
  if (!tray) return;

  const parkItems = trayMenuState.parks.length
    ? trayMenuState.parks.map((park) => ({
        label: park.name,
        type: "checkbox",
        checked: String(park.id) === String(trayMenuState.currentParkId),
        click: () => {
          createPanel();
          if (panel && !panel.isDestroyed()) {
            panel.webContents.send("go-to-park", park.id);
          }
        }
      }))
    : [
        {
          label: "No favorite parks",
          enabled: false
        }
      ];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Queue Panel",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Show Queue Panel",
      click: showPanel
    },
    {
      label: "Go to Park",
      submenu: parkItems
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => showPanelPage("settings")
    },
    {
      label: "About",
      click: () => showPanelPage("about")
    },
    { type: "separator" },
    {
      label: "Reset Panel",
      click: () => {
        if (panel && !panel.isDestroyed()) {
          panel.close();
          panel = null;
        }
        createPanel();
      }
    },
    {
      label: "Open Queue-Times.com",
      click: () => {
        shell.openExternal("https://queue-times.com");
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");

  tray = new Tray(iconPath);
  tray.setToolTip("Queue Panel (Powered by Queue-Times.com)");

  tray.on("click", createPanel);

  rebuildTrayMenu();
}

app.whenReady().then(createTray);

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
