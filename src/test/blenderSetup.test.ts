import { delimiter, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  addonModuleName,
  type BlenderSetupEnvironment,
  blenderConfigBase,
  buildEnableAddonScript,
  findBlenderExecutables,
  findUvx,
  parseBlenderVersion,
  runBlenderSetup,
  safeToSavePrefs,
  uvAssetName,
} from "../../electron/services/BlenderSetup";

type Entry = "file" | "dir";

interface Harness {
  environment: BlenderSetupEnvironment;
  files: Map<string, Entry>;
  run: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  fetchFn: ReturnType<typeof vi.fn>;
}

interface HarnessOptions {
  platform?: NodeJS.Platform;
  files?: Record<string, Entry>;
  home?: string;
  pathDirectories?: string[];
  run?: (command: string, args: string[]) => { code: number; stdout: string; stderr: string };
  blenderRunning?: boolean;
  onRun?: (command: string, args: string[], files: Map<string, Entry>) => void;
}

function harness(options: HarnessOptions = {}): Harness {
  const platform = options.platform ?? "win32";
  const files = new Map<string, Entry>(Object.entries(options.files ?? {}));
  const pathDirectories = options.pathDirectories ?? [];
  const run = vi.fn(async (command: string, args: string[]) => {
    options.onRun?.(command, args, files);
    return options.run?.(command, args) ?? { code: 0, stdout: "", stderr: "" };
  });
  const launch = vi.fn(async () => {});
  const fetchFn = vi.fn(async () => {
    throw new Error("fetch should not be called");
  });
  const environment: BlenderSetupEnvironment = {
    platform,
    arch: "x64",
    env: {
      PATH: pathDirectories.join(delimiter),
      APPDATA: join("C:", "Users", "Ali", "AppData", "Roaming"),
      ProgramFiles: join("C:", "Program Files"),
      "ProgramFiles(x86)": join("C:", "Program Files (x86)"),
    },
    home: options.home ?? join("C:", "Users", "Ali"),
    cacheDirectory: join("C:", "Users", "Ali", "AppData", "Roaming", "BloxMind", "blender"),
    fetchFn: fetchFn as unknown as typeof fetch,
    run,
    pathExists: async (path) => files.has(path),
    isDirectory: async (path) => files.get(path) === "dir",
    readDirectory: async (path) => {
      const prefix = path.replace(/[\\/]+$/, "");
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length).replace(/^[\\/]+/, "");
        if (rest === "") continue;
        names.add(rest.split(/[\\/]/)[0]);
      }
      return [...names];
    },
    blenderRunning: async () => options.blenderRunning ?? false,
    launch,
    log: () => {},
  };
  return { environment, files, run, launch, fetchFn };
}

