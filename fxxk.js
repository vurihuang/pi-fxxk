import { readFileSync } from "node:fs";

import { complete } from "@mariozechner/pi-ai";
import { BorderedLoader, SessionManager } from "@mariozechner/pi-coding-agent";

import {
  buildHandoffPromptFromMessages,
  decideFxxkAction,
  getConsumableStagedPrompt,
  getFallbackSourceSessionCandidates,
  hasMatchingSessionCwd,
} from "./fxxk-core.js";
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
import { discoverWorkflowContext } from "./workflow-context.js";

const HANDOFF_SYSTEM_PROMPT = readFileSync(new URL("./handoff-system-prompt.md", import.meta.url), "utf8").trim();
const FXXK_STATE_ENTRY_TYPE = typeof FXXK_STATE_CUSTOM_TYPE === "string" && FXXK_STATE_CUSTOM_TYPE
  ? FXXK_STATE_CUSTOM_TYPE
  : "fxxk-state";

function getSessionLabel(session) {
  if (session.name?.trim()) return session.name.trim();
  if (session.firstMessage?.trim()) return session.firstMessage.trim().slice(0, 60);
  return session.id;
}

function getPromptText(response) {
  const directOutputText = typeof response?.output_text === "string" ? response.output_text.trim() : "";
  if (directOutputText) {
    return directOutputText;
  }

  if (!Array.isArray(response?.content)) {
    return "";
  }

  const exactTextBlocks = response.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (exactTextBlocks) {
    return exactTextBlocks;
  }

  return response.content
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      return typeof item.text === "string" && item.text.trim() ? [item.text.trim()] : [];
    })
    .join("\n")
    .trim();
}

function getRetryMessage() {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: "Your previous reply was empty. Return the actual next user message now. Do not summarize the whole session or leave the response blank.",
      },
    ],
    timestamp: Date.now(),
  };
}

function summarizeResponseShape(response) {
  const blockTypes = Array.isArray(response?.content)
    ? response.content.map((item) => item?.type ?? typeof item).join(", ") || "none"
    : "none";
  const hasOutputText = typeof response?.output_text === "string" && response.output_text.length > 0;
  return `stopReason=${response?.stopReason ?? "unknown"}; contentTypes=${blockTypes}; hasOutputText=${hasOutputText}`;
}

function getSessionMessagesAndSupportEntries(sessionManager) {
  const branch = sessionManager.getBranch();
  return {
    messages: branch.filter((entry) => entry.type === "message").map((entry) => entry.message),
    hasSupportEntries: branch.some((entry) => entry.type === "compaction" || entry.type === "branch_summary"),
  };
}

function getSessionInfo(sessionManager, overrides = {}) {
  return {
    path: overrides.path ?? sessionManager.getSessionFile(),
    cwd: overrides.cwd ?? sessionManager.getCwd(),
    id: overrides.id ?? sessionManager.getSessionId(),
    name: overrides.name ?? sessionManager.getSessionName?.(),
    firstMessage: overrides.firstMessage,
  };
}

function sendPrompt(pi, ctx, prompt) {
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
}

async function completePromptFromEvidence(ctx, evidenceBlock, signal) {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error);
  }

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Compact continuation evidence follows. Write the actual next user message to send now.",
            "Do not summarize the whole session or add handoff narration.",
            "",
            evidenceBlock,
          ].join("\n"),
        },
      ],
      timestamp: Date.now(),
    },
  ];

  const response = await complete(
    ctx.model,
    {
      systemPrompt: HANDOFF_SYSTEM_PROMPT,
      messages,
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal },
  );

  if (response.stopReason === "aborted") {
    return null;
  }

  const prompt = getPromptText(response);
  if (prompt) {
    return prompt;
  }

  const retryResponse = await complete(
    ctx.model,
    {
      systemPrompt: HANDOFF_SYSTEM_PROMPT,
      messages: [...messages, getRetryMessage()],
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal },
  );

  if (retryResponse.stopReason === "aborted") {
    return null;
  }

  const retryPrompt = getPromptText(retryResponse);
  if (retryPrompt) {
    return retryPrompt;
  }

  console.warn(
    "/fxxk falling back to deterministic continuation after two empty model responses:",
    summarizeResponseShape(response),
    summarizeResponseShape(retryResponse),
  );

  return null;
}

