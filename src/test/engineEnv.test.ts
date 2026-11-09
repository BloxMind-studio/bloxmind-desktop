import { describe, expect, it } from "vitest";
import { buildEngineEnv } from "../../electron/services/engineEnv";

const base = {
  xdgCache: "C:/ws/.opencode/cache",
  xdgConfig: "C:/ws/.opencode/config",
  xdgData: "C:/ws/.opencode/data",
  xdgState: "C:/ws/.opencode/state",
  serverPassword: "engine-password",
  serverUsername: "opencode",
};

describe("buildEngineEnv", () => {
  it("keeps only the whitelisted variables and pins the engine's own", () => {
    const env = buildEngineEnv(
      {
        PATH: "C:/Windows/System32",
        SystemRoot: "C:/Windows",
        COMSPEC: "C:/Windows/System32/cmd.exe",
        HOME: "C:/Users/alice",
        USERPROFILE: "C:/Users/alice",
        TEMP: "C:/Temp",
        NODE_OPTIONS: "--trace-warnings",
        OPENAI_API_KEY: "sk-secret",
        OPENCODE_CONFIG_CONTENT: '{"provider":{}}',
        MY_SECRET_TOKEN: "hunter2",
      },
      base,
    );

    expect(env.SystemRoot).toBe("C:/Windows");
    expect(env.COMSPEC).toBe("C:/Windows/System32/cmd.exe");
    expect(env.PATH).toBe("C:/Windows/System32");
    expect(env.HOME).toBe("C:/Users/alice");
    expect(env.TEMP).toBe("C:/Temp");
    expect(env.XDG_CACHE_HOME).toBe("C:/ws/.opencode/cache");
    expect(env.XDG_CONFIG_HOME).toBe("C:/ws/.opencode/config");
    expect(env.XDG_DATA_HOME).toBe("C:/ws/.opencode/data");
    expect(env.XDG_STATE_HOME).toBe("C:/ws/.opencode/state");
    expect(env.OPENCODE_SERVER_PASSWORD).toBe("engine-password");
    expect(env.OPENCODE_SERVER_USERNAME).toBe("opencode");
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");

    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(env.MY_SECRET_TOKEN).toBeUndefined();
  });

  it("prefers the shell-derived PATH over the inherited one", () => {
    const env = buildEngineEnv(
      { PATH: "/usr/bin" },
      { ...base, shellPath: "/usr/local/bin:/usr/bin" },
    );
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("never lets the user override the engine's own pins", () => {
    const env = buildEngineEnv(
      {
        XDG_CONFIG_HOME: "/home/alice/.config",
        OPENCODE_DISABLE_PROJECT_CONFIG: "0",
        OPENCODE_SERVER_PASSWORD: "forged",
      },
      base,
    );
    expect(env.XDG_CONFIG_HOME).toBe("C:/ws/.opencode/config");
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_SERVER_PASSWORD).toBe("engine-password");
  });
});
