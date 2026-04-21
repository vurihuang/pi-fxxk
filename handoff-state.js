import { randomUUID } from "node:crypto";

export const FUCK_STATE_CUSTOM_TYPE = "fuck-state";
const SOURCE_SESSION_LINK_KIND = "source-session-link";
const CLEAR_SOURCE_SESSION_LINK_KIND = "clear-source-session-link";
const STAGED_PROMPT_KIND = "staged-prompt";
const SUPERSEDED_PROMPT_KIND = "superseded-prompt";
const CONSUMED_PROMPT_KIND = "consumed-prompt";

function isFuckStateEntry(entry) {
  return entry?.type === "custom" && entry.customType === FUCK_STATE_CUSTOM_TYPE && entry.data && typeof entry.data === "object";
}

function getStateData(entry) {
  return isFuckStateEntry(entry) ? entry.data : null;
}

export function createSourceSessionLink(sourceSessionFile) {
  return {
    kind: SOURCE_SESSION_LINK_KIND,
    sourceSessionFile,
    linkedAt: Date.now(),
  };
}

export function createSourceSessionLinkClear(sourceSessionFile) {
  return {
    kind: CLEAR_SOURCE_SESSION_LINK_KIND,
    sourceSessionFile,
    clearedAt: Date.now(),
  };
}

export function getLinkedSourceSessionFile(entries) {
  let linkedSourceSessionFile = null;

  for (const entry of entries) {
    const data = getStateData(entry);
    if (!data) continue;

    if (data.kind === SOURCE_SESSION_LINK_KIND && typeof data.sourceSessionFile === "string") {
      linkedSourceSessionFile = data.sourceSessionFile;
      continue;
    }

    if (data.kind === CLEAR_SOURCE_SESSION_LINK_KIND) {
      if (!data.sourceSessionFile || data.sourceSessionFile === linkedSourceSessionFile) {
        linkedSourceSessionFile = null;
      }
    }
  }

  return linkedSourceSessionFile;
}

export function createStagedPrompt(prompt) {
  return {
    kind: STAGED_PROMPT_KIND,
    promptId: randomUUID(),
    prompt,
    stagedAt: Date.now(),
  };
}

export function createSupersededPrompt(promptId) {
  return {
    kind: SUPERSEDED_PROMPT_KIND,
    promptId,
    supersededAt: Date.now(),
  };
}

export function createConsumedPrompt(promptId, consumerSessionFile) {
  return {
    kind: CONSUMED_PROMPT_KIND,
    promptId,
    consumerSessionFile,
    consumedAt: Date.now(),
  };
}

export function getLatestPendingStagedPrompt(entries) {
  const unavailablePromptIds = new Set();

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const data = getStateData(entries[index]);
    if (!data) continue;

    if ((data.kind === CONSUMED_PROMPT_KIND || data.kind === SUPERSEDED_PROMPT_KIND) && typeof data.promptId === "string") {
      unavailablePromptIds.add(data.promptId);
      continue;
    }

    if (
      data.kind === STAGED_PROMPT_KIND
      && typeof data.promptId === "string"
      && typeof data.prompt === "string"
      && !unavailablePromptIds.has(data.promptId)
    ) {
      return {
        promptId: data.promptId,
        prompt: data.prompt,
        stagedAt: data.stagedAt ?? null,
      };
    }
  }

  return null;
}
