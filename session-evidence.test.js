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
    { role: "user", content: [{ type: "text", text: "Refactor /fxxk so the current session stages a prompt before /new and the next session consumes it exactly once." }] },
    { role: "assistant", content: [{ type: "text", text: "I will split staging from consumption." }] },
    { role: "user", content: [{ type: "text", text: "Give me a prompt I can paste into a new session once this is done." }] },
  ];

  const evidence = buildSessionEvidence(messages);

  assert.equal(
    evidence.primaryUserMessage,
    "Refactor /fxxk so the current session stages a prompt before /new and the next session consumes it exactly once.",
  );
  assert.deepEqual(evidence.taskUserMessages, [
    "Refactor /fxxk so the current session stages a prompt before /new and the next session consumes it exactly once.",
  ]);
});

test("buildSessionEvidence extracts structured done, remaining, verification, constraints, source documents, and full rich file sections from a handoff-style assistant summary", () => {
  const messages = [
    {
      role: "assistant",
      content: [{
        type: "text",
        text: `当前上下文（非常重要）

输入文档
- docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md

### 已完成的工作
- judge task 的 prompt 合同改成 skill-first
- judge raw voice 现在被视为主输出

### 已修改/新增的关键文件
#### Backend / prompt / runtime
- server/internal/daemon/prompt.go
- server/internal/daemon/execenv/context.go
- server/internal/daemon/execenv/runtime_config.go

#### Frontend
- apps/web/features/ideas/components/idea-judge-voices.tsx

### 已验证通过的命令
- pnpm typecheck
- cd server && go test ./...

### 当前还没做完的剩余任务
1. 真正拆成双阶段 judge 流程
2. 聚合 panel 更彻底地人声化

### 执行要求
- 以 judge skill 原声优先 为唯一主导原则
- 不要把 raw voice 再包装回 workflow context shell

### 最终完成标准
1. raw voice 与 machine extraction 在流程和展示上彻底分层
2. 端到端验证完成`,
      }],
    },
  ];

  const evidence = buildSessionEvidence(messages);

  assert.deepEqual(evidence.structuredAssistantSummary?.sectionTitles, [
    "当前上下文（非常重要）",
    "输入文档",
    "已完成的工作",
    "已修改/新增的关键文件",
    "已验证通过的命令",
    "当前还没做完的剩余任务",
    "执行要求",
    "最终完成标准",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.sourceDocumentItems, [
    "docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.sourceDocuments, [
    "docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.completedItems, [
    "judge task 的 prompt 合同改成 skill-first",
    "judge raw voice 现在被视为主输出",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.fileItems, [
    "server/internal/daemon/prompt.go",
    "server/internal/daemon/execenv/context.go",
    "server/internal/daemon/execenv/runtime_config.go",
    "apps/web/features/ideas/components/idea-judge-voices.tsx",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.verificationItems, [
    "pnpm typecheck",
    "cd server && go test ./...",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.remainingItems, [
    "真正拆成双阶段 judge 流程",
    "聚合 panel 更彻底地人声化",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.constraintItems, [
    "以 judge skill 原声优先 为唯一主导原则",
    "不要把 raw voice 再包装回 workflow context shell",
  ]);
  assert.deepEqual(evidence.structuredAssistantSummary?.completionItems, [
    "raw voice 与 machine extraction 在流程和展示上彻底分层",
    "端到端验证完成",
  ]);
});
