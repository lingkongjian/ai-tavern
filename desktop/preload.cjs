/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiTavernDesktop", {
  quit() {
    ipcRenderer.send("ai-tavern:quit");
  },
});
