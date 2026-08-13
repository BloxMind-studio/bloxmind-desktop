/**
 * Component tests for the chat part renderers (src/components/chat/*).
 *
 * These are the leaf components that ChatMessages composes to render each
 * message part — todos, errors, prompts, disclosures, thinking states.
 * Smoke + behavior coverage so regressions in part rendering are caught.
 */

import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelErrorCard, UsageLimitDialog } from "@/components/chat/ErrorViews";
import { InlineDisclosure } from "@/components/chat/InlineDisclosure";
import { PermissionPrompt, QuestionPrompt } from "@/components/chat/Prompts";
import { BloxMindThinking, BusyThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { TodoPanel } from "@/components/chat/TodoPanel";
import type { ModelError } from "@/lib/modelError";
import type { OpenCodeUsageAction } from "@/lib/usageLimit";
import { makeAssistantMessage, makeTodo, makeUserMessage } from "@/test/fixtures";

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

  it("BusyThinkingIndicator only shows while busy waiting on a user message", () => {
    const lastMessage = { info: makeAssistantMessage(), parts: [] };

    // Not busy → nothing rendered.
    const { container, rerender } = render(
      <BusyThinkingIndicator status={{ type: "idle" }} lastMessage={lastMessage} />,
    );
    expect(container).toBeEmptyDOMElement();

    // Busy but last message is assistant → nothing rendered.
    rerender(<BusyThinkingIndicator status={{ type: "busy" }} lastMessage={lastMessage} />);
    expect(container).toBeEmptyDOMElement();

    // Busy and last message is user → indicator shown.
    rerender(
      <BusyThinkingIndicator
        status={{ type: "busy" }}
        lastMessage={{ info: makeUserMessage(), parts: [] }}
      />,
    );
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});
