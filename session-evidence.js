const MAX_RECENT_USER_MESSAGES = 3;
const MAX_MESSAGE_CHARS = 500;
const MAX_ASSISTANT_CHARS = 1000;
const USER_SIGNAL_MIN_COUNT = 2;
const USER_SIGNAL_MAX_COUNT = 8;
const USER_SIGNAL_TARGET_CHARS = 900;
const ASSISTANT_SIGNAL_MIN_COUNT = 1;
const ASSISTANT_SIGNAL_MAX_COUNT = 3;
const ASSISTANT_SIGNAL_TARGET_CHARS = 1400;

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

export function extractMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return normalizeText(message.content);
  if (!Array.isArray(message.content)) return "";

  return normalizeText(
    message.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n"),
  );
}

export function isLowSignalMessage(text) {
  return /^(continue|go on|继续|继续吧|继续。)$/i.test(normalizeText(text));
}

export function isMetaHandoffMessage(text) {
  const normalized = normalizeText(text);
  const hasPromptLanguage = /(prompt|copy\s*-?paste|handoff|提示词|复制粘贴|交接)/i.test(normalized);
  const hasNewSessionLanguage = /(new session|resume.*session|continue.*session|新开会话|新会话|接手)/i.test(normalized);
  return hasPromptLanguage && hasNewSessionLanguage;
}

function hasStrongTaskSignal(text) {
  return /(?:https?:\/\/|\/[A-Za-z0-9._-]+|\.[A-Za-z0-9]+\b|\bpnpm\b|\bgo test\b|\bmake check\b|\btypecheck\b|\bverify\b|\b验证\b|\b修复\b|\b实现\b|\b检查\b)/i.test(text) || text.length >= 160;
}

export function collectRecentMessageSnippets(messages, role, maxCount, maxChars) {
  return messages
    .filter((message) => message?.role === role)
    .map(extractMessageText)
    .filter((text) => text && !isLowSignalMessage(text))
    .slice(-maxCount)
    .map((text) => truncateText(text, maxChars));
}

export function collectAdaptiveMessageSnippets(
  messages,
  {
    role,
    minCount,
    maxCount,
    targetChars,
    maxChars,
    skipMetaHandoff = false,
  },
) {
  const collected = [];
  let totalChars = 0;
  let foundStrongSignal = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== role) continue;

    const text = extractMessageText(message);
    if (!text || isLowSignalMessage(text)) continue;
    if (skipMetaHandoff && isMetaHandoffMessage(text)) continue;

    const snippet = truncateText(text, maxChars);
    if (!snippet) continue;

    collected.push(snippet);
    totalChars += snippet.length;
    if (hasStrongTaskSignal(snippet)) {
      foundStrongSignal = true;
    }

    const isSufficient = collected.length >= minCount && totalChars >= targetChars && foundStrongSignal;
    if (isSufficient || collected.length >= maxCount) {
      break;
    }
  }

  return collected.reverse();
}

export function buildSessionEvidence(messages) {
  const recentUserMessages = collectRecentMessageSnippets(
    messages,
    "user",
    MAX_RECENT_USER_MESSAGES,
    MAX_MESSAGE_CHARS,
  );
  const taskUserMessages = collectAdaptiveMessageSnippets(messages, {
    role: "user",
    minCount: USER_SIGNAL_MIN_COUNT,
    maxCount: USER_SIGNAL_MAX_COUNT,
    targetChars: USER_SIGNAL_TARGET_CHARS,
    maxChars: MAX_MESSAGE_CHARS,
    skipMetaHandoff: true,
  });
  const assistantStatusMessages = collectAdaptiveMessageSnippets(messages, {
    role: "assistant",
    minCount: ASSISTANT_SIGNAL_MIN_COUNT,
    maxCount: ASSISTANT_SIGNAL_MAX_COUNT,
    targetChars: ASSISTANT_SIGNAL_TARGET_CHARS,
    maxChars: MAX_ASSISTANT_CHARS,
  });

  const latestTaskUserMessage = taskUserMessages[taskUserMessages.length - 1] ?? "";
  const latestRecentNonMetaUserMessage = [...recentUserMessages].reverse().find((text) => !isMetaHandoffMessage(text)) ?? "";

  return {
    recentUserMessages,
    taskUserMessages,
    assistantStatusMessages,
    latestAssistantText: assistantStatusMessages[assistantStatusMessages.length - 1] ?? "",
    primaryUserMessage: latestTaskUserMessage || latestRecentNonMetaUserMessage || recentUserMessages[recentUserMessages.length - 1] || "",
  };
}
