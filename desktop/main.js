const { app, Tray, Menu, BrowserWindow, screen, ipcMain, shell } = require("electron");
const path = require("path");

let tray = null;
let panel = null;

let trayMenuState = {
  currentParkId: null,
  parks: []
};

let panelBottomY = null;

const PANEL_WIDTH = 340;
const PANEL_BASE_HEIGHT = 510;

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
    if (panel && !panel.isDestroyed()) {
      panel.hide();
    }
  });
}

ipcMain.on("resize-panel", (event, requestedHeight) => {
  if (!panel || panel.isDestroyed()) return;
  if (panelBottomY === null) return;

  const currentBounds = panel.getBounds();

  if (
    currentBounds.height !== requestedHeight ||
    currentBounds.y !== panelBottomY - requestedHeight
  ) {
    panel.setBounds({
      x: currentBounds.x,
      y: panelBottomY - requestedHeight,
      width: PANEL_WIDTH,
      height: requestedHeight
    });
  }

  if (!panel.isVisible()) {
    panel.show();
  }
});

ipcMain.on("open-external", (event, url) => {
  if (!url || typeof url !== "string") return;

  if (!url.startsWith("https://queue-times.com")) return;

  shell.openExternal(url);
});

ipcMain.on("update-tray-menu", (event, data) => {
  trayMenuState = {
    currentParkId: data?.currentParkId || null,
    parks: Array.isArray(data?.parks) ? data.parks : []
  };

  rebuildTrayMenu();
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
      label: "Open Queue Panel",
      click: createPanel
    },
    {
      label: "Go to Park",
      submenu: parkItems
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
