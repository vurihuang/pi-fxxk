import { buildHandoffContract, renderHandoffContract } from "./handoff-contract.js";
import { extractLatestHandoffPrompt, shouldPreferWorkflowTarget } from "./handoff-heuristics.js";
import { buildSessionEvidence } from "./session-evidence.js";

const MAX_FILE_COUNT = 24;

function formatWorkflowContextBlock(workflowContext) {
  if (!workflowContext || workflowContext.lines.length === 0) return "";

  return [
    "Structured workflow context was found in the workspace. Prefer these markdown artifacts when they clearly define the next task:",
    ...workflowContext.lines,
  ].join("\n");
}

function getWorkflowTarget(workflowContext) {
  return workflowContext.activePlan ?? workflowContext.requirements ?? workflowContext.genericWorkflowDocs[0] ?? null;
}

function hasExplicitWorkflowTask(target) {
  return Boolean(target && ((target.uncheckedItems?.length ?? 0) > 0 || target.nextStep || target.status === "active"));
}

function collectFileEvidence(messages) {
  const modifiedFiles = [];
  const readFiles = [];
  const modified = new Set();
  const read = new Set();

  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (block?.type !== "toolCall" || !block.name || typeof block.arguments !== "object" || !block.arguments) {
        continue;
      }

      const filePath = typeof block.arguments.path === "string" ? block.arguments.path : null;
      if (!filePath) continue;

      if (block.name === "edit" || block.name === "write") {
        if (!modified.has(filePath)) {
          modified.add(filePath);
          modifiedFiles.push(filePath);
        }
        read.delete(filePath);
        continue;
      }

      if (block.name === "read" && !modified.has(filePath) && !read.has(filePath)) {
        read.add(filePath);
        readFiles.push(filePath);
      }
    }
  }

  return {
    modifiedFiles: modifiedFiles.slice(-MAX_FILE_COUNT),
    readFiles: readFiles.filter((filePath) => !modified.has(filePath)).slice(-MAX_FILE_COUNT),
  };
}


