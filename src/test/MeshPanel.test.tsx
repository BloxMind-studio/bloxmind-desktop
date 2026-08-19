import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import MeshPanel from "@/components/MeshPanel";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { qk } from "@/lib/queryKeys";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js/dist/module.full.no-external.js", () => ({
  default: { capture },
}));

function Harness({
  client,
  onClose = vi.fn(),
}: {
  client: Record<string, unknown>;
  onClose?: () => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(qk.config, {
    lastModel: "anthropic/claude",
    hiddenModels: [],
    theme: "system",
    detailedAnalytics: "disabled",
  });
  const activeSessionIdRef = useRef<string | null>("active");
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <OpenCodeClientContext.Provider
          value={{
            client: client as never,
            status: "ready",
            port: 1,
            ready: true,
            initError: null,
            sseConnected: true,
            sseFailureCount: 0,
          }}
        >
          <ActiveSessionContext.Provider
            value={{
              activeSessionId: "active",
              activeSessionIdRef,
              selectSession: async () => {},
              clearSession: () => {},
            }}
          >
            <PreferencesProvider>
              <MeshPanel onClose={onClose} />
              <Toaster />
            </PreferencesProvider>
          </ActiveSessionContext.Provider>
        </OpenCodeClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe("MeshPanel", () => {
  it("sends a timeout-safe generate_mesh prompt and closes", async () => {
    const onClose = vi.fn();
    const client = { session: { promptAsync: vi.fn().mockResolvedValue({}) } };
    render(<Harness client={client} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Mesh description"), {
      target: { value: "a cute green alien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate mesh" }));
    expect(capture).toHaveBeenCalledWith("mesh_generation_started", {
      analytics_schema_version: 1,
      feature: "mesh",
    });
    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalledOnce());
    const text = client.session.promptAsync.mock.calls[0][0].parts[0].text as string;
    expect(text).toContain("a cute green alien");
    expect(text).toContain("-32001");
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks generation without a description", async () => {
    const client = { session: { promptAsync: vi.fn() } };
    render(<Harness client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate mesh" }));
    expect(await screen.findByText("Describe the mesh before generating it.")).toBeInTheDocument();
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("enhances the brief through a tool-disabled temporary session", async () => {
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "enhancer" } }),
        prompt: vi.fn().mockResolvedValue({
          data: {
            info: {
              structured: {
                description: "A glossy green alien with an oversized black-eyed head",
              },
            },
          },
        }),
        delete: vi.fn().mockResolvedValue({}),
        promptAsync: vi.fn(),
      },
    };
    render(<Harness client={client} />);
    fireEvent.change(screen.getByLabelText("Mesh description"), { target: { value: "alien" } });
    fireEvent.click(screen.getByRole("button", { name: /Enhance with AI/ }));
    expect(capture).toHaveBeenCalledWith("mesh_enhance_started", {
      analytics_schema_version: 1,
      feature: "mesh",
    });
    expect(
      await screen.findByDisplayValue("A glossy green alien with an oversized black-eyed head"),
    ).toBeInTheDocument();
    expect(client.session.create.mock.calls[0][0].permission).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
    ]);
    expect(client.session.prompt.mock.calls[0][0].format).toMatchObject({
      type: "json_schema",
    });
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: "enhancer" });
  });

  it("recovers when the model skips structured output and answers in text", async () => {
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "enhancer" } }),
        prompt: vi.fn().mockResolvedValue({
          data: {
            info: { error: { name: "StructuredOutputError", data: { message: "no schema" } } },
            parts: [
              {
                type: "text",
                text: '{"description": "A blocky alien with stubby arms"}',
              },
            ],
          },
        }),
        delete: vi.fn().mockResolvedValue({}),
        promptAsync: vi.fn(),
      },
    };
    render(<Harness client={client} />);
    fireEvent.change(screen.getByLabelText("Mesh description"), { target: { value: "alien" } });
    fireEvent.click(screen.getByRole("button", { name: /Enhance with AI/ }));
    expect(await screen.findByDisplayValue("A blocky alien with stubby arms")).toBeInTheDocument();
  });

  it("cleans leaked <structured_output> tags and renamed keys before filling the textarea", async () => {
    const wrapped =
      '<structured_output>\n{\n  "prompt": "A sleek crimson sports car."\n}\n</structured_output>';
    const client = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "enhancer" } }),
        prompt: vi.fn().mockResolvedValue({
          data: {
            info: {},
            parts: [{ type: "text", text: wrapped }],
          },
        }),
        delete: vi.fn().mockResolvedValue({}),
        promptAsync: vi.fn(),
      },
    };
    render(<Harness client={client} />);
    fireEvent.change(screen.getByLabelText("Mesh description"), { target: { value: "car" } });
    fireEvent.click(screen.getByRole("button", { name: /Enhance with AI/ }));
    const textarea = await screen.findByDisplayValue("A sleek crimson sports car.");
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).not.toContain("structured_output");
  });
});
