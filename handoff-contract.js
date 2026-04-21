const MAX_LIST_ITEMS = 6;
const MAX_RICH_FILE_ITEMS = 24;

function hasTerminalPunctuation(text) {
  return /[.!?。！？]$/.test(text.trim());
}

function ensureSentence(text, language = "english") {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (hasTerminalPunctuation(trimmed)) return trimmed;
  return language === "chinese" ? `${trimmed}。` : `${trimmed}.`;
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items.filter(Boolean)) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(item);
  }

  return deduped;
}

function pickLines(items, max = MAX_LIST_ITEMS) {
  return dedupeItems(items).slice(0, max);
}

function detectContractLanguage(contract) {
  if (contract.preferredLanguage) {
    return contract.preferredLanguage;
  }

  const signalText = [
    ...contract.sectionTitles,
    ...contract.completedItems,
    ...contract.remainingItems,
    ...contract.verificationItems,
    ...contract.constraintItems,
    ...contract.completionItems,
    ...contract.contextItems,
    ...contract.sourceDocuments,
    ...contract.readFirstFiles,
    contract.primaryUserMessage,
    contract.goal,
    contract.workflowTarget?.path,
    contract.workflowTarget?.title,
    contract.workflowTarget?.nextStep,
    ...(contract.workflowTarget?.uncheckedItems ?? []),
  ].filter(Boolean).join("\n");

  return /[\u3400-\u9fff\uf900-\ufaff]/.test(signalText) ? "chinese" : "english";
}

function pickHeading(sectionTitles, fallbackTitle, matcher) {
  return sectionTitles.find((title) => matcher.test(title)) ?? fallbackTitle;
}

function getCopy(language = "english") {
  if (language === "chinese") {
    return {
      sourceDocumentsHeading: "输入文档",
      currentContextHeading: "当前上下文",
      completedHeading: "已完成的工作",
      readFirstHeading: "已修改/新增的关键文件",
      verificationHeading: "已验证通过的命令",
      remainingHeading: "当前还没做完的剩余任务",
      constraintsHeading: "执行要求",
      doneWhenHeading: "最终完成标准",
      reportBackHeading: "汇报要求",
      continuationLabel: "这是一个继续执行的交接，不是从零开始。",
      workIn: (cwd) => `工作目录：${cwd}。`,
      previousCwd: (cwd) => `上一会话相关工作目录：${cwd}。`,
      sourceDocuments: (paths) => `输入文档：${paths.join("、")}。`,
      workflowFile: (path, title) => title ? `当前 workflow 文件：${path}（${title}）。` : `当前 workflow 文件：${path}。`,
      workflowStatus: (status) => `Workflow 状态：${status}。`,
      unchecked: (items) => `未完成条目：${items.join(" | ")}。`,
      nextStep: (step) => `文档里的下一步：${step}。`,
      context: (items) => `${items.join(" | ")}。`,
      reportBack: "完成后明确汇报：改了哪些文件、跑了哪些测试、结果如何、还剩哪些风险。",
      defaultConstraint: "不要重复已完成工作，也不要擅自扩 scope",
      inferWorkflowAction: (path, task) => `请继续执行剩余工作，先读 ${path}，然后完成：${ensureSentence(task, "chinese")}`,
      inferWorkflowNext: (path, step) => `请继续执行剩余工作，先读 ${path}，然后按文档里的下一步继续：${ensureSentence(step, "chinese")}`,
      inferRemaining: (task) => `请继续执行剩余工作，先完成：${ensureSentence(task, "chinese")}`,
      inferModified: (files) => `请继续执行剩余工作，先读 ${files.join("、")}，然后继续下一个未完成任务。`,
      inferInspect: "请先检查最近改动的文件，再继续下一个未完成任务。",
    };
  }

  return {
    sourceDocumentsHeading: "Source documents",
    currentContextHeading: "Current context",
    completedHeading: "Already completed",
    readFirstHeading: "Read these files first",
    verificationHeading: "Verification already passing",
    remainingHeading: "Remaining tasks",
    constraintsHeading: "Constraints to preserve",
    doneWhenHeading: "Done when",
    reportBackHeading: "Report back",
    continuationLabel: "This is a continuation handoff, not a fresh start.",
    workIn: (cwd) => `Work in ${cwd}.`,
    previousCwd: (cwd) => `Relevant previous-session cwd: ${cwd}.`,
    sourceDocuments: (paths) => `Source documents: ${paths.join(", ")}.`,
    workflowFile: (path, title) => title ? `Workflow file: ${path} (${title}).` : `Workflow file: ${path}.`,
    workflowStatus: (status) => `Workflow status: ${status}.`,
    unchecked: (items) => `Unchecked items: ${items.join(" | ")}.`,
    nextStep: (step) => `Documented next step: ${step}.`,
    context: (items) => `Context: ${items.join(" | ")}.`,
    reportBack: "Report back with files changed, tests run, results, and any remaining risks.",
    defaultConstraint: "Do not redo finished work or invent extra scope",
    inferWorkflowAction: (path, task) => `Read ${path} first, then continue with this remaining work: ${ensureSentence(task)}`,
    inferWorkflowNext: (path, step) => `Read ${path} first, then follow the documented next step: ${ensureSentence(step)}`,
    inferRemaining: (task) => `Continue with this remaining work first: ${ensureSentence(task)}`,
    inferModified: (files) => `Read ${files.join(", ")} first and continue the next unfinished task.`,
    inferInspect: "Inspect the latest changed files and continue the next unfinished task.",
  };
}