async function buildPromptForSession(ctx, sessionManager, sessionInfo, goal, signal) {
  const { messages, hasSupportEntries } = getSessionMessagesAndSupportEntries(sessionManager);
  const workflowContext = discoverWorkflowContext(ctx.cwd);

  return buildHandoffPromptFromMessages({
    messages,
    goal,
    cwd: ctx.cwd,
    sessionInfo,
    workflowContext,
    hasSupportEntries,
    completePrompt: ({ evidenceBlock }) => completePromptFromEvidence(ctx, evidenceBlock, signal),
  });
}

function openSourceSessionState(sourceSessionFile, sessionDir, currentCwd) {
  try {
    const sourceSession = SessionManager.open(sourceSessionFile, sessionDir);
    const sourceSessionInfo = getSessionInfo(sourceSession, { path: sourceSessionFile });
    const isSameCwd = hasMatchingSessionCwd({
      sourceSessionCwd: sourceSessionInfo.cwd,
      currentCwd,
    });
    const pendingPrompt = getConsumableStagedPrompt({
      sourceSessionCwd: sourceSessionInfo.cwd,
      currentCwd,
      entries: sourceSession.getBranch(),
    });
    return {
      sourceSessionFile,
      sourceSession,
      sourceSessionInfo,
      pendingPrompt,
      isSameCwd,
    };
  } catch {
    return {
      sourceSessionFile,
      sourceSession: null,
      sourceSessionInfo: null,
      pendingPrompt: null,
      isSameCwd: false,
    };
  }
}

async function loadFallbackSourceSessionState(ctx) {
  const currentHeader = ctx.sessionManager.getHeader();
  const sessionInfos = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
  const candidates = getFallbackSourceSessionCandidates({
    currentSessionCreatedAt: currentHeader?.timestamp ? new Date(currentHeader.timestamp) : null,
    currentSessionCwd: ctx.cwd,
    currentSessionFile: ctx.sessionManager.getSessionFile(),
    currentSessionId: ctx.sessionManager.getSessionId(),
    sessionInfos,
  });

  for (const candidate of candidates) {
    const state = openSourceSessionState(candidate.path, ctx.sessionManager.getSessionDir(), ctx.cwd);
    if (state.pendingPrompt) {
      return state;
    }
  }

  return null;
}

async function loadSourceSessionState(ctx) {
  const linkedSourceSessionFile = getLinkedSourceSessionFile(ctx.sessionManager.getBranch());
  if (linkedSourceSessionFile) {
    const linkedState = openSourceSessionState(linkedSourceSessionFile, ctx.sessionManager.getSessionDir(), ctx.cwd);
    if (linkedState.pendingPrompt || linkedState.isSameCwd === false) {
      return linkedState;
    }
  }

  return loadFallbackSourceSessionState(ctx);
}

async function generatePromptWithLoader(ctx, sessionLabel, buildPrompt) {
  if (!ctx.hasUI) {
    return buildPrompt();
  }

  const result = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, `Composing the next /fxxk prompt from ${sessionLabel}...`);
    loader.onAbort = () => done({ prompt: null, error: null });

    buildPrompt(loader.signal)
      .then((prompt) => done({ prompt, error: null }))
      .catch((error) => {
        console.error("/fxxk generation failed:", error);
        done({ prompt: null, error: error instanceof Error ? error.message : String(error) });
      });

    return loader;
  });

  if (!result || result.error || !result.prompt) {
    if (result?.error) {
      throw new Error(result.error);
    }
    return null;
  }

  return result.prompt;
}

async function reviewPromptForStaging(ctx, prompt) {
  if (!ctx.hasUI) {
    return prompt;
  }

  const reviewedPrompt = await ctx.ui.editor("Review or copy the staged /fxxk prompt", prompt);
  if (reviewedPrompt === undefined) {
    return prompt;
  }

  const trimmedPrompt = reviewedPrompt.trim();
  return trimmedPrompt || prompt;
}

