function extractRawText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function looksLikePromptRequest(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const hasPromptLanguage = /(prompt|copy\s*-?paste|handoff|提示词|复制粘贴|交接)/i.test(normalized);
  const hasNewSessionLanguage = /(new session|resume.*session|continue.*session|新开会话|新会话|接手)/i.test(normalized);
  return hasPromptLanguage && hasNewSessionLanguage;
}

function includesExplicitReference(signalText, value) {
  const normalizedSignal = normalizeText(signalText).toLowerCase();
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedSignal || !normalizedValue) return false;
  return normalizedSignal.includes(normalizedValue);
}

export function extractLatestHandoffPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const lastUserIndex = [...messages].map((message) => message?.role).lastIndexOf("user");
  if (lastUserIndex === -1) return null;

  const lastUserText = extractRawText(messages[lastUserIndex]);
  if (!looksLikePromptRequest(lastUserText)) return null;

  const lastAssistant = messages
    .slice(lastUserIndex + 1)
    .filter((message) => message?.role === "assistant")
    .at(-1);
  if (!lastAssistant) return null;

  const assistantText = extractRawText(lastAssistant);
  if (!assistantText) return null;

  const fencedBlock = assistantText.match(/```(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)```/);
  const prompt = fencedBlock?.[1]?.trim();
  return prompt || null;
}

export function shouldPreferWorkflowTarget(target, evidence, goal = "") {
  if (!target) return false;

  const signalText = [
    goal,
    evidence?.primaryUserMessage ?? "",
    ...(evidence?.taskUserMessages ?? []),
    ...(evidence?.recentUserMessages ?? []),
    ...(evidence?.assistantStatusMessages ?? []),
    evidence?.latestAssistantText ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const hasConcreteSessionSignals = Boolean(
    normalizeText(signalText) ||
      (evidence?.modifiedFiles?.length ?? 0) > 0 ||
      (evidence?.readFiles?.length ?? 0) > 0,
  );

  const explicitReferences = [target.path, target.origin, target.title, target.nextStep]
    .filter(Boolean)
    .some((value) => includesExplicitReference(signalText, value));

  if (explicitReferences) {
    return true;
  }

  return !hasConcreteSessionSignals;
}