function summarizeWorkflowTarget(workflowTarget, copy) {
  if (!workflowTarget) return [];

  const lines = [copy.workflowFile(workflowTarget.path, workflowTarget.title)];
  if (workflowTarget.status) lines.push(copy.workflowStatus(workflowTarget.status));
  if (workflowTarget.uncheckedItems?.length) lines.push(copy.unchecked(workflowTarget.uncheckedItems.slice(0, MAX_LIST_ITEMS)));
  if (workflowTarget.nextStep) lines.push(copy.nextStep(workflowTarget.nextStep));
  return lines;
}

function inferNextAction(contract, copy, language = "english") {
  if (contract.goal) return ensureSentence(contract.goal, language);
  if (contract.workflowTarget?.path && contract.remainingItems[0]) {
    return copy.inferWorkflowAction(contract.workflowTarget.path, contract.remainingItems[0]);
  }
  if (contract.workflowTarget?.path && contract.workflowTarget.nextStep) {
    return copy.inferWorkflowNext(contract.workflowTarget.path, contract.workflowTarget.nextStep);
  }
  if (contract.remainingItems[0]) {
    return copy.inferRemaining(contract.remainingItems[0]);
  }
  if (contract.primaryUserMessage) {
    return ensureSentence(contract.primaryUserMessage, language);
  }
  if (contract.modifiedFiles.length > 0) {
    return copy.inferModified(contract.modifiedFiles);
  }
  return copy.inferInspect;
}

export function buildHandoffContract({
  goal,
  cwd,
  sessionInfo,
  workflowTarget,
  evidence,
}) {
  return {
    goal: goal.trim(),
    cwd,
    previousCwd: sessionInfo.cwd && sessionInfo.cwd !== cwd ? sessionInfo.cwd : "",
    workflowTarget,
    primaryUserMessage: evidence.primaryUserMessage,
    readFirstFiles: pickLines([
      ...(evidence.fileItems ?? []),
      ...evidence.modifiedFiles,
      ...evidence.readFiles,
    ], evidence.structuredSections?.length ? MAX_RICH_FILE_ITEMS : MAX_LIST_ITEMS),
    modifiedFiles: evidence.modifiedFiles,
    readFiles: evidence.readFiles,
    completedItems: pickLines(evidence.completedItems ?? []),
    remainingItems: pickLines(evidence.remainingItems ?? []),
    verificationItems: pickLines(evidence.verificationItems ?? []),
    constraintItems: pickLines(evidence.constraintItems ?? []),
    completionItems: pickLines(evidence.completionItems ?? []),
    contextItems: pickLines(evidence.contextItems ?? []),
    sectionTitles: evidence.sectionTitles ?? [],
    structuredSections: evidence.structuredSections ?? [],
    sourceDocuments: pickLines([workflowTarget?.path, ...(evidence.sourceDocuments ?? [])], MAX_RICH_FILE_ITEMS),
    preferredLanguage: evidence.preferredLanguage ?? null,
    latestAssistantText: evidence.latestAssistantText,
  };
}

