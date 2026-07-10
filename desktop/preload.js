const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  resizePanel: (height) => ipcRenderer.send("resize-panel", height),
  openExternal: (url) => ipcRenderer.send("open-external", url),

  updateTrayMenu: (data) => ipcRenderer.send("update-tray-menu", data),

  onGoToPark: (callback) => {
    ipcRenderer.on("go-to-park", (event, parkId) => callback(parkId));
  },

  onShowPage: (callback) => {
    ipcRenderer.on("show-page", (event, page) => callback(page));
  }
});
