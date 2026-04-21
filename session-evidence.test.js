import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionEvidence, collectAdaptiveMessageSnippets } from "./session-evidence.js";

test("collectAdaptiveMessageSnippets scans further back when recent user messages are meta handoff requests", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "修 ideas source detail 页面，验证 Execution / Discussions / raw output，并重新触发 source run 看自动 comment。" }] },
    { role: "assistant", content: [{ type: "text", text: "我先修。" }] },
    { role: "user", content: [{ type: "text", text: "继续" }] },
    { role: "user", content: [{ type: "text", text: "给我一段可以直接复制粘贴的提示词，让我能新开会话继续。" }] },
  ];

  const snippets = collectAdaptiveMessageSnippets(messages, {
    role: "user",
    minCount: 1,
    maxCount: 5,
    targetChars: 50,
    maxChars: 300,
    skipMetaHandoff: true,
  });

  assert.deepEqual(snippets, [
    "修 ideas source detail 页面，验证 Execution / Discussions / raw output，并重新触发 source run 看自动 comment。",
  ]);
});

test("buildSessionEvidence keeps older task-bearing user intent when the latest assistant drifted", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "现在建议你直接验证这两个点：A. 打开 source detail 页面确认 Execution / Discussions / raw output；B. Run now 后确认实时 agent activity 和自动结论 comment。" }] },
    { role: "assistant", content: [{ type: "text", text: "好的，我接下来会验证这两个点。" }] },
    { role: "assistant", content: [{ type: "text", text: "Read docs/plans/2026-04-11-001-feat-content-review-mr-style-comments-plan.md first. Then resume Unit 1." }] },
  ];

  const evidence = buildSessionEvidence(messages);

  assert.equal(
    evidence.primaryUserMessage,
    "现在建议你直接验证这两个点：A. 打开 source detail 页面确认 Execution / Discussions / raw output；B. Run now 后确认实时 agent activity 和自动结论 comment。",
  );
  assert.equal(evidence.latestAssistantText, "Read docs/plans/2026-04-11-001-feat-content-review-mr-style-comments-plan.md first. Then resume Unit 1.");
  assert.deepEqual(evidence.taskUserMessages, [
    "现在建议你直接验证这两个点：A. 打开 source detail 页面确认 Execution / Discussions / raw output；B. Run now 后确认实时 agent activity 和自动结论 comment。",
  ]);
});

test("buildSessionEvidence ignores late meta handoff requests when older task-bearing intent still exists", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Refactor /fuck so the current session stages a prompt before /new and the next session consumes it exactly once." }] },
    { role: "assistant", content: [{ type: "text", text: "I will split staging from consumption." }] },
    { role: "user", content: [{ type: "text", text: "Give me a prompt I can paste into a new session once this is done." }] },
  ];

  const evidence = buildSessionEvidence(messages);

  assert.equal(
    evidence.primaryUserMessage,
    "Refactor /fuck so the current session stages a prompt before /new and the next session consumes it exactly once.",
  );
  assert.deepEqual(evidence.taskUserMessages, [
    "Refactor /fuck so the current session stages a prompt before /new and the next session consumes it exactly once.",
  ]);
});