function pushSection(lines, heading, items) {
  if (!items.length) return;
  lines.push(heading);
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

function looksLikeSourceDocument(text) {
  return /(?:^|\s)(docs\/[A-Za-z0-9._\/-]+\.(?:md|sql|ts|tsx|go))(?:\s|$)/.test(text);
}

function renderStructuredSectionsInOriginalOrder(contract, copy, language) {
  if (!contract.structuredSections.length) {
    return null;
  }

  const lines = [inferNextAction(contract, copy, language), ""];
  const appendedKinds = new Set();

  for (const section of contract.structuredSections) {
    const title = section.title;
    let items = [...section.items];

    if (section.kind === "context") {
      const prefix = [copy.continuationLabel, copy.workIn(contract.cwd)];
      if (contract.previousCwd) prefix.push(copy.previousCwd(contract.previousCwd));
      if (contract.sourceDocuments.length > 0 && !contract.structuredSections.some((entry) => entry.kind === "sources")) {
        prefix.push(copy.sourceDocuments(contract.sourceDocuments));
      }
      prefix.push(...summarizeWorkflowTarget(contract.workflowTarget, copy));
      for (const value of prefix.reverse()) {
        items.unshift(value);
      }
    }

    if (section.kind === "sources") {
      items = contract.sourceDocuments.length > 0
        ? [...contract.sourceDocuments]
        : items.filter((item) => looksLikeSourceDocument(item));
    }

    if (section.kind === "files") {
      for (const file of contract.readFirstFiles) {
        if (!items.includes(file)) items.push(file);
      }
    }

    if (section.kind === "constraints") {
      for (const value of pickLines([...contract.constraintItems, copy.defaultConstraint])) {
        if (!items.includes(value)) items.push(value);
      }
    }

    if (section.kind === "verification") {
      for (const value of contract.verificationItems) {
        if (!items.includes(value)) items.push(value);
      }
    }

    if (section.kind === "remaining") {
      for (const value of contract.remainingItems) {
        if (!items.includes(value)) items.push(value);
      }
    }

    if (section.kind === "completed") {
      for (const value of contract.completedItems) {
        if (!items.includes(value)) items.push(value);
      }
    }

    if (section.kind === "completion") {
      for (const value of contract.completionItems) {
        if (!items.includes(value)) items.push(value);
      }
    }

    pushSection(lines, title, pickLines(items, section.kind === "files" ? MAX_RICH_FILE_ITEMS : 12));
    if (section.kind) appendedKinds.add(section.kind);
  }

  if (!appendedKinds.has("sources") && contract.sourceDocuments.length > 0) {
    const sourceDocumentsHeading = pickHeading(contract.sectionTitles, copy.sourceDocumentsHeading, /(输入文档|source documents?)/i);
    pushSection(lines, sourceDocumentsHeading, contract.sourceDocuments);
  }

  if (!appendedKinds.has("context")) {
    const currentContextHeading = pickHeading(contract.sectionTitles, copy.currentContextHeading, /(上下文|背景|current context|summary|状态)/i);
    const currentContextItems = [copy.continuationLabel, copy.workIn(contract.cwd)];
    if (contract.previousCwd) currentContextItems.push(copy.previousCwd(contract.previousCwd));
    currentContextItems.push(...summarizeWorkflowTarget(contract.workflowTarget, copy));
    pushSection(lines, currentContextHeading, currentContextItems);
  }

  if (!appendedKinds.has("files") && contract.readFirstFiles.length > 0) {
    const readFirstHeading = pickHeading(contract.sectionTitles, copy.readFirstHeading, /(关键文件|已修改|新增的关键文件|files|changed files|modified files)/i);
    pushSection(lines, readFirstHeading, contract.readFirstFiles);
  }

  if (!appendedKinds.has("constraints")) {
    const constraintsHeading = pickHeading(contract.sectionTitles, copy.constraintsHeading, /(执行要求|constraints|guardrails|requirements|注意事项)/i);
    pushSection(lines, constraintsHeading, pickLines([...contract.constraintItems, copy.defaultConstraint]));
  }

  if (!appendedKinds.has("verification") && contract.verificationItems.length > 0) {
    const verificationHeading = pickHeading(contract.sectionTitles, copy.verificationHeading, /(验证|通过的命令|verification|tests|checks|lint|typecheck)/i);
    pushSection(lines, verificationHeading, contract.verificationItems);
  }

  if (!appendedKinds.has("remaining") && contract.remainingItems.length > 0) {
    const remainingHeading = pickHeading(contract.sectionTitles, copy.remainingHeading, /(剩余任务|还没做完|remaining|todo|pending|未完成)/i);
    pushSection(lines, remainingHeading, contract.remainingItems);
  }

  if (!appendedKinds.has("completion") && contract.completionItems.length > 0) {
    const doneWhenHeading = pickHeading(contract.sectionTitles, copy.doneWhenHeading, /(完成标准|definition of done|success criteria|最终完成标准)/i);
    pushSection(lines, doneWhenHeading, contract.completionItems);
  }

  pushSection(lines, copy.reportBackHeading, [copy.reportBack]);
  return lines.join("\n").trim();
}

export function renderHandoffContract(contract, { forceContractFormat = false } = {}) {
  const language = detectContractLanguage(contract);
  const shouldUseChinese = language === "chinese";
  const copy = getCopy(language);

  if (shouldUseChinese && contract.structuredSections.length > 0) {
    return renderStructuredSectionsInOriginalOrder(contract, copy, "chinese");
  }

  if (shouldUseChinese) {
    const lines = [inferNextAction(contract, copy, "chinese"), ""];

    const sourceDocumentsHeading = pickHeading(contract.sectionTitles, copy.sourceDocumentsHeading, /(输入文档|source documents?)/i);
    const currentContextHeading = pickHeading(contract.sectionTitles, copy.currentContextHeading, /(上下文|背景|current context|summary|状态)/i);
    const completedHeading = pickHeading(contract.sectionTitles, copy.completedHeading, /(已完成|completed|done|finished)/i);
    const readFirstHeading = pickHeading(contract.sectionTitles, copy.readFirstHeading, /(关键文件|已修改|新增的关键文件|files|changed files|modified files)/i);
    const verificationHeading = pickHeading(contract.sectionTitles, copy.verificationHeading, /(验证|通过的命令|verification|tests|checks|lint|typecheck)/i);
    const remainingHeading = pickHeading(contract.sectionTitles, copy.remainingHeading, /(剩余任务|还没做完|remaining|todo|pending|未完成)/i);
    const constraintsHeading = pickHeading(contract.sectionTitles, copy.constraintsHeading, /(执行要求|constraints|guardrails|requirements|注意事项)/i);
    const doneWhenHeading = pickHeading(contract.sectionTitles, copy.doneWhenHeading, /(完成标准|definition of done|success criteria|最终完成标准)/i);
    const reportBackHeading = copy.reportBackHeading;

    const currentContextItems = [copy.continuationLabel, copy.workIn(contract.cwd)];
    if (contract.previousCwd) currentContextItems.push(copy.previousCwd(contract.previousCwd));
    currentContextItems.push(...summarizeWorkflowTarget(contract.workflowTarget, copy));
    if (contract.contextItems.length > 0) {
      const renderedContext = copy.context(contract.contextItems);
      if (!currentContextItems.some((item) => item === renderedContext || renderedContext.includes(item) || item.includes(renderedContext))) {
        currentContextItems.push(renderedContext);
      }
    }

    pushSection(lines, sourceDocumentsHeading, contract.sourceDocuments);
    pushSection(lines, currentContextHeading, currentContextItems);
    pushSection(lines, completedHeading, contract.completedItems);
    pushSection(lines, readFirstHeading, contract.readFirstFiles);
    pushSection(lines, verificationHeading, contract.verificationItems);
    pushSection(lines, remainingHeading, contract.remainingItems);
    pushSection(lines, constraintsHeading, pickLines([...contract.constraintItems, copy.defaultConstraint]));
    pushSection(lines, doneWhenHeading, contract.completionItems);
    pushSection(lines, reportBackHeading, [copy.reportBack]);

    return lines.join("\n").trim();
  }

  const lines = [inferNextAction(contract, copy), ""];

  const sourceDocumentsHeading = pickHeading(contract.sectionTitles, copy.sourceDocumentsHeading, /(输入文档|source documents?)/i);
  const currentContextHeading = pickHeading(contract.sectionTitles, copy.currentContextHeading, /(上下文|背景|current context|summary|状态)/i);
  const completedHeading = pickHeading(contract.sectionTitles, copy.completedHeading, /(已完成|completed|done|finished)/i);
  const readFirstHeading = pickHeading(contract.sectionTitles, copy.readFirstHeading, /(关键文件|已修改|新增的关键文件|files|changed files|modified files)/i);
  const verificationHeading = pickHeading(contract.sectionTitles, copy.verificationHeading, /(验证|通过的命令|verification|tests|checks|lint|typecheck)/i);
  const remainingHeading = pickHeading(contract.sectionTitles, copy.remainingHeading, /(剩余任务|还没做完|remaining|todo|pending|未完成)/i);
  const constraintsHeading = pickHeading(contract.sectionTitles, copy.constraintsHeading, /(执行要求|constraints|guardrails|requirements|注意事项)/i);
  const doneWhenHeading = pickHeading(contract.sectionTitles, copy.doneWhenHeading, /(完成标准|definition of done|success criteria|最终完成标准)/i);
  const reportBackHeading = copy.reportBackHeading;

  const currentContextItems = [copy.continuationLabel, copy.workIn(contract.cwd)];
  if (contract.previousCwd) currentContextItems.push(copy.previousCwd(contract.previousCwd));
  currentContextItems.push(...summarizeWorkflowTarget(contract.workflowTarget, copy));
  if (contract.contextItems.length > 0) {
    const renderedContext = copy.context(contract.contextItems);
    if (!currentContextItems.some((item) => item === renderedContext || renderedContext.includes(item) || item.includes(renderedContext))) {
      currentContextItems.push(renderedContext);
    }
  }
  if (
    (forceContractFormat || (contract.completedItems.length === 0 && contract.remainingItems.length === 0))
    && contract.latestAssistantText
    && contract.completedItems.length === 0
    && contract.remainingItems.length === 0
    && !contract.workflowTarget
  ) {
    currentContextItems.push(`Latest confirmed status: ${contract.latestAssistantText}`);
  }

  const localizedConstraints = pickLines([...contract.constraintItems, copy.defaultConstraint]);

  pushSection(lines, sourceDocumentsHeading, contract.sourceDocuments);
  pushSection(lines, currentContextHeading, currentContextItems);
  pushSection(lines, completedHeading, contract.completedItems);
  pushSection(lines, readFirstHeading, contract.readFirstFiles);
  pushSection(lines, verificationHeading, contract.verificationItems);
  pushSection(lines, remainingHeading, contract.remainingItems);
  pushSection(lines, constraintsHeading, localizedConstraints);
  pushSection(lines, doneWhenHeading, contract.completionItems);
  pushSection(lines, reportBackHeading, [copy.reportBack]);

  return lines.join("\n").trim();
}