async function stageCurrentSessionPrompt(pi, ctx, goal) {
  const currentSessionInfo = getSessionInfo(ctx.sessionManager);
  if (!currentSessionInfo.path) {
    ctx.ui.notify("/fxxk staging requires a persisted session file.", "error");
    return;
  }

  let prompt;
  try {
    prompt = await generatePromptWithLoader(ctx, getSessionLabel(currentSessionInfo), (signal) =>
      buildPromptForSession(ctx, ctx.sessionManager, currentSessionInfo, goal, signal));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(message, "error");
    return;
  }

  if (!prompt) {
    ctx.ui.notify("/fxxk was cancelled.", "info");
    return;
  }

  const stagedPrompt = await reviewPromptForStaging(ctx, prompt);
  const latestPendingPrompt = getLatestPendingStagedPrompt(ctx.sessionManager.getBranch());
  if (latestPendingPrompt) {
    pi.appendEntry(FXXK_STATE_ENTRY_TYPE, createSupersededPrompt(latestPendingPrompt.promptId));
  }
  pi.appendEntry(FXXK_STATE_ENTRY_TYPE, createStagedPrompt(stagedPrompt));
  ctx.ui.notify("Staged a /fxxk prompt. Run /new, then /fxxk in the new session.", "info");
}

function clearSourceSessionLink(pi, sourceSessionFile) {
  pi.appendEntry(FXXK_STATE_ENTRY_TYPE, createSourceSessionLinkClear(sourceSessionFile));
}

async function consumeStagedPrompt(pi, ctx, sourceState) {
  const {
    pendingPrompt,
    sourceSession,
    sourceSessionFile,
    sourceSessionInfo,
    isSameCwd,
  } = sourceState;
  if (!isSameCwd) {
    clearSourceSessionLink(pi, sourceSessionFile);
    ctx.ui.notify("Refused to consume a staged /fxxk prompt from a different working directory.", "warning");
    return;
  }

  if (!pendingPrompt || !sourceSession) {
    ctx.ui.notify("The staged /fxxk prompt could not be loaded.", "error");
    return;
  }

  sendPrompt(pi, ctx, pendingPrompt.prompt);
  sourceSession.appendCustomEntry(
    FXXK_STATE_ENTRY_TYPE,
    createConsumedPrompt(pendingPrompt.promptId, ctx.sessionManager.getSessionFile() ?? `session:${ctx.sessionManager.getSessionId()}`),
  );
  clearSourceSessionLink(pi, sourceSessionFile);
  ctx.ui.notify(`Sent the staged /fxxk prompt from ${getSessionLabel(sourceSessionInfo)}`, "info");
}

async function runFxxk(pi, args, ctx) {
  if (!ctx.model) {
    ctx.ui.notify("/fxxk requires an active model.", "error");
    return;
  }

  const goal = args.trim();
  const { messages, hasSupportEntries } = getSessionMessagesAndSupportEntries(ctx.sessionManager);
  const hasCurrentSessionHistory = messages.length > 0 || hasSupportEntries;
  const sourceState = await loadSourceSessionState(ctx);

  if (!hasCurrentSessionHistory && sourceState?.sourceSessionFile && sourceState.isSameCwd === false) {
    clearSourceSessionLink(pi, sourceState.sourceSessionFile);
    ctx.ui.notify("Refused to consume a staged /fxxk prompt from a different working directory.", "warning");
    return;
  }

  const action = decideFxxkAction({
    hasCurrentSessionHistory,
    hasPendingStagedPrompt: Boolean(sourceState?.pendingPrompt),
  });

  if (action === "stage-current-session") {
    await stageCurrentSessionPrompt(pi, ctx, goal);
    return;
  }

  if (action === "consume-staged-prompt") {
    await consumeStagedPrompt(pi, ctx, sourceState);
    return;
  }

  ctx.ui.notify("No staged /fxxk prompt found. Run /fxxk in the previous session first.", "warning");
}

export default function fxxkExtension(pi) {
  pi.on("session_start", async (event) => {
    if (event.reason === "new" && event.previousSessionFile) {
      pi.appendEntry(FXXK_STATE_ENTRY_TYPE, createSourceSessionLink(event.previousSessionFile));
    }
  });

  pi.registerCommand("fxxk", {
    description: "Stage a handoff prompt in the current session, or consume a staged prompt in the next session",
    handler: async (args, ctx) => {
      await runFxxk(pi, args, ctx);
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const text = event.text.trim();
    if (!text || text.startsWith("/")) {
      return { action: "continue" };
    }

    if (text === "fxxk" || text.startsWith("fxxk ")) {
      await runFxxk(pi, text === "fxxk" ? "" : text.slice(4).trim(), ctx);
      return { action: "handled" };
    }

    return { action: "continue" };
  });
}
