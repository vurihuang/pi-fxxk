import { extractLatestHandoffPrompt, shouldPreferWorkflowTarget } from "./handoff-heuristics.js";
import { buildSessionEvidence } from "./session-evidence.js";

const MAX_FILE_COUNT = 8;

function ensureSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?。]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

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
  const { recentUserMessages, taskUserMessages, assistantStatusMessages, latestAssistantText, primaryUserMessage } = sessionEvidence;
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
    lines.push("Goal: infer the next concrete task and write the actual user message that should be sent now.");
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

  return {
    recentUserMessages,
    taskUserMessages,
    assistantStatusMessages,
    latestAssistantText,
    primaryUserMessage,
    modifiedFiles,
    readFiles,
    block: lines.join("\n"),
  };
}

function buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, evidence) {
  const target = getWorkflowTarget(workflowContext);
  const goalLine = goal.trim();

  if (target) {
    const taskSentence = target.uncheckedItems?.length > 0
      ? `Read ${target.path} first. Then resume this pending work: ${ensureSentence(target.uncheckedItems[0])}`
      : target.nextStep
        ? `Read ${target.path} first. Then follow this documented next step: ${ensureSentence(target.nextStep)}`
        : `Read ${target.path} first and use it as the source of truth for the next task.`;

    const lines = [taskSentence, ""];
    if (target.title) lines.push(`- Workflow file: ${target.path} (${target.title}).`);
    else lines.push(`- Workflow file: ${target.path}.`);
    if (target.status) lines.push(`- Status: ${target.status}.`);
    if (target.uncheckedItems?.length > 0) {
      lines.push(`- Pending work: ${target.uncheckedItems.join(" | ")}.`);
    }
    if (target.nextStep) {
      lines.push(`- Documented next step: ${target.nextStep}.`);
    }
    if (goalLine) {
      lines.push(`- Session goal: ${goalLine}.`);
    }
    if (sessionInfo.cwd && sessionInfo.cwd !== cwd) {
      lines.push(`- Relevant previous-session cwd: ${sessionInfo.cwd}.`);
    }
    lines.push("- Do not redo finished work or invent extra scope.");
    lines.push("- Report back with what you completed, which files changed, and the next natural step.");
    return lines.join("\n");
  }

  const taskBearingUserMessage = evidence.primaryUserMessage || evidence.recentUserMessages[evidence.recentUserMessages.length - 1] || "";
  const firstSentence = goalLine
    ? ensureSentence(goalLine)
    : taskBearingUserMessage
      ? ensureSentence(taskBearingUserMessage)
      : evidence.modifiedFiles.length > 0
        ? `Read ${evidence.modifiedFiles.join(", ")} first and continue the next unfinished task.`
        : "Inspect the latest changed files and continue the next unfinished task.";

  const lines = [firstSentence, ""];
  if (evidence.modifiedFiles.length > 0) {
    lines.push(`- Read these files first: ${evidence.modifiedFiles.join(", ")}.`);
  } else if (evidence.readFiles.length > 0) {
    lines.push(`- Inspect these files first: ${evidence.readFiles.join(", ")}.`);
  }
  if (evidence.latestAssistantText) {
    lines.push(`- Latest confirmed status: ${evidence.latestAssistantText}`);
  }
  if (sessionInfo.cwd && sessionInfo.cwd !== cwd) {
    lines.push(`- Relevant previous-session cwd: ${sessionInfo.cwd}.`);
  }
  lines.push("- Do not redo finished work or invent extra scope.");
  lines.push("- Report back with what you completed, which files changed, and the next natural step.");
  return lines.join("\n");
}

export function decideFuckAction({
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

  if (hasExplicitWorkflowTask(workflowTarget) && shouldPreferWorkflowTarget(workflowTarget, evidence, goal)) {
    return buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, evidence);
  }

  const prompt = await completePrompt({ evidenceBlock: evidence.block });
  return prompt || buildFallbackHandoff(sessionInfo, goal, cwd, workflowContext, evidence);
}

