import test from "node:test";
import assert from "node:assert/strict";

import {
  FXXK_STATE_CUSTOM_TYPE,
  createConsumedPrompt,
  createSourceSessionLink,
  createSourceSessionLinkClear,
  createStagedPrompt,
  createSupersededPrompt,
  getLatestPendingStagedPrompt,
  getLinkedSourceSessionFile,
} from "./handoff-state.js";

function customEntry(data) {
  return {
    type: "custom",
    customType: FXXK_STATE_CUSTOM_TYPE,
    data,
  };
}

function legacyCustomEntry(data, customType = "fuck-state") {
  return {
    type: "custom",
    customType,
    data,
  };
}

function typelessCustomEntry(data) {
  return {
    type: "custom",
    data,
  };
}

test("getLinkedSourceSessionFile returns the latest linked source session", () => {
  const sourceSessionFile = "/tmp/source-session.jsonl";

  assert.equal(
    getLinkedSourceSessionFile([
      customEntry(createSourceSessionLink(sourceSessionFile)),
    ]),
    sourceSessionFile,
  );
});

test("getLinkedSourceSessionFile clears the link after an explicit clear entry", () => {
  const sourceSessionFile = "/tmp/source-session.jsonl";

  assert.equal(
    getLinkedSourceSessionFile([
      customEntry(createSourceSessionLink(sourceSessionFile)),
      customEntry(createSourceSessionLinkClear(sourceSessionFile)),
    ]),
    null,
  );
});

test("getLatestPendingStagedPrompt returns the newest unconsumed staged prompt", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");

  const pending = getLatestPendingStagedPrompt([
    customEntry(firstPrompt),
    customEntry(secondPrompt),
  ]);

  assert.equal(pending?.promptId, secondPrompt.promptId);
  assert.equal(pending?.prompt, "second prompt");
});

test("getLatestPendingStagedPrompt keeps only the last /fxxk staging run active when older prompts are superseded", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");
  const thirdPrompt = createStagedPrompt("third prompt");

  const pending = getLatestPendingStagedPrompt([
    customEntry(firstPrompt),
    customEntry(createSupersededPrompt(firstPrompt.promptId)),
    customEntry(secondPrompt),
    customEntry(createSupersededPrompt(secondPrompt.promptId)),
    customEntry(thirdPrompt),
  ]);

  assert.equal(pending?.promptId, thirdPrompt.promptId);
  assert.equal(pending?.prompt, "third prompt");
});

test("getLatestPendingStagedPrompt skips consumed prompts and falls back to the next newest pending one", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");

  const pending = getLatestPendingStagedPrompt([
    customEntry(firstPrompt),
    customEntry(secondPrompt),
    customEntry(createConsumedPrompt(secondPrompt.promptId, "/tmp/child-session.jsonl")),
  ]);

  assert.equal(pending?.promptId, firstPrompt.promptId);
  assert.equal(pending?.prompt, "first prompt");
});

test("getLatestPendingStagedPrompt returns null when every staged prompt has been consumed", () => {
  const prompt = createStagedPrompt("only prompt");

  assert.equal(
    getLatestPendingStagedPrompt([
      customEntry(prompt),
      customEntry(createConsumedPrompt(prompt.promptId, "/tmp/child-session.jsonl")),
    ]),
    null,
  );
});

test("getLatestPendingStagedPrompt ignores superseded prompts from older staging runs", () => {
  const firstPrompt = createStagedPrompt("first prompt");
  const secondPrompt = createStagedPrompt("second prompt");

  const pending = getLatestPendingStagedPrompt([
    customEntry(firstPrompt),
    customEntry(createSupersededPrompt(firstPrompt.promptId)),
    customEntry(secondPrompt),
  ]);

  assert.equal(pending?.promptId, secondPrompt.promptId);
  assert.equal(pending?.prompt, "second prompt");
});

test("getLatestPendingStagedPrompt accepts legacy fuck-state entries", () => {
  const prompt = createStagedPrompt("legacy prompt");

  const pending = getLatestPendingStagedPrompt([
    legacyCustomEntry(prompt),
  ]);

  assert.equal(pending?.promptId, prompt.promptId);
  assert.equal(pending?.prompt, "legacy prompt");
});

test("getLatestPendingStagedPrompt accepts typeless historic entries when the kind is recognized", () => {
  const prompt = createStagedPrompt("typeless prompt");

  const pending = getLatestPendingStagedPrompt([
    typelessCustomEntry(prompt),
  ]);

  assert.equal(pending?.promptId, prompt.promptId);
  assert.equal(pending?.prompt, "typeless prompt");
});

test("getLinkedSourceSessionFile accepts typeless historic source-session-link entries", () => {
  const sourceSessionFile = "/tmp/source-session.jsonl";

  assert.equal(
    getLinkedSourceSessionFile([
      typelessCustomEntry(createSourceSessionLink(sourceSessionFile)),
    ]),
    sourceSessionFile,
  );
});
