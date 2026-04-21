import test from "node:test";
import assert from "node:assert/strict";

import { decideFuckAction } from "./fuck-core.js";
import {
  FUCK_STATE_CUSTOM_TYPE,
  createConsumedPrompt,
  createStagedPrompt,
  createSupersededPrompt,
  getLatestPendingStagedPrompt,
} from "./handoff-state.js";

function customEntry(data) {
  return {
    type: "custom",
    customType: FUCK_STATE_CUSTOM_TYPE,
    data,
  };
}

function resolveScenario({ hasCurrentSessionHistory, entries }) {
  const pendingPrompt = getLatestPendingStagedPrompt(entries);
  return {
    pendingPrompt,
    action: decideFuckAction({
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

test("case: multiple /fuck runs in the source session leave only the last prompt active", () => {
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

test("case: once the child session has its own history, /fuck stages the current session instead of consuming an old prompt", () => {
  const stagedPrompt = createStagedPrompt("latest prompt");

  const scenario = resolveScenario({
    hasCurrentSessionHistory: true,
    entries: [customEntry(stagedPrompt)],
  });

  assert.equal(scenario.pendingPrompt?.prompt, "latest prompt");
  assert.equal(scenario.action, "stage-current-session");
});
