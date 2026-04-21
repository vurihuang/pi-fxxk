const MAX_RECENT_USER_MESSAGES = 3;
const MAX_MESSAGE_CHARS = 500;
const MAX_ASSISTANT_CHARS = 1000;
const USER_SIGNAL_MIN_COUNT = 2;
const USER_SIGNAL_MAX_COUNT = 8;
const USER_SIGNAL_TARGET_CHARS = 900;
const ASSISTANT_SIGNAL_MIN_COUNT = 1;
const ASSISTANT_SIGNAL_MAX_COUNT = 3;
const ASSISTANT_SIGNAL_TARGET_CHARS = 1400;
const MAX_STRUCTURED_ITEMS = 6;
const MAX_FILE_SECTION_ITEMS = 32;
const MAX_SOURCE_SECTION_ITEMS = 12;
const STRUCTURED_SCAN_LIMIT = 6;
const MAX_SOURCE_DOCS = 12;

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

export function extractRawMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";

  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function extractMessageText(message) {
  return normalizeText(extractRawMessageText(message));
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

function cleanStructuredLine(text) {
  return normalizeText(
    text
      .replace(/^\s*[-*]\s*\[[ xX]\]\s+/, "")
      .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
      .replace(/^\s*#+\s+/, "")
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/[:：]\s*$/, ""),
  );
}

function looksLikeSourceDocumentItem(text) {
  return /(?:^|\s)(?:docs\/[A-Za-z0-9._\/-]+\.(?:md|sql|ts|tsx|go)|[A-Za-z0-9._\/-]+\.(?:md|sql|ts|tsx|go))(?:\s|$)/.test(text)
    || /^https?:\/\//i.test(text);
}

function looksLikeStructuredHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || /^```/.test(trimmed) || /^[-─—]{3,}$/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed) || /^\*\*.+\*\*$/.test(trimmed)) return true;
  if (/^(?:[-*]|\d+\.)\s+/.test(trimmed)) return false;

  const candidate = cleanStructuredLine(trimmed);
  if (!candidate || candidate.length > 60 || /[.!?。]$/.test(candidate)) return false;
  return /(输入文档|source documents?|上下文|背景|summary|状态|effect|完成|done|completed|剩余|remaining|next|todo|未完成|文件|files|验证|verification|tests|checks|命令|要求|constraints|标准|criteria|risk|风险)/i.test(candidate);
}

function classifyStructuredSection(title) {
  const normalized = normalizeText(title);
  if (/(输入文档|source documents?)/i.test(normalized)) return "sources";
  if (/(已完成|completed|done|finished|效果总结|current effect|current status)/i.test(normalized)) return "completed";
  if (/(还没做完|remaining|next|todo|未完成|worth continuing|pending|下一轮|next round)/i.test(normalized)) return "remaining";
  if (/(关键文件|files|changed files|modified files|新增文件|已修改)/i.test(normalized)) return "files";
  if (/(验证|verification|tests|checks|lint|typecheck|commands|命令|通过)/i.test(normalized)) return "verification";
  if (/(执行要求|constraints|guardrails|requirements|preserve|注意事项)/i.test(normalized)) return "constraints";
  if (/(完成标准|definition of done|success criteria|最终完成标准)/i.test(normalized)) return "completion";
  if (/(上下文|背景|summary|状态|current context)/i.test(normalized)) return "context";
  return null;
}

function parseStructuredSections(text) {
  if (!text) return [];

  const sections = [];
  let currentSection = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^```/.test(trimmed) || /^[-─—]{3,}$/.test(trimmed)) {
      continue;
    }

    if (looksLikeStructuredHeading(trimmed)) {
      const title = cleanStructuredLine(trimmed);
      const kind = title ? classifyStructuredSection(title) : null;

      if (!kind && currentSection) {
        continue;
      }

      if (currentSection && currentSection.title === title && currentSection.kind === kind && currentSection.items.length === 0) {
        continue;
      }

      currentSection = title ? { title, kind, items: [] } : null;
      if (currentSection) {
        sections.push(currentSection);
      }
      continue;
    }

    if (!currentSection) continue;

    const cleaned = cleanStructuredLine(trimmed);
    if (!cleaned) continue;
    if (currentSection.kind === "sources" && !looksLikeSourceDocumentItem(cleaned)) continue;

    const maxItems = currentSection.kind === "files"
      ? MAX_FILE_SECTION_ITEMS
      : currentSection.kind === "sources"
        ? MAX_SOURCE_SECTION_ITEMS
        : MAX_STRUCTURED_ITEMS;

    if (currentSection.items.length >= maxItems) {
      continue;
    }

    currentSection.items.push(cleaned);
  }

  return sections.filter((section) => section.items.length > 0 || section.kind === "context");
}