/** The standard Windows machine: uvx on PATH, Blender 4.5 installed with saved prefs. */
function windowsMachine(overrides: HarnessOptions = {}): Harness {
  const uvx = join("C:", "Users", "Ali", ".local", "bin", "uvx.exe");
  const bin = join("C:", "Users", "Ali", ".local", "bin");
  const blenderExe = join(
    "C:",
    "Program Files",
    "Blender Foundation",
    "Blender 4.5",
    "blender.exe",
  );
  const base = join("C:", "Users", "Ali", "AppData", "Roaming", "Blender Foundation", "Blender");
  const versionDir = join(base, "4.5");
  const addonsDirectory = join(versionDir, "scripts", "addons");
  return harness({
    files: {
      [uvx]: "file",
      [join("C:", "Program Files", "Blender Foundation")]: "dir",
      [join("C:", "Program Files", "Blender Foundation", "Blender 4.5")]: "dir",
      [blenderExe]: "file",
      [base]: "dir",
      [versionDir]: "dir",
      [join(versionDir, "config")]: "dir",
      [join(versionDir, "config", "userpref.blend")]: "file",
    },
    pathDirectories: [bin],
    run: (_command, args) => {
      if (args.includes("--version")) return { code: 0, stdout: "Blender 4.5.3\n", stderr: "" };
      if (args.includes("install-addon")) {
        return { code: 0, stdout: "Installed addon\n", stderr: "" };
      }
      if (args.includes("--python-expr")) {
        return {
          code: 0,
          stdout: 'BLOXMIND_ADDON_RESULT {"already": [], "enabled": true, "error": null}\n',
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    onRun: (_command, args, files) => {
      if (args.includes("install-addon")) {
        files.set(join(addonsDirectory, "blender_mcp.py"), "file");
      }
    },
    ...overrides,
  });
}

describe("uvAssetName", () => {
  it("maps supported platforms to uv release assets", () => {
    expect(uvAssetName("win32", "x64")).toBe("uv-x86_64-pc-windows-msvc.zip");
    expect(uvAssetName("win32", "arm64")).toBe("uv-aarch64-pc-windows-msvc.zip");
    expect(uvAssetName("darwin", "arm64")).toBe("uv-aarch64-apple-darwin.tar.gz");
    expect(uvAssetName("darwin", "x64")).toBe("uv-x86_64-apple-darwin.tar.gz");
    expect(uvAssetName("linux", "x64")).toBe("uv-x86_64-unknown-linux-gnu.tar.gz");
    expect(uvAssetName("linux", "arm64")).toBe("uv-aarch64-unknown-linux-gnu.tar.gz");
  });

  it("returns null where uv ships nothing", () => {
    expect(uvAssetName("win32", "ia32")).toBeNull();
    expect(uvAssetName("freebsd", "x64")).toBeNull();
  });
});

describe("findUvx", () => {
  it("finds uvx on PATH", async () => {
    // No drive letter: ":" would split the fake PATH on POSIX test runners.
    const bin = join("tools", "bin");
    const uvx = join(bin, "uvx.exe");
    const found = await findUvx("win32", { PATH: bin }, "home", (path) =>
      Promise.resolve(path === uvx),
    );
    expect(found).toBe(uvx);
  });

  it("falls back to uv's installer locations", async () => {
    const home = "C:\\Users\\Ali";
    const uvx = join(home, ".local", "bin", "uvx.exe");
    const found = await findUvx("win32", { PATH: "" }, home, (path) =>
      Promise.resolve(path === uvx),
    );
    expect(found).toBe(uvx);
  });

  it("returns null when uvx is nowhere", async () => {
    expect(
      await findUvx("win32", { PATH: "" }, "C:\\Users\\Ali", () => Promise.resolve(false)),
    ).toBeNull();
  });
});

describe("blenderConfigBase", () => {
  it("follows each platform's conventions", () => {
    expect(blenderConfigBase("win32", { APPDATA: "C:\\Roaming" }, "C:\\Users\\Ali")).toBe(
      join("C:\\Roaming", "Blender Foundation", "Blender"),
    );
    expect(blenderConfigBase("darwin", {}, "/Users/Ali")).toBe(
      join("/Users/Ali", "Library", "Application Support", "Blender"),
    );
    expect(blenderConfigBase("linux", {}, "/home/ali")).toBe(
      join("/home/ali", ".config", "blender"),
    );
    expect(blenderConfigBase("win32", {}, "C:\\Users\\Ali")).toBeNull();
  });
});

describe("findBlenderExecutables", () => {
  it("lists Windows installs newest first", async () => {
    const machine = windowsMachine();
    machine.files.set(
      join("C:", "Program Files", "Blender Foundation", "Blender 4.4", "blender.exe"),
      "file",
    );
    machine.files.set(join("C:", "Program Files", "Blender Foundation", "Blender 4.4"), "dir");
    const found = await findBlenderExecutables(machine.environment);
    expect(found).toEqual([
      join("C:", "Program Files", "Blender Foundation", "Blender 4.5", "blender.exe"),
      join("C:", "Program Files", "Blender Foundation", "Blender 4.4", "blender.exe"),
    ]);
  });

  it("returns an empty list when Blender is absent", async () => {
    const machine = harness({ files: {} });
    expect(await findBlenderExecutables(machine.environment)).toEqual([]);
  });
});

describe("parseBlenderVersion", () => {
  it("reads the major and minor version", () => {
    expect(parseBlenderVersion("Blender 4.5.3\nbuild date 2025-09-05")).toBe("4.5");
    expect(parseBlenderVersion("Blender 5.2")).toBe("5.2");
  });

  it("returns null for unrelated output", () => {
    expect(parseBlenderVersion("Segmentation fault")).toBeNull();
  });
});

describe("addonModuleName", () => {
  it("uses the file stem inside scripts/addons", () => {
    expect(addonModuleName(join("base", "4.5", "scripts", "addons", "blender_mcp.py"))).toBe(
      "blender_mcp",
    );
  });

  it("uses the extension namespace inside extensions", () => {
    expect(addonModuleName(join("base", "extensions", "user_default", "blender_mcp.py"))).toBe(
      "bl_ext.user_default.blender_mcp",
    );
  });
});

describe("safeToSavePrefs", () => {
  it("is safe when preferences already exist", async () => {
    const machine = windowsMachine();
    const base = join("C:", "Users", "Ali", "AppData", "Roaming", "Blender Foundation", "Blender");
    expect(await safeToSavePrefs(machine.environment, base, "4.5")).toBe(true);
  });

  it("is safe for a first-ever install", async () => {
    const machine = harness({ files: {} });
    expect(await safeToSavePrefs(machine.environment, "C:\\base", "4.5")).toBe(true);
  });

  it("protects the settings-migration prompt when other versions exist", async () => {
    const base = "C:\\base";
    const machine = harness({ files: { [join(base, "4.4")]: "dir", [join(base, "4.5")]: "dir" } });
    expect(await safeToSavePrefs(machine.environment, base, "4.5")).toBe(false);
  });
});

describe("buildEnableAddonScript", () => {
  it("takes the module after -- and prints the result marker", () => {
    const script = buildEnableAddonScript();
    expect(script).toContain('sys.argv[sys.argv.index("--") + 1]');
    expect(script).toContain("BLOXMIND_ADDON_RESULT ");
    expect(script).toContain("save_userpref");
  });
});

describe("runBlenderSetup", () => {
  it("installs and enables the addon, then opens Blender", async () => {
    const machine = windowsMachine();
    const result = await runBlenderSetup(machine.environment);

    expect(result).toMatchObject({
      ok: true,
      addon: "enabled",
      launched: true,
      blenderRunning: false,
      blenderVersion: "4.5",
      detail: "Blender is set up and opening now.",
    });
    expect(result.uvxPath).toBe(join("C:", "Users", "Ali", ".local", "bin", "uvx.exe"));

    const installCall = machine.run.mock.calls.find(([, args]) =>
      (args as string[]).includes("install-addon"),
    );
    expect(installCall).toBeDefined();
    const [installCommand, installArgs, installOptions] = installCall as [
      string,
      string[],
      { env?: Record<string, string> },
    ];
    expect(installCommand).toBe(result.uvxPath);
    expect(installArgs).toEqual([
      "--refresh-package",
      "mcp-for-blender",
      "--no-progress",
      "mcp-for-blender@latest",
      "install-addon",
      "--addons-dir",
      join(
        "C:",
        "Users",
        "Ali",
        "AppData",
        "Roaming",
        "Blender Foundation",
        "Blender",
        "4.5",
        "scripts",
        "addons",
      ),
    ]);
    expect(installOptions.env?.PYTHONIOENCODING).toBe("utf-8");

    const enableCall = machine.run.mock.calls.find(([, args]) =>
      (args as string[]).includes("--python-expr"),
    );
    expect(enableCall).toBeDefined();
    expect((enableCall as [string, string[]])[1].at(-1)).toBe("blender_mcp");
    expect(machine.launch).toHaveBeenCalledWith(
      join("C:", "Program Files", "Blender Foundation", "Blender 4.5", "blender.exe"),
    );
    expect(result.steps).toContain("Found Blender 4.5");
  });

  it("uses uvx from BloxMind's cache without downloading", async () => {
    const cachedUvx = join(
      "C:",
      "Users",
      "Ali",
      "AppData",
      "Roaming",
      "BloxMind",
      "blender",
      "uv",
      "0.13.1",
      "uvx.exe",
    );
    const machine = windowsMachine();
    machine.files.delete(join("C:", "Users", "Ali", ".local", "bin", "uvx.exe"));
    machine.files.set(cachedUvx, "file");
    machine.environment.env.PATH = "";
    const result = await runBlenderSetup(machine.environment);
    expect(result.uvxPath).toBe(cachedUvx);
    expect(machine.fetchFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("reports a friendly failure when uv can't be installed", async () => {
    const machine = harness({ files: {} });
    machine.fetchFn.mockImplementation(async () => ({ ok: false }));
    const result = await runBlenderSetup(machine.environment);
    expect(result.ok).toBe(false);
    expect(result.uvxPath).toBeNull();
    expect(result.detail).toContain("uv");
    expect(machine.run).not.toHaveBeenCalled();
  });

  it("asks the user to install Blender when none is found", async () => {
    const machine = windowsMachine();
    for (const key of [...machine.files.keys()]) {
      if (key.includes("Blender Foundation")) machine.files.delete(key);
    }
    const result = await runBlenderSetup(machine.environment);
    expect(result.ok).toBe(false);
    expect(result.uvxPath).not.toBeNull();
    expect(result.detail).toContain("blender.org");
    expect(machine.run).not.toHaveBeenCalled();
  });

  it("asks the user to quit and retry when Blender is already open", async () => {
    const machine = windowsMachine({ blenderRunning: true });
    const result = await runBlenderSetup(machine.environment);
    expect(result).toMatchObject({
      ok: true,
      addon: "needs_blender_open",
      launched: false,
      blenderRunning: true,
    });
    expect(result.detail).toContain("Quit Blender");
    expect(machine.launch).not.toHaveBeenCalled();
  });

  it("falls back to manual enabling when Blender refuses to enable the addon", async () => {
    const machine = windowsMachine({
      run: (_command, args) => {
        if (args.includes("--version")) return { code: 0, stdout: "Blender 4.5.3\n", stderr: "" };
        if (args.includes("install-addon")) return { code: 0, stdout: "", stderr: "" };
        if (args.includes("--python-expr")) {
          return {
            code: 0,
            stdout: 'BLOXMIND_ADDON_RESULT {"already": [], "enabled": false, "error": "boom"}\n',
            stderr: "",
          };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const result = await runBlenderSetup(machine.environment);
    expect(result).toMatchObject({ ok: true, addon: "manual_enable" });
    expect(result.detail).toContain("Preferences");
  });

  it("skips the headless enable when preferences are unsafe to write", async () => {
    const machine = windowsMachine();
    const base = join("C:", "Users", "Ali", "AppData", "Roaming", "Blender Foundation", "Blender");
    machine.files.delete(join(base, "4.5", "config", "userpref.blend"));
    machine.files.set(join(base, "4.4"), "dir");
    const result = await runBlenderSetup(machine.environment);
    expect(result).toMatchObject({ ok: true, addon: "manual_enable" });
    const enableCall = machine.run.mock.calls.find(([, args]) =>
      (args as string[]).includes("--python-expr"),
    );
    expect(enableCall).toBeUndefined();
  });

  it("treats a nonzero installer exit as success when the addon file landed", async () => {
    const machine = windowsMachine({
      run: (_command, args) => {
        if (args.includes("--version")) return { code: 0, stdout: "Blender 4.5.3\n", stderr: "" };
        if (args.includes("install-addon")) {
          return { code: 1, stdout: "", stderr: "UnicodeEncodeError" };
        }
        return {
          code: 0,
          stdout: 'BLOXMIND_ADDON_RESULT {"already": [], "enabled": true, "error": null}\n',
          stderr: "",
        };
      },
    });
    const result = await runBlenderSetup(machine.environment);
    expect(result).toMatchObject({ ok: true, addon: "enabled" });
  });
});