function buildCompactEvidence(messages, goal, cwd, sessionInfo, workflowContext) {
  const sessionEvidence = buildSessionEvidence(messages);
  const {
    recentUserMessages,
    taskUserMessages,
    assistantStatusMessages,
    latestAssistantText,
    primaryUserMessage,
    structuredAssistantSummary,
  } = sessionEvidence;
  const { modifiedFiles, readFiles } = collectFileEvidence(messages);
  const lines = [];

  lines.push(`Working directory: ${cwd}`);
  if (sessionInfo.cwd && sessionInfo.cwd !== cwd) {
    lines.push(`Relevant previous-session cwd: ${sessionInfo.cwd}`);
  }

  const trimmedGoal = goal.trim();
  if (trimmedGoal) {
    lines.push(`Goal: ${trimmedGoal}`);
  } else {
    lines.push("Goal: write the strongest continuation handoff for a new session, preserving actual progress and remaining work.");
  }

  const workflowBlock = formatWorkflowContextBlock(workflowContext);
  if (workflowBlock) {
    lines.push("");
    lines.push(workflowBlock);
  }

  if (taskUserMessages.length > 0) {
    lines.push("");
    lines.push("Most relevant recent user requests (scanned backward until task context was sufficient):");
    for (const message of taskUserMessages) {
      lines.push(`- ${message}`);
    }
  } else if (recentUserMessages.length > 0) {
    lines.push("");
    lines.push("Most recent user requests:");
    for (const message of recentUserMessages) {
      lines.push(`- ${message}`);
    }
  }

  if (structuredAssistantSummary) {
    lines.push("");
    lines.push("Structured handoff state extracted from the latest assistant summary:");
    if (structuredAssistantSummary.sectionTitles.length > 0) {
      lines.push(`- Original section titles: ${structuredAssistantSummary.sectionTitles.join(" | ")}`);
    }
    if (structuredAssistantSummary.completedItems.length > 0) {
      lines.push("- Already completed:");
      for (const item of structuredAssistantSummary.completedItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.remainingItems.length > 0) {
      lines.push("- Remaining work:");
      for (const item of structuredAssistantSummary.remainingItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.fileItems.length > 0) {
      lines.push("- Key files already touched:");
      for (const item of structuredAssistantSummary.fileItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.sourceDocuments.length > 0) {
      lines.push("- Source documents explicitly referenced:");
      for (const item of structuredAssistantSummary.sourceDocuments) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.verificationItems.length > 0) {
      lines.push("- Verification already confirmed:");
      for (const item of structuredAssistantSummary.verificationItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.constraintItems.length > 0) {
      lines.push("- Constraints to preserve:");
      for (const item of structuredAssistantSummary.constraintItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.completionItems.length > 0) {
      lines.push("- Completion criteria:");
      for (const item of structuredAssistantSummary.completionItems) lines.push(`  - ${item}`);
    }
    if (structuredAssistantSummary.contextItems.length > 0) {
      lines.push("- Context:");
      for (const item of structuredAssistantSummary.contextItems) lines.push(`  - ${item}`);
    }
  }

  if (assistantStatusMessages.length > 0) {
    lines.push("");
    lines.push("Recent assistant status/report messages (scanned backward for continuity):");
    for (const message of assistantStatusMessages) {
      lines.push(`- ${message}`);
    }
  }

  if (modifiedFiles.length > 0) {
    lines.push("");
    lines.push("Recently modified files:");
    for (const filePath of modifiedFiles) {
      lines.push(`- ${filePath}`);
    }
  }

  if (readFiles.length > 0) {
    lines.push("");
    lines.push("Recently read-only files:");
    for (const filePath of readFiles) {
      lines.push(`- ${filePath}`);
    }
  }

  const languageSignalText = [
    ...taskUserMessages,
    ...recentUserMessages,
    ...assistantStatusMessages,
    primaryUserMessage,
    latestAssistantText,
    ...(structuredAssistantSummary?.sectionTitles ?? []),
    ...(structuredAssistantSummary?.contextItems ?? []),
    ...(structuredAssistantSummary?.remainingItems ?? []),
    ...(structuredAssistantSummary?.constraintItems ?? []),
    ...(structuredAssistantSummary?.sourceDocuments ?? []),
  ].filter(Boolean).join("\n");

  return {
    recentUserMessages,
    taskUserMessages,
    assistantStatusMessages,
    latestAssistantText,
    primaryUserMessage,
    modifiedFiles,
    readFiles,
    completedItems: structuredAssistantSummary?.completedItems ?? [],
    remainingItems: structuredAssistantSummary?.remainingItems ?? [],
    fileItems: structuredAssistantSummary?.fileItems ?? [],
    verificationItems: structuredAssistantSummary?.verificationItems ?? [],
    constraintItems: structuredAssistantSummary?.constraintItems ?? [],
    completionItems: structuredAssistantSummary?.completionItems ?? [],
    contextItems: structuredAssistantSummary?.contextItems ?? [],
    sourceDocuments: structuredAssistantSummary?.sourceDocuments ?? [],
    sectionTitles: structuredAssistantSummary?.sectionTitles ?? [],
    structuredSections: structuredAssistantSummary?.sections ?? [],
    preferredLanguage: /[\u3400-\u9fff\uf900-\ufaff]/.test(languageSignalText) ? "chinese" : "english",
    block: lines.join("\n"),
  };
}

function buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, evidence) {
  const workflowTarget = getWorkflowTarget(workflowContext);
  const contract = buildHandoffContract({
    goal,
    cwd,
    sessionInfo,
    workflowTarget,
    evidence,
  });

  return renderHandoffContract(contract, { forceContractFormat: true });
}

export function decideFxxkAction({
  hasCurrentSessionHistory,
  hasPendingStagedPrompt,
}) {
  if (hasCurrentSessionHistory) {
    return "stage-current-session";
  }

  return hasPendingStagedPrompt ? "consume-staged-prompt" : "warn-no-staged-prompt";
}

export async function buildHandoffPromptFromMessages({
  messages,
  goal,
  cwd,
  sessionInfo,
  workflowContext,
  completePrompt,
  hasSupportEntries = false,
}) {
  if (messages.length === 0 && !hasSupportEntries) {
    throw new Error("The session does not contain usable message content.");
  }

  const evidence = buildCompactEvidence(messages, goal, cwd, sessionInfo, workflowContext);
  const workflowTarget = getWorkflowTarget(workflowContext);
  const latestHandoffPrompt = extractLatestHandoffPrompt(messages);

  if (latestHandoffPrompt) {
    return latestHandoffPrompt;
  }

  const shouldForceWorkflowFallback = hasExplicitWorkflowTask(workflowTarget)
    && (shouldPreferWorkflowTarget(workflowTarget, evidence, goal) || evidence.preferredLanguage === "chinese");

  if (shouldForceWorkflowFallback) {
    const workflowEvidence = {
      ...evidence,
      sourceDocuments: [...new Set([...(evidence.sourceDocuments ?? []), workflowTarget.path])],
      primaryUserMessage: evidence.primaryUserMessage || evidence.latestAssistantText,
      contextItems: [
        ...(evidence.contextItems ?? []),
        ...(evidence.primaryUserMessage ? [evidence.primaryUserMessage] : []),
      ],
    };

    return buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, workflowEvidence);
  }

  const prompt = await completePrompt({
    evidenceBlock: [
      evidence.block,
      "",
      "Return a strong continuation contract that preserves completed work, remaining work, verification, constraints, and completion criteria when supported by the evidence.",
      "If the evidence already resembles a high-quality handoff note, preserve that shape instead of flattening it into generic bullets.",
      "Prefer sectioned output when supported by the evidence. Good section patterns include: current context, already completed, files to read first, verification already passing, remaining tasks, constraints to preserve, done when, and report back.",
      "If the preserved evidence is mostly Chinese, prefer Chinese section headings and phrasing; if it is mostly English, prefer English. Choose the response language naturally from the evidence and user context.",
      "Do not dump the full latest assistant summary back into the handoff once its structure has already been extracted.",
    ].join("\n"),
  });
  return prompt || buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, evidence);
}

