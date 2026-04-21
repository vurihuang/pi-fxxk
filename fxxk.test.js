import test from "node:test";
import assert from "node:assert/strict";

import { buildHandoffPromptFromMessages, decideFxxkAction } from "./fxxk-core.js";

test("decideFxxkAction stages the current session when it has usable history", () => {
  assert.equal(
    decideFxxkAction({
      hasCurrentSessionHistory: true,
      hasPendingStagedPrompt: false,
    }),
    "stage-current-session",
  );
});

test("decideFxxkAction consumes a staged prompt in a child session", () => {
  assert.equal(
    decideFxxkAction({
      hasCurrentSessionHistory: false,
      hasPendingStagedPrompt: true,
    }),
    "consume-staged-prompt",
  );
});

test("decideFxxkAction warns when there is no staged prompt to consume", () => {
  assert.equal(
    decideFxxkAction({
      hasCurrentSessionHistory: false,
      hasPendingStagedPrompt: false,
    }),
    "warn-no-staged-prompt",
  );
});

test("decideFxxkAction prioritizes staging the current session once the child session has its own history", () => {
  assert.equal(
    decideFxxkAction({
      hasCurrentSessionHistory: true,
      hasPendingStagedPrompt: true,
    }),
    "stage-current-session",
  );
});

test("buildHandoffPromptFromMessages reuses an explicit handoff prompt from the source messages", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Give me a prompt I can paste into a new session to continue this task." }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Use this exactly:\n\n```text\nContinue the staged handoff flow and finish the remaining verification.\n```" }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async () => {
      throw new Error("completePrompt should not run when an explicit handoff prompt already exists");
    },
  });

  assert.equal(prompt, "Continue the staged handoff flow and finish the remaining verification.");
});

test("buildHandoffPromptFromMessages uses current-session evidence when generating a new handoff prompt", async () => {
  let receivedEvidenceBlock = "";

  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Refactor the /fxxk flow so the source session stages a prompt for /new." }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will split prompt generation from child-session consumption next." }],
      },
    ],
    goal: "preserve end-to-end handoff verification",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async ({ evidenceBlock }) => {
      receivedEvidenceBlock = evidenceBlock;
      return "Stage this exact handoff prompt for the next session.";
    },
  });

  assert.equal(prompt, "Stage this exact handoff prompt for the next session.");
  assert.match(receivedEvidenceBlock, /Goal: preserve end-to-end handoff verification/);
  assert.match(receivedEvidenceBlock, /Refactor the \/fxxk flow so the source session stages a prompt for \/new\./);
});

test("buildHandoffPromptFromMessages falls back to deterministic continuation when completePrompt returns null", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Finish the handoff refactor and report the next natural step" }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async () => null,
  });

  assert.match(prompt, /Finish the handoff refactor and report the next natural step\./);
  assert.match(prompt, /This is a continuation handoff, not a fresh start\./);
  assert.match(prompt, /Report back with files changed, tests run, results, and any remaining risks\./);
});

