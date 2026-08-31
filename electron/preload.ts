import { contextBridge, ipcRenderer } from "electron";

import type { AppConfig, DesktopApi, OpenCodeStartupProgress } from "../src/types/desktop";
import type { ElectronAuthApi, LicenseStatus } from "../src/types/license";
import { channels } from "./channels";

const api: DesktopApi = {
  stopAgentProcess: () => ipcRenderer.invoke(channels.stopAgentProcess),
  compileExplorerProgram: (program) => ipcRenderer.invoke(channels.compileExplorerProgram, program),
  compileProjectIndexProgram: (program) =>
    ipcRenderer.invoke(channels.compileProjectIndexProgram, program),
  getOpenCodeInfo: () => ipcRenderer.invoke(channels.getOpenCodeInfo),
  onOpenCodeStartupProgress: (listener) => {
    const handleProgress = (_event: Electron.IpcRendererEvent, progress: OpenCodeStartupProgress) =>
      listener(progress);
    ipcRenderer.on(channels.openCodeStartupProgress, handleProgress);
    return () => ipcRenderer.removeListener(channels.openCodeStartupProgress, handleProgress);
  },
  getVersion: () => ipcRenderer.invoke(channels.getVersion),
  openUrl: (url) => ipcRenderer.invoke(channels.openUrl, url),
  loadConfig: () => ipcRenderer.invoke(channels.loadConfig),
  patchConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(channels.patchConfig, patch),
  checkForUpdate: () => ipcRenderer.invoke(channels.checkForUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  invokeExplorerProgram: (artifact) => ipcRenderer.invoke(channels.invokeExplorerProgram, artifact),
  invokeProjectIndexProgram: (artifact) =>
    ipcRenderer.invoke(channels.invokeProjectIndexProgram, artifact),
  relaunch: () => ipcRenderer.invoke(channels.relaunch),
  installStudioTargetPrograms: (envelopes) =>
    ipcRenderer.invoke(channels.installStudioTargetPrograms, envelopes),
  discoverStudioTargets: (programs) => ipcRenderer.invoke(channels.discoverStudioTargets, programs),
  selectStudioTarget: (programs, targetKey) =>
    ipcRenderer.invoke(channels.selectStudioTarget, programs, targetKey),
  // ── Rojo live-sync ────────────────────────────────────────────────
  rojoStart: (workspace) => ipcRenderer.invoke(channels.rojoStart, workspace),
  rojoStop: () => ipcRenderer.invoke(channels.rojoStop),
  rojoStatus: () => ipcRenderer.invoke(channels.rojoStatus),
  rojoToggle: (workspace) => ipcRenderer.invoke(channels.rojoToggle, workspace),
  rojoStartForSession: (sessionId) => ipcRenderer.invoke(channels.rojoStartSession, sessionId),
  rojoToggleForSession: (sessionId) => ipcRenderer.invoke(channels.rojoToggleSession, sessionId),
  rojoLogs: () => ipcRenderer.invoke(channels.rojoLogs),
  onRojoLog: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      entry: { timestamp: number; stream: string; message: string },
    ) => listener(entry as { timestamp: number; stream: "stdout" | "stderr"; message: string });
    ipcRenderer.on(channels.onRojoLog, handler);
    return () => ipcRenderer.removeListener(channels.onRojoLog, handler);
  },
  rojoSetup: async (onProgress) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: { phase: string; percent?: number; message: string },
    ) =>
      onProgress(
        progress as {
          phase:
            | "release-lookup"
            | "binary-download"
            | "binary-extract"
            | "plugin-download"
            | "plugin-install"
            | "done";
          percent?: number;
          message: string;
        },
      );
    ipcRenderer.on(channels.rojoSetupProgress, handler);
    try {
      return await ipcRenderer.invoke(channels.rojoSetup);
    } finally {
      ipcRenderer.removeListener(channels.rojoSetupProgress, handler);
    }
  },
  rojoBinaryPath: () => ipcRenderer.invoke(channels.rojoBinaryPath),
  rojoCheckInstalled: () => ipcRenderer.invoke(channels.rojoCheckInstalled),
  // ── Session workspaces ────────────────────────────────────────────────
  prepareSessionWorkspace: (sessionId) =>
    ipcRenderer.invoke(channels.prepareSessionWorkspace, sessionId),
  openSessionWorkspace: (sessionId) => ipcRenderer.invoke(channels.openSessionWorkspace, sessionId),
  // ── Session transcript persistence ─────────────────────────────────────
  sessionStoreList: () => ipcRenderer.invoke(channels.sessionStoreList),
  sessionStoreGet: (id) => ipcRenderer.invoke(channels.sessionStoreGet, id),
  sessionStoreSave: (session) => ipcRenderer.invoke(channels.sessionStoreSave, session),
  sessionStoreDelete: (id) => ipcRenderer.invoke(channels.sessionStoreDelete, id),
  sessionStoreSetLastActive: (id) => ipcRenderer.invoke(channels.sessionStoreSetLastActive, id),
  sessionStoreGetLastActive: () => ipcRenderer.invoke(channels.sessionStoreGetLastActive),
  // ── Project Memory ───────────────────────────────────────────────────
  memorySearch: (query: string, k?: number) => ipcRenderer.invoke(channels.memorySearch, query, k),
  memoryStats: () => ipcRenderer.invoke(channels.memoryStats),
  memoryReindex: () => ipcRenderer.invoke(channels.memoryReindex),
  memoryUpsert: (path: string, source: string) => ipcRenderer.invoke(channels.memoryUpsert, path, source),
  // ── Window controls ─────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke(channels.windowMinimize),
  windowMaximizeToggle: () => ipcRenderer.invoke(channels.windowMaximizeToggle),
  windowClose: () => ipcRenderer.invoke(channels.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(channels.windowIsMaximized),
  onWindowMaximizedChange: (listener) => {
    const handleMaximized = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      listener(maximized);
    ipcRenderer.on(channels.onWindowMaximizedChange, handleMaximized);
    return () => ipcRenderer.removeListener(channels.onWindowMaximizedChange, handleMaximized);
  },
};

contextBridge.exposeInMainWorld("BloxMind", api);

const authApi: ElectronAuthApi = {
  loginWithRoblox: () => ipcRenderer.invoke(channels.authLogin),
  getLicenseStatus: () => ipcRenderer.invoke(channels.authStatus),
  logout: () => ipcRenderer.invoke(channels.authLogout),
  onStatusChanged: (listener) => {
    const handleStatus = (_event: Electron.IpcRendererEvent, status: LicenseStatus) =>
      listener(status);
    ipcRenderer.on(channels.authStatusChanged, handleStatus);
    return () => ipcRenderer.removeListener(channels.authStatusChanged, handleStatus);
  },
};

contextBridge.exposeInMainWorld("electron", {
  auth: authApi,
  stopAgentProcess: () => ipcRenderer.invoke(channels.stopAgentProcess),
});
