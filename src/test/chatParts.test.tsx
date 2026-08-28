/**
 * Component tests for the chat part renderers (src/components/chat/*).
 *
 * These are the leaf components that ChatMessages composes to render each
 * message part — todos, errors, prompts, disclosures, thinking states.
 * Smoke + behavior coverage so regressions in part rendering are caught.
 */

import type { Part, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelErrorCard, UsageLimitDialog } from "@/components/chat/ErrorViews";
import { InlineDisclosure } from "@/components/chat/InlineDisclosure";
import { PermissionPrompt, QuestionPrompt } from "@/components/chat/Prompts";
import { buildSteps, SmartPartsRenderer } from "@/components/chat/partViews";
import { StepExecutionView } from "@/components/chat/StepExecutionView";
import { BloxMindThinking, BusyThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { TodoPanel } from "@/components/chat/TodoPanel";
import type { ModelError } from "@/lib/modelError";
import type { OpenCodeUsageAction } from "@/lib/usageLimit";
import { makeTodo } from "@/test/fixtures";

beforeEach(() => {
  window.localStorage.clear();
});

// ── TodoPanel ────────────────────────────────────────────────────────────

describe("TodoPanel", () => {
  it("renders nothing when there are no todos", () => {
    const { container } = render(<TodoPanel todos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows completion count, progress bar and one row per todo", () => {
    const todos = [
      makeTodo({ content: "First task", status: "completed" }),
      makeTodo({ content: "Second task", status: "in_progress" }),
      makeTodo({ content: "Third task", status: "pending" }),
    ];
    const { container } = render(<TodoPanel todos={todos} />);

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
    expect(screen.getByText("Third task")).toBeInTheDocument();

    // Progress bar width reflects completed/total.
    const bar = container.querySelector<HTMLElement>(".bg-emerald-500");
    expect(bar?.style.width).toBe(`${(1 / 3) * 100}%`);
  });
});

// ── ModelErrorCard ───────────────────────────────────────────────────────

describe("ModelErrorCard", () => {
  it("presents a context overflow error with alert role", () => {
    const error: ModelError = {
      name: "ContextOverflowError",
      data: { message: "context length exceeded" },
    };
    render(<ModelErrorCard error={error} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("This conversation is too large");
    expect(alert).toHaveTextContent("Start a new session");
    // Provider detail is exposed behind a disclosure.
    expect(screen.getByText("Provider details")).toBeInTheDocument();
    expect(alert).toHaveTextContent("context length exceeded");
  });

  it("presents a generic error without a detail disclosure when none exists", () => {
    const error: ModelError = { name: "MessageAbortedError", data: { message: "stopped" } };
    render(<ModelErrorCard error={error} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Response stopped");
    // For aborted errors the detail doubles as the description → no disclosure.
    expect(screen.queryByText("Provider details")).not.toBeInTheDocument();
  });
});

// ── UsageLimitDialog ─────────────────────────────────────────────────────

describe("UsageLimitDialog", () => {
  function makeAction(overrides: Partial<OpenCodeUsageAction> = {}): OpenCodeUsageAction {
    return {
      reason: "free_tier_limit",
      provider: "opencode",
      title: "Free tier limit reached",
      message: "You have used all free credits for today.",
      label: "Upgrade",
      link: "https://example.com/upgrade",
      ...overrides,
    };
  }

  it("shows the dialog with title, message and action link", () => {
    render(<UsageLimitDialog action={makeAction()} />);

    expect(screen.getByText("Free tier limit reached")).toBeInTheDocument();
    expect(screen.getByText("You have used all free credits for today.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Upgrade" });
    expect(link).toHaveAttribute("href", "https://example.com/upgrade");
  });

  it("hides forever when Don't show again is clicked", () => {
    const { rerender } = render(<UsageLimitDialog action={makeAction()} />);
    fireEvent.click(screen.getByText("Don't show again"));
    expect(screen.queryByText("Free tier limit reached")).not.toBeInTheDocument();

    // Even a fresh mount stays hidden.
    rerender(<UsageLimitDialog action={makeAction()} />);
    expect(screen.queryByText("Free tier limit reached")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("BloxMind:usage-limit:free-tier:hidden")).toBe("true");
  });

  it("suppresses re-shows within the 24h window but shows again after it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { unmount } = render(<UsageLimitDialog action={makeAction()} />);
      fireEvent.click(screen.getByRole("link", { name: "Upgrade" }));
      unmount();

      // Within the window: stays hidden.
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      render(<UsageLimitDialog action={makeAction()} />);
      expect(screen.queryByText("Free tier limit reached")).not.toBeInTheDocument();

      // After the window: shows again.
      vi.setSystemTime(new Date("2026-01-02T00:00:01Z"));
      render(<UsageLimitDialog action={makeAction()} />);
      expect(screen.getAllByText("Free tier limit reached").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── QuestionPrompt ───────────────────────────────────────────────────────

describe("QuestionPrompt", () => {
  const question: QuestionRequest = {
    id: "q1",
    sessionID: "s1",
    questions: [
      {
        header: "Framework",
        question: "Which framework?",
        options: [
          { label: "React", description: "A UI library" },
          { label: "Vue", description: "Another UI library" },
        ],
      },
    ],
  };

  it("renders the question with its options", () => {
    render(<QuestionPrompt question={question} onAnswer={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText("Framework")).toBeInTheDocument();
    expect(screen.getByText("Which framework?")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
  });

  it("submits the selected option", () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={question} onAnswer={onAnswer} onReject={vi.fn()} />);

    fireEvent.click(screen.getByText("React"));
    fireEvent.click(screen.getByText("Submit"));

    expect(onAnswer).toHaveBeenCalledWith("q1", [["React"]]);
  });

  it("single-select replaces the previous choice", () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={question} onAnswer={onAnswer} onReject={vi.fn()} />);

    fireEvent.click(screen.getByText("React"));
    fireEvent.click(screen.getByText("Vue"));
    fireEvent.click(screen.getByText("Submit"));

    expect(onAnswer).toHaveBeenCalledWith("q1", [["Vue"]]);
  });

  it("includes the custom answer alongside selections", () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question={question} onAnswer={onAnswer} onReject={vi.fn()} />);

    fireEvent.click(screen.getByText("React"));
    fireEvent.change(screen.getByPlaceholderText("Type your own answer..."), {
      target: { value: "Svelte" },
    });
    fireEvent.click(screen.getByText("Submit"));

    expect(onAnswer).toHaveBeenCalledWith("q1", [["React", "Svelte"]]);
  });

  it("rejects via Dismiss", () => {
    const onReject = vi.fn();
    render(<QuestionPrompt question={question} onAnswer={vi.fn()} onReject={onReject} />);

    fireEvent.click(screen.getByText("Dismiss"));
    expect(onReject).toHaveBeenCalledWith("q1");
  });
});

// ── PermissionPrompt ─────────────────────────────────────────────────────

describe("PermissionPrompt", () => {
  const permission: PermissionRequest = {
    id: "p1",
    sessionID: "s1",
    permission: "bash",
    patterns: ["rm -rf *"],
    metadata: {},
    always: [],
  };

  it("renders the permission name and patterns", () => {
    render(<PermissionPrompt permission={permission} onReply={vi.fn()} />);

    expect(screen.getByText("Permission Required")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("rm -rf *")).toBeInTheDocument();
  });

  it.each([
    ["Allow Once", "once"],
    ["Always Allow", "always"],
    ["Deny", "reject"],
  ] as const)("replies '%s' as %s", (label, reply) => {
    const onReply = vi.fn();
    render(<PermissionPrompt permission={permission} onReply={onReply} />);

    fireEvent.click(screen.getByText(label));
    expect(onReply).toHaveBeenCalledWith("p1", reply);
  });
});

// ── InlineDisclosure ─────────────────────────────────────────────────────

describe("InlineDisclosure", () => {
  it("starts collapsed and expands on click", () => {
    render(<InlineDisclosure text="some reasoning text" />);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("some reasoning text")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

// ── Thinking indicators ──────────────────────────────────────────────────

describe("ThinkingIndicator", () => {
  it("BloxMindThinking shows the default label", () => {
    render(<BloxMindThinking />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("BusyThinkingIndicator shows whenever the session is busy", () => {
    // Not busy → nothing rendered.
    const { container, rerender } = render(
      <BusyThinkingIndicator status={{ type: "idle" }} />,
    );
    expect(container).toBeEmptyDOMElement();

    // Busy → indicator shown regardless of message role.
    rerender(<BusyThinkingIndicator status={{ type: "busy" }} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});

// ── SmartPartsRenderer — thinking block gating ──────────────────────────

describe("buildSteps — step-based execution data model", () => {
  const base = { sessionID: "s1", messageID: "m1" };

  it("groups a tool call wrapped in step markers into one step", () => {
    const parts = [
      { id: "s1", type: "step-start", ...base },
      { id: "r1", type: "reasoning", ...base, text: "Inspect the tree" },
      { id: "t1", type: "tool", ...base, tool: "roblox-studio", state: { status: "completed" } },
      {
        id: "f1",
        type: "step-finish",
        ...base,
        tokens: { input: 12, output: 34, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(1);
    expect(steps[0].toolNames).toEqual(["roblox-studio"]);
    expect(steps[0].reasoningText).toBe("Inspect the tree");
    expect(steps[0].tokens).toEqual({ input: 12, output: 34 });
  });

  it("accumulates consecutive tool calls into sequential steps", () => {
    const parts = [
      { id: "s1", type: "step-start", ...base },
      { id: "t1", type: "tool", ...base, tool: "bash", state: {} },
      { id: "f1", type: "step-finish", ...base, tokens: { input: 1, output: 2 } },
      { id: "s2", type: "step-start", ...base },
      { id: "t2", type: "tool", ...base, tool: "read", state: {} },
      { id: "f2", type: "step-finish", ...base, tokens: { input: 3, output: 4 } },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps.map((s) => s.toolNames)).toEqual([["bash"], ["read"]]);
    expect(steps.map((s) => s.tokens)).toEqual([
      { input: 1, output: 2 },
      { input: 3, output: 4 },
    ]);
  });

  it("creates a single implicit step when no step markers exist", () => {
    const parts = [
      { id: "t1", type: "tool", ...base, tool: "glob", state: {} },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(1);
    expect(steps[0].toolNames).toEqual(["glob"]);
  });

  it("splits consecutive tool calls without step markers into sequential steps", () => {
    const parts = [
      { id: "t1", type: "tool", ...base, tool: "read", state: { status: "completed" } },
      { id: "t2", type: "tool", ...base, tool: "edit", state: { status: "running" } },
      { id: "t3", type: "tool", ...base, tool: "bash", state: { status: "running" } },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.toolNames)).toEqual([["read"], ["edit"], ["bash"]]);
  });

  it("splits alternating reasoning and tool calls into sequential steps", () => {
    const parts = [
      { id: "r1", type: "reasoning", ...base, text: "Let me check the files" },
      { id: "t1", type: "tool", ...base, tool: "read", state: { status: "completed" } },
      { id: "r2", type: "reasoning", ...base, text: "Now modifying the code" },
      { id: "t2", type: "tool", ...base, tool: "edit", state: { status: "completed" } },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(2);
    expect(steps[0].reasoningText).toBe("Let me check the files");
    expect(steps[0].toolNames).toEqual(["read"]);
    expect(steps[1].reasoningText).toBe("Now modifying the code");
    expect(steps[1].toolNames).toEqual(["edit"]);
  });

  it("ignores text parts (they are the final answer, not steps)", () => {
    const parts = [
      { id: "s1", type: "step-start", ...base },
      { id: "t1", type: "tool", ...base, tool: "bash", state: {} },
      { id: "f1", type: "step-finish", ...base, tokens: { input: 1, output: 1 } },
      { id: "txt", type: "text", ...base, text: "Done!" },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(1);
    expect(steps[0].parts.some((p) => p.type === "text")).toBe(false);
  });

  it("keeps metric-only steps (no tool/reasoning) present but renders nothing via ThinkingBlock", () => {
    const parts = [
      { id: "s1", type: "step-start", ...base },
      { id: "f1", type: "step-finish", ...base, tokens: { input: 7, output: 9 } },
    ] as unknown as Part[];

    const steps = buildSteps(parts);
    expect(steps).toHaveLength(1);
    // No tool, no readable reasoning -> ThinkingBlock's content gate drops it.
    expect(steps[0].toolNames).toEqual([]);
    expect(steps[0].reasoningText).toBeUndefined();
  });
});

describe("SmartPartsRenderer — thinking block gating", () => {
  const base = { sessionID: "s1", messageID: "m1" };

  const stepMetricsOnly: Part[] = [
    { id: "p1", type: "step-start", ...base },
    {
      id: "p2",
      type: "step-finish",
      ...base,
      tokens: { input: 128, output: 340, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  ] as unknown as Part[];

  it("renders no Reasoning block when only step metrics exist (even with tokens)", () => {
    const { container } = render(<SmartPartsRenderer parts={stepMetricsOnly} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Reasoning block with token chips when real reasoning text exists", () => {
    const parts = [
      ...stepMetricsOnly,
      { id: "p3", type: "reasoning", ...base, text: "Planning the zone flow" },
    ] as unknown as Part[];
    render(<SmartPartsRenderer parts={parts} />);

    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("128 in")).toBeInTheDocument();
    expect(screen.getByText("340 out")).toBeInTheDocument();
  });

  it("renders no Reasoning block for whitespace-only reasoning", () => {
    const parts = [
      { id: "p1", type: "reasoning", ...base, text: "   \n\t  " },
    ] as unknown as Part[];
    const { container } = render(<SmartPartsRenderer parts={parts} />);
    expect(container).toBeEmptyDOMElement();
  });
describe("StepExecutionView", () => {
  it("morphs thinking -> thought in place without remounting the step container", () => {
    const tool: Part = {
      id: "tool_1",
      sessionID: "s1",
      messageID: "msg_a",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls -la", description: "List source files" },
        output: "total 0",
        title: "ls -la",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
    const parts = [tool];

    const { container, rerender } = render(<StepExecutionView parts={parts} isActive />);

    // An active single step shows the animated spinner.
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    const containerBefore = container.querySelector<HTMLElement>(".mb-3");
    expect(containerBefore).not.toBeNull();

    // Turn settles -> the same step freezes into a collapsible Thought.
    rerender(<StepExecutionView parts={parts} isActive={false} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("Thought")).toBeInTheDocument();

    // The outer step container is the SAME DOM node across the transition —
    // the block morphs in place instead of being torn down and re-mounted, so
    // there is zero frame gap / flicker between Thinking and Thought.
    const containerAfter = container.querySelector<HTMLElement>(".mb-3");
    expect(containerAfter).toBe(containerBefore);
  });

  it("appends the next Thinking block below a frozen Thought for multi-step turns", () => {
    const toolA: Part = {
      id: "toolA",
      sessionID: "s1",
      messageID: "msg_a",
      type: "tool",
      callID: "callA",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls", description: "List files" },
        output: "",
        title: "ls",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
    const toolB: Part = {
      id: "toolB",
      sessionID: "s1",
      messageID: "msg_a",
      type: "tool",
      callID: "callB",
      tool: "webfetch",
      state: {
        status: "running",
        input: { url: "https://example.com" },
        time: { start: 1 },
      },
    };

    const { rerender } = render(<StepExecutionView parts={[toolA, toolB]} isActive />);

    // With two steps while active: step 1 is a frozen Thought, step 2 is Thinking.
    expect(screen.getByText("Thought")).toBeInTheDocument();
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();

    // Turn settles -> both freeze; Thinking disappears.
    rerender(<StepExecutionView parts={[toolA, toolB]} isActive={false} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getAllByText("Thought").length).toBeGreaterThanOrEqual(1);
  });
});

});