function findLatestStructuredAssistantSummary(messages) {
  let scanned = 0;

  for (let index = messages.length - 1; index >= 0 && scanned < STRUCTURED_SCAN_LIMIT; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    scanned += 1;

    const rawText = extractRawMessageText(message);
    if (!rawText) continue;

    const sections = parseStructuredSections(rawText);
    const itemCount = sections.reduce((count, section) => count + section.items.length, 0);
    if (sections.length >= 2 || itemCount >= 4) {
      return { rawText, sections };
    }
  }

  return null;
}

function getStructuredSectionItemLimit(kind) {
  if (kind === "files") return MAX_FILE_SECTION_ITEMS;
  if (kind === "sources") return MAX_SOURCE_SECTION_ITEMS;
  return MAX_STRUCTURED_ITEMS;
}

function collectSectionItems(structuredSummary, kind) {
  if (!structuredSummary) return [];

  return structuredSummary.sections
    .filter((section) => section.kind === kind)
    .flatMap((section) => section.items)
    .slice(0, getStructuredSectionItemLimit(kind));
}

function collectReferencedDocuments(texts) {
  return [...new Set(
    texts
      .filter(Boolean)
      .flatMap((text) => [...text.matchAll(/(?:^|\s)(docs\/[A-Za-z0-9._\/-]+\.(?:md|sql|ts|tsx|go))(?:\s|$)/g)].map((match) => match[1]))
      .filter((value) => /^docs\//.test(value)),
  )].slice(0, MAX_SOURCE_DOCS);
}

function collectSourceDocuments(structuredSummary, additionalTexts = []) {
  if (!structuredSummary) return collectReferencedDocuments(additionalTexts);

  const explicitSourceItems = collectSectionItems(structuredSummary, "sources");
  const explicitSourceDocs = collectReferencedDocuments(explicitSourceItems);
  if (explicitSourceDocs.length > 0) {
    return explicitSourceDocs;
  }

  const nonSourceSectionTexts = structuredSummary.sections
    .filter((section) => section.kind !== "context")
    .flatMap((section) => [section.title, ...section.items]);
  return collectReferencedDocuments([...nonSourceSectionTexts, ...additionalTexts]);
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
  const structuredSummary = findLatestStructuredAssistantSummary(messages);

  const latestTaskUserMessage = taskUserMessages[taskUserMessages.length - 1] ?? "";
  const latestRecentNonMetaUserMessage = [...recentUserMessages].reverse().find((text) => !isMetaHandoffMessage(text)) ?? "";

  return {
    recentUserMessages,
    taskUserMessages,
    assistantStatusMessages,
    latestAssistantText: assistantStatusMessages[assistantStatusMessages.length - 1] ?? "",
    primaryUserMessage: latestTaskUserMessage || latestRecentNonMetaUserMessage || recentUserMessages[recentUserMessages.length - 1] || "",
    structuredAssistantSummary: structuredSummary
      ? {
          sections: structuredSummary.sections,
          sectionTitles: structuredSummary.sections.map((section) => section.title),
          completedItems: collectSectionItems(structuredSummary, "completed"),
          remainingItems: collectSectionItems(structuredSummary, "remaining"),
          fileItems: collectSectionItems(structuredSummary, "files"),
          verificationItems: collectSectionItems(structuredSummary, "verification"),
          constraintItems: collectSectionItems(structuredSummary, "constraints"),
          completionItems: collectSectionItems(structuredSummary, "completion"),
          contextItems: collectSectionItems(structuredSummary, "context"),
          sourceDocumentItems: collectSectionItems(structuredSummary, "sources"),
          sourceDocuments: collectSourceDocuments(structuredSummary, [
            ...taskUserMessages,
            ...recentUserMessages,
            ...assistantStatusMessages,
          ]),
          rawText: truncateText(structuredSummary.rawText, MAX_ASSISTANT_CHARS),
        }
      : null,
  };
}