test("buildHandoffPromptFromMessages turns structured progress into a continuation contract when the model fallback is used", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{
          type: "text",
          text: `当前上下文（非常重要）

输入文档
- docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md

### 已完成的工作
- 将 judge task 的 prompt 合同改成 skill-first
- judge reviewer timeline comment 已改成更偏 raw voice

### 已修改/新增的关键文件
#### Backend / prompt / runtime
- server/internal/daemon/prompt.go
- server/internal/daemon/execenv/context.go
- server/internal/daemon/execenv/runtime_config.go

#### Backend / workflow / API
- server/internal/handler/ideas_workflow_service.go
- server/internal/handler/ideas.go
- server/internal/handler/handler_test.go

#### DB
- server/pkg/db/generated/ideas_judge.sql.go

#### Frontend
- apps/web/features/ideas/components/idea-detail.tsx
- apps/web/features/ideas/components/idea-judge-voices.tsx

### 已验证通过的命令
- pnpm typecheck
- pnpm lint

### 当前还没做完的剩余任务
1. 真正拆成双阶段 judge 流程
2. Judge Voices 面板去 JSON 化

### 执行要求
- 以 judge skill 原声优先 为唯一主导原则
- 不要把 raw voice 再包装回 workflow context shell

### 最终完成标准
1. judge raw voice 与 machine extraction 在流程和展示上彻底分层
2. 端到端验证完成`,
        }],
      },
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "edit", arguments: { path: "server/internal/daemon/prompt.go" } },
          { type: "toolCall", name: "edit", arguments: { path: "apps/web/features/ideas/components/idea-detail.tsx" } },
        ],
      },
    ],
    goal: "",
    cwd: "/Users/vuri/workspaces/seekspace/doris.v1",
    sessionInfo: { path: "session.jsonl", cwd: "/Users/vuri/workspaces/seekspace/doris.v1", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async () => null,
  });

  assert.match(prompt, /请继续执行剩余工作，先完成：真正拆成双阶段 judge 流程。/);
  assert.match(prompt, /输入文档/);
  assert.match(prompt, /已完成的工作/);
  assert.match(prompt, /已修改\/新增的关键文件/);
  assert.match(prompt, /已验证通过的命令/);
  assert.match(prompt, /当前还没做完的剩余任务/);
  assert.match(prompt, /执行要求/);
  assert.match(prompt, /最终完成标准/);
  assert.match(prompt, /当前上下文（非常重要）/);
  assert.match(prompt, /输入文档\n- docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md/);
  assert.match(prompt, /当前上下文（非常重要）\n- 这是一个继续执行的交接，不是从零开始。\n- 工作目录：\/Users\/vuri\/workspaces\/seekspace\/doris\.v1。/);
  assert.match(prompt, /已完成的工作\n- 将 judge task 的 prompt 合同改成 skill-first\n- judge reviewer timeline comment 已改成更偏 raw voice/);
  assert.match(prompt, /已修改\/新增的关键文件[\s\S]*server\/internal\/daemon\/prompt\.go[\s\S]*server\/internal\/daemon\/execenv\/context\.go[\s\S]*server\/internal\/daemon\/execenv\/runtime_config\.go[\s\S]*server\/internal\/handler\/ideas_workflow_service\.go[\s\S]*server\/internal\/handler\/ideas\.go[\s\S]*server\/internal\/handler\/handler_test\.go[\s\S]*server\/pkg\/db\/generated\/ideas_judge\.sql\.go[\s\S]*apps\/web\/features\/ideas\/components\/idea-detail\.tsx[\s\S]*apps\/web\/features\/ideas\/components\/idea-judge-voices\.tsx/);
  assert.doesNotMatch(prompt, /Latest confirmed status:/);
  assert.match(prompt, /已验证通过的命令\n- pnpm typecheck\n- pnpm lint/);
  assert.match(prompt, /执行要求\n- 以 judge skill 原声优先 为唯一主导原则\n- 不要把 raw voice 再包装回 workflow context shell\n- 不要重复已完成工作，也不要擅自扩 scope/);
  assert.match(prompt, /最终完成标准\n- judge raw voice 与 machine extraction 在流程和展示上彻底分层\n- 端到端验证完成/);
  assert.doesNotMatch(prompt, /This is a continuation handoff/);
  assert.doesNotMatch(prompt, /Do not redo finished work or invent extra scope/);
});

test("buildHandoffPromptFromMessages prefers workflow tasks when workflow context matches and the session evidence is thin", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "I need to continue docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md in the next session." }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: {
      activePlan: {
        path: "docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md",
        title: "Fix ideas stage comment humanization",
        status: "active",
        uncheckedItems: ["Unit 2: Split judge_voice and judge_adapter", "Unit 3: Humanize aggregate panel"],
        nextStep: "Unit 2: Split judge_voice and judge_adapter",
      },
      requirements: null,
      genericWorkflowDocs: [],
      lines: [],
    },
    completePrompt: async () => {
      throw new Error("completePrompt should not run when workflow continuation is explicit and session evidence is thin");
    },
  });

  assert.match(prompt, /Read docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md first/);
  assert.match(prompt, /Current context/);
  assert.match(prompt, /Workflow status: active\./);
  assert.match(prompt, /Unchecked items: Unit 2: Split judge_voice and judge_adapter \| Unit 3: Humanize aggregate panel\./);
  assert.doesNotMatch(prompt, /Latest confirmed status:/);
});

test("buildHandoffPromptFromMessages uses Chinese fallback framing for Chinese-heavy thin workflow evidence", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "继续 docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md，下一步是 Unit 2：拆分 judge_voice 和 judge_adapter。" }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: {
      activePlan: {
        path: "docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md",
        title: "Fix ideas stage comment humanization",
        status: "active",
        uncheckedItems: ["Unit 2: Split judge_voice and judge_adapter", "Unit 3: Humanize aggregate panel"],
        nextStep: "Unit 2: Split judge_voice and judge_adapter",
      },
      requirements: null,
      genericWorkflowDocs: [],
      lines: [],
    },
    completePrompt: async () => {
      throw new Error("completePrompt should not run when workflow continuation is explicit and session evidence is thin");
    },
  });

  assert.match(prompt, /请继续执行剩余工作，先读 docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md，然后按文档里的下一步继续：Unit 2: Split judge_voice and judge_adapter。/);
  assert.match(prompt, /输入文档\n- docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md/);
  assert.match(prompt, /当前上下文/);
  assert.match(prompt, /当前 workflow 文件：docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md（Fix ideas stage comment humanization）。/);
  assert.match(prompt, /Workflow 状态：active。/);
  assert.match(prompt, /未完成条目：Unit 2: Split judge_voice and judge_adapter \| Unit 3: Humanize aggregate panel。/);
  assert.match(prompt, /文档里的下一步：Unit 2: Split judge_voice and judge_adapter。/);
  assert.doesNotMatch(prompt, /已修改\/新增的关键文件/);
  assert.match(prompt, /执行要求\n- 不要重复已完成工作，也不要擅自扩 scope/);
  assert.match(prompt, /汇报要求\n- 完成后明确汇报：改了哪些文件、跑了哪些测试、结果如何、还剩哪些风险。/);
  assert.doesNotMatch(prompt, /Current context/);
  assert.doesNotMatch(prompt, /Read these files first/);
});

