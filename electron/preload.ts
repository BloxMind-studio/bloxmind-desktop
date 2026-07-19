import { contextBridge, ipcRenderer } from "electron";

import type { AppConfig, DesktopApi } from "../src/types/desktop";
import { channels } from "./channels";

const api: DesktopApi = {
  getOpenCodeInfo: () => ipcRenderer.invoke(channels.getOpenCodeInfo),
  getVersion: () => ipcRenderer.invoke(channels.getVersion),
  openUrl: (url) => ipcRenderer.invoke(channels.openUrl, url),
  loadConfig: () => ipcRenderer.invoke(channels.loadConfig),
  patchConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(channels.patchConfig, patch),
  checkForUpdate: () => ipcRenderer.invoke(channels.checkForUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  relaunch: () => ipcRenderer.invoke(channels.relaunch),
};

contextBridge.exposeInMainWorld("bloxbot", api);
