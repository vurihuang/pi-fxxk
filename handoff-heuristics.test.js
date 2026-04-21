import test from "node:test";
import assert from "node:assert/strict";

import { extractLatestHandoffPrompt, shouldPreferWorkflowTarget } from "./handoff-heuristics.js";

test("extractLatestHandoffPrompt returns the fenced continuation prompt from the latest handoff reply", () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "给我一段可以直接复制粘贴的提示词，让我能新开会话继续完成任务" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "可以，直接用下面这段：\n\n```text\n继续接手当前仓库里的 /ideas workflow 收尾工作。\n- 先验证 source detail\n```" }],
    },
  ];

  assert.equal(
    extractLatestHandoffPrompt(messages),
    "继续接手当前仓库里的 /ideas workflow 收尾工作。\n- 先验证 source detail",
  );
});

test("shouldPreferWorkflowTarget does not let an unrelated active plan override concrete session evidence", () => {
  const target = {
    path: "docs/plans/2026-04-11-001-feat-content-review-mr-style-comments-plan.md",
    title: "feat: Align content review with MR-style inline comments",
    nextStep: "Unit 1: Build a contextual artifact renderer for active review comments",
  };
  const evidence = {
    recentUserMessages: [
      "A. source detail 页面打开 http://localhost:3000/ideas/506f8818-b133-49e3-af2c-f825b36da730?view=source 并确认 Execution / Discussions / Live run / history / raw output",
      "B. 重新触发一个 source run，观察实时 agent activity 和 discussion 自动 comment",
    ],
    latestAssistantText: "现在建议你直接验证这两个点：source detail 页面与重新触发 source run。",
    modifiedFiles: ["apps/web/features/ideas/components/source-detail.tsx"],
    readFiles: ["server/internal/handler/ideas_workflow_service.go"],
  };

  assert.equal(shouldPreferWorkflowTarget(target, evidence, ""), false);
});

test("shouldPreferWorkflowTarget prefers the workflow target when the previous session explicitly referenced that plan", () => {
  const target = {
    path: "docs/plans/2026-04-11-001-feat-content-review-mr-style-comments-plan.md",
    title: "feat: Align content review with MR-style inline comments",
    nextStep: "Unit 1: Build a contextual artifact renderer for active review comments",
  };
  const evidence = {
    recentUserMessages: [
      "Read docs/plans/2026-04-11-001-feat-content-review-mr-style-comments-plan.md first. Then resume Unit 1.",
    ],
    latestAssistantText: "I need to focus on Unit 1 and check the finished parts of the plan.",
    modifiedFiles: [],
    readFiles: [],
  };

  assert.equal(shouldPreferWorkflowTarget(target, evidence, ""), true);
});

test("extractLatestHandoffPrompt ignores generic prompt discussions that do not ask for a new-session handoff", () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "Refactor /fxxk so the current session stages a better prompt." }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "```text\nThis should not be treated as a reusable new-session handoff prompt.\n```" }],
    },
  ];

  assert.equal(extractLatestHandoffPrompt(messages), null);
});

test("shouldPreferWorkflowTarget treats Chinese workflow continuation cues as explicit workflow intent", () => {
  const target = {
    path: "docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md",
    title: "Fix ideas stage comment humanization",
    nextStep: "Unit 2: Split judge_voice and judge_adapter",
  };
  const evidence = {
    recentUserMessages: [
      "继续 docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md，下一步是 Unit 2：拆分 judge_voice 和 judge_adapter。",
    ],
    latestAssistantText: "继续 docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md，下一步是 Unit 2：拆分 judge_voice 和 judge_adapter。",
    modifiedFiles: [],
    readFiles: [],
  };

  assert.equal(shouldPreferWorkflowTarget(target, evidence, ""), true);
});
