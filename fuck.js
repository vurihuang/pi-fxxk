import { readFileSync } from "node:fs";

import { complete } from "@mariozechner/pi-ai";
import { BorderedLoader, SessionManager } from "@mariozechner/pi-coding-agent";

import { buildHandoffPromptFromMessages, decideFuckAction } from "./fuck-core.js";
import {
  FUCK_STATE_CUSTOM_TYPE,
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
    "/fuck falling back to deterministic continuation after two empty model responses:",
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

function loadSourceSessionState(ctx) {
  const sourceSessionFile = getLinkedSourceSessionFile(ctx.sessionManager.getBranch());
  if (!sourceSessionFile) {
    return null;
  }

  try {
    const sourceSession = SessionManager.open(sourceSessionFile, ctx.sessionManager.getSessionDir());
    const pendingPrompt = getLatestPendingStagedPrompt(sourceSession.getBranch());
    return {
      sourceSessionFile,
      sourceSession,
      sourceSessionInfo: getSessionInfo(sourceSession, { path: sourceSessionFile }),
      pendingPrompt,
    };
  } catch {
    return {
      sourceSessionFile,
      sourceSession: null,
      sourceSessionInfo: null,
      pendingPrompt: null,
    };
  }
}

async function generatePromptWithLoader(ctx, sessionLabel, buildPrompt) {
  if (!ctx.hasUI) {
    return buildPrompt();
  }

  const result = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    const loader = new BorderedLoader(tui, theme, `Composing the next /fuck prompt from ${sessionLabel}...`);
    loader.onAbort = () => done({ prompt: null, error: null });

    buildPrompt(loader.signal)
      .then((prompt) => done({ prompt, error: null }))
      .catch((error) => {
        console.error("/fuck generation failed:", error);
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

  const reviewedPrompt = await ctx.ui.editor("Review or copy the staged /fuck prompt", prompt);
  if (reviewedPrompt === undefined) {
    return prompt;
  }

  const trimmedPrompt = reviewedPrompt.trim();
  return trimmedPrompt || prompt;
}

async function stageCurrentSessionPrompt(pi, ctx, goal) {
  const currentSessionInfo = getSessionInfo(ctx.sessionManager);
  if (!currentSessionInfo.path) {
    ctx.ui.notify("/fuck staging requires a persisted session file.", "error");
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
    ctx.ui.notify("/fuck was cancelled.", "info");
    return;
  }

  const stagedPrompt = await reviewPromptForStaging(ctx, prompt);
  const latestPendingPrompt = getLatestPendingStagedPrompt(ctx.sessionManager.getBranch());
  if (latestPendingPrompt) {
    pi.appendEntry(FUCK_STATE_CUSTOM_TYPE, createSupersededPrompt(latestPendingPrompt.promptId));
  }
  pi.appendEntry(FUCK_STATE_CUSTOM_TYPE, createStagedPrompt(stagedPrompt));
  ctx.ui.notify("Staged a /fuck prompt. Run /new, then /fuck in the new session.", "info");
}

function clearSourceSessionLink(pi, sourceSessionFile) {
  pi.appendEntry(FUCK_STATE_CUSTOM_TYPE, createSourceSessionLinkClear(sourceSessionFile));
}

async function consumeStagedPrompt(pi, ctx, sourceState) {
  const { pendingPrompt, sourceSession, sourceSessionFile, sourceSessionInfo } = sourceState;
  if (!pendingPrompt || !sourceSession) {
    ctx.ui.notify("The staged /fuck prompt could not be loaded.", "error");
    return;
  }

  sendPrompt(pi, ctx, pendingPrompt.prompt);
  sourceSession.appendCustomEntry(
    FUCK_STATE_CUSTOM_TYPE,
    createConsumedPrompt(pendingPrompt.promptId, ctx.sessionManager.getSessionFile() ?? `session:${ctx.sessionManager.getSessionId()}`),
  );
  clearSourceSessionLink(pi, sourceSessionFile);
  ctx.ui.notify(`Sent the staged /fuck prompt from ${getSessionLabel(sourceSessionInfo)}`, "info");
}

async function runFuck(pi, args, ctx) {
  if (!ctx.model) {
    ctx.ui.notify("/fuck requires an active model.", "error");
    return;
  }

  const goal = args.trim();
  const { messages, hasSupportEntries } = getSessionMessagesAndSupportEntries(ctx.sessionManager);
  const sourceState = loadSourceSessionState(ctx);
  const action = decideFuckAction({
    hasCurrentSessionHistory: messages.length > 0 || hasSupportEntries,
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

  ctx.ui.notify("No staged /fuck prompt found. Run /fuck in the previous session first.", "warning");
}

export default function fuckExtension(pi) {
  pi.on("session_start", async (event) => {
    if (event.reason === "new" && event.previousSessionFile) {
      pi.appendEntry(FUCK_STATE_CUSTOM_TYPE, createSourceSessionLink(event.previousSessionFile));
    }
  });

  pi.registerCommand("fuck", {
    description: "Stage a handoff prompt in the current session, or consume a staged prompt in the next session",
    handler: async (args, ctx) => {
      await runFuck(pi, args, ctx);
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

    if (text === "fuck" || text.startsWith("fuck ")) {
      await runFuck(pi, text === "fuck" ? "" : text.slice(4).trim(), ctx);
      return { action: "handled" };
    }

    return { action: "continue" };
  });
}
