import test from "node:test";
import assert from "node:assert/strict";

import { decideFxxkAction, getConsumableStagedPrompt, getFallbackSourceSessionCandidates, hasMatchingSessionCwd } from "./fxxk-core.js";
import {
  FXXK_STATE_CUSTOM_TYPE,
  createConsumedPrompt,
  createStagedPrompt,
  createSupersededPrompt,
  getLatestPendingStagedPrompt,
} from "./handoff-state.js";

function customEntry(data) {
  return {
    type: "custom",
    customType: FXXK_STATE_CUSTOM_TYPE,
    data,
  };
}

function resolveScenario({ hasCurrentSessionHistory, entries }) {
  const pendingPrompt = getLatestPendingStagedPrompt(entries);
  return {
    pendingPrompt,
    action: decideFxxkAction({
      hasCurrentSessionHistory,
      hasPendingStagedPrompt: Boolean(pendingPrompt),
    }),
  };
}

test("case: fresh child session without any staged prompt warns instead of falling back", () => {
  const scenario = resolveScenario({
    hasCurrentSessionHistory: false,
    entries: [],
  });

  assert.equal(scenario.pendingPrompt, null);
  assert.equal(scenario.action, "warn-no-staged-prompt");
});

test("case: fresh child session consumes the latest staged prompt", () => {
  const firstPrompt = createStagedPrompt("older prompt");
  const secondPrompt = createStagedPrompt("latest prompt");

  const scenario = resolveScenario({
    hasCurrentSessionHistory: false,
    entries: [
      customEntry(firstPrompt),
      customEntry(createSupersededPrompt(firstPrompt.promptId)),
      customEntry(secondPrompt),
    ],
  });

  assert.equal(scenario.pendingPrompt?.promptId, secondPrompt.promptId);
  assert.equal(scenario.pendingPrompt?.prompt, "latest prompt");
  assert.equal(scenario.action, "consume-staged-prompt");
});

test("case: child session only consumes a staged prompt when source and current cwd match exactly", () => {
  assert.equal(
    hasMatchingSessionCwd({
      sourceSessionCwd: "/tmp/project",
      currentCwd: "/tmp/project",
    }),
    true,
  );

  assert.equal(
    hasMatchingSessionCwd({
      sourceSessionCwd: "/tmp/project",
      currentCwd: "/tmp/project/other",
    }),
    false,
  );

  assert.equal(
    hasMatchingSessionCwd({
      sourceSessionCwd: "/tmp/project",
      currentCwd: "/tmp/another-project",
    }),
    false,
  );
});

test("case: different cwd blocks consumption even when a staged prompt exists", () => {
  const olderPrompt = createStagedPrompt("older prompt");
  const latestPrompt = createStagedPrompt("latest prompt");

  const sameCwdPending = getConsumableStagedPrompt({
    sourceSessionCwd: "/tmp/project",
    currentCwd: "/tmp/project",
    entries: [
      customEntry(olderPrompt),
      customEntry(createSupersededPrompt(olderPrompt.promptId)),
      customEntry(latestPrompt),
    ],
  });

  assert.equal(sameCwdPending?.promptId, latestPrompt.promptId);
  assert.equal(sameCwdPending?.prompt, "latest prompt");

  const differentCwdPending = getConsumableStagedPrompt({
    sourceSessionCwd: "/tmp/project",
    currentCwd: "/tmp/project-child",
    entries: [
      customEntry(olderPrompt),
      customEntry(createSupersededPrompt(olderPrompt.promptId)),
      customEntry(latestPrompt),
    ],
  });

  assert.equal(differentCwdPending, null);

  const scenario = resolveScenario({
    hasCurrentSessionHistory: false,
    entries: differentCwdPending ? [customEntry(differentCwdPending)] : [],
  });

  assert.equal(scenario.pendingPrompt, null);
  assert.equal(scenario.action, "warn-no-staged-prompt");
});

test("case: multiple /fxxk runs in the source session leave only the last prompt active", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");
  const thirdPrompt = createStagedPrompt("third prompt");

  const scenario = resolveScenario({
    hasCurrentSessionHistory: false,
    entries: [
      customEntry(firstPrompt),
      customEntry(createSupersededPrompt(firstPrompt.promptId)),
      customEntry(secondPrompt),
      customEntry(createSupersededPrompt(secondPrompt.promptId)),
      customEntry(thirdPrompt),
    ],
  });

  assert.equal(scenario.pendingPrompt?.promptId, thirdPrompt.promptId);
  assert.equal(scenario.pendingPrompt?.prompt, "third prompt");
  assert.equal(scenario.action, "consume-staged-prompt");
});

test("case: consuming the latest prompt does not revive older superseded prompts", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");

  const scenario = resolveScenario({
    hasCurrentSessionHistory: false,
    entries: [
      customEntry(firstPrompt),
      customEntry(createSupersededPrompt(firstPrompt.promptId)),
      customEntry(secondPrompt),
      customEntry(createConsumedPrompt(secondPrompt.promptId, "/tmp/child-session.jsonl")),
    ],
  });

  assert.equal(scenario.pendingPrompt, null);
  assert.equal(scenario.action, "warn-no-staged-prompt");
});

test("case: once the child session has its own history, /fxxk stages the current session instead of consuming an old prompt", () => {
  const stagedPrompt = createStagedPrompt("latest prompt");

  const scenario = resolveScenario({
    hasCurrentSessionHistory: true,
    entries: [customEntry(stagedPrompt)],
  });

  assert.equal(scenario.pendingPrompt?.prompt, "latest prompt");
  assert.equal(scenario.action, "stage-current-session");
});

test("case: fallback source-session candidates prefer the newest same-cwd session before the child session", () => {
  const candidates = getFallbackSourceSessionCandidates({
    currentSessionCreatedAt: new Date("2026-04-23T01:55:12.984Z"),
    currentSessionCwd: "/tmp/project",
    currentSessionFile: "/tmp/current.jsonl",
    currentSessionId: "current",
    sessionInfos: [
      {
        id: "older-same-cwd",
        path: "/tmp/older.jsonl",
        cwd: "/tmp/project",
        created: new Date("2026-04-23T01:40:00.000Z"),
        modified: new Date("2026-04-23T01:40:05.000Z"),
      },
      {
        id: "newest-same-cwd",
        path: "/tmp/newest.jsonl",
        cwd: "/tmp/project",
        created: new Date("2026-04-23T01:55:06.532Z"),
        modified: new Date("2026-04-23T01:55:06.532Z"),
      },
      {
        id: "future-session",
        path: "/tmp/future.jsonl",
        cwd: "/tmp/project",
        created: new Date("2026-04-23T01:55:20.000Z"),
        modified: new Date("2026-04-23T01:55:21.000Z"),
      },
      {
        id: "different-cwd",
        path: "/tmp/other.jsonl",
        cwd: "/tmp/other-project",
        created: new Date("2026-04-23T01:54:00.000Z"),
        modified: new Date("2026-04-23T01:54:01.000Z"),
      },
      {
        id: "current",
        path: "/tmp/current.jsonl",
        cwd: "/tmp/project",
        created: new Date("2026-04-23T01:55:12.984Z"),
        modified: new Date("2026-04-23T01:55:12.984Z"),
      },
    ],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ["newest-same-cwd", "older-same-cwd"],
  );
});