test("buildHandoffPromptFromMessages avoids duplicating source documents into current context for rich Chinese structured handoffs", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: `当前上下文（非常重要）\n\n输入文档\n- docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md\n\n### 已完成的工作\n- 已完成第一轮落地\n\n### 已修改/新增的关键文件\n- server/internal/daemon/prompt.go\n\n### 当前还没做完的剩余任务\n1. 双阶段 judge flow` }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async () => null,
  });

  assert.match(prompt, /输入文档\n- docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md/);
  assert.doesNotMatch(prompt, /当前上下文（非常重要）[\s\S]*输入文档：docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md。/);
});

test("buildHandoffPromptFromMessages asks the model for a stronger hardcode-like continuation contract by default", async () => {
  let receivedEvidenceBlock = "";

  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: `当前上下文（非常重要）\n\n输入文档\n- docs/plans/2026-04-21-001-fix-ideas-stage-comment-humanization-plan.md\n\n### 已完成的工作\n- 已完成第一轮落地\n\n### 已修改/新增的关键文件\n- server/internal/daemon/prompt.go\n\n### 已验证通过的命令\n- pnpm typecheck\n\n### 当前还没做完的剩余任务\n1. 双阶段 judge flow\n\n### 执行要求\n- 保持 skill-first\n\n### 最终完成标准\n1. 端到端验证完成` }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async ({ evidenceBlock }) => {
      receivedEvidenceBlock = evidenceBlock;
      return "请继续完成剩余 judge skill-first 改造，并明确列出已完成、剩余事项、验证和风险。";
    },
  });

  assert.equal(prompt, "请继续完成剩余 judge skill-first 改造，并明确列出已完成、剩余事项、验证和风险。");
  assert.match(receivedEvidenceBlock, /Return a strong continuation contract/);
  assert.match(receivedEvidenceBlock, /If the evidence already resembles a high-quality handoff note, preserve that shape/);
  assert.match(receivedEvidenceBlock, /Prefer sectioned output when supported by the evidence/);
  assert.match(receivedEvidenceBlock, /If the preserved evidence is mostly Chinese, prefer Chinese section headings and phrasing/);
  assert.match(receivedEvidenceBlock, /Source documents explicitly referenced:[\s\S]*docs\/plans\/2026-04-21-001-fix-ideas-stage-comment-humanization-plan\.md/);
  assert.match(receivedEvidenceBlock, /Original section titles: 当前上下文（非常重要） \| 输入文档 \| 已完成的工作 \| 已修改\/新增的关键文件 \| 已验证通过的命令 \| 当前还没做完的剩余任务 \| 执行要求 \| 最终完成标准/);
});

test("buildHandoffPromptFromMessages uses the richer fallback shape by default when model generation returns null", async () => {
  const prompt = await buildHandoffPromptFromMessages({
    messages: [
      {
        role: "assistant",
        content: [{
          type: "text",
          text: `### 已完成的工作
- 第一轮 skill-first 落地完成

### 当前还没做完的剩余任务
1. 双阶段 judge flow

### 已验证通过的命令
- pnpm typecheck`,
        }],
      },
    ],
    goal: "",
    cwd: "/repo",
    sessionInfo: { path: "session.jsonl", cwd: "/repo", id: "source-session" },
    workflowContext: { activePlan: null, requirements: null, genericWorkflowDocs: [], lines: [] },
    completePrompt: async () => null,
  });

  assert.match(prompt, /已完成的工作\n- 第一轮 skill-first 落地完成/);
  assert.match(prompt, /当前还没做完的剩余任务\n- 双阶段 judge flow/);
  assert.match(prompt, /已验证通过的命令\n- pnpm typecheck/);
  assert.match(prompt, /执行要求\n- 不要重复已完成工作，也不要擅自扩 scope/);
  assert.match(prompt, /汇报要求\n- 完成后明确汇报：改了哪些文件、跑了哪些测试、结果如何、还剩哪些风险。/);
  assert.doesNotMatch(prompt, /Latest confirmed status:/);
});
