Write the actual user message that should be sent in the new session.

The job is continuity: produce a strong continuation handoff that lets the next agent resume real work immediately, without rediscovering the previous session.

Return only that message.
No preface, no explanation, no code fences, and no quoted labels.
Avoid meta phrases like "here's a handoff", "based on the previous session", or anything that sounds like a wrapper.

Treat the output as a normal user instruction.
This is not a summary for a human reader. It is an execution contract for the next coding session.
Lead with the next action, but preserve enough concrete context that the next agent does not have to guess what is already done, what remains, and what must not regress.

Use only evidence from the previous session and the provided session metadata.
Do not invent files, commands, results, decisions, blockers, approvals, or status.
If the conversation was trimmed or compact evidence was provided, prefer the explicit goal, structured workflow artifacts, extracted handoff state, latest preserved requests, latest confirmed status, and concrete file evidence.
If earlier and later evidence conflict, trust the later evidence.
If structured workflow markdown artifacts are provided and they clearly match the latest preserved session, prefer them over freeform continuation.

If a goal is given, use it.
If no goal is given, infer the strongest evidence-backed next task.
Prefer continuing the exact unfinished work over proposing a cleaner new framing.
If the evidence already contains explicit "already done", "remaining", verification, constraint, or completion criteria, preserve those layers instead of collapsing everything into a tiny next-step instruction.

When a matching workflow markdown artifact exists, anchor the message to that artifact:
- read or continue the relevant `requirements`, `plan`, `todo`, `task_plan`, or similar workflow document first
- preserve its explicit unchecked items, next-step section, or active status when present
- prefer artifact-defined continuation over generic "continue implementation" wording

Do not ask the next agent to repeat work that is already done.
Do not introduce extra validation, sanity checks, or closeout work unless:
- the previous session explicitly left that work pending, or
- the session appears finished and no clearer next step exists.
Reuse exact paths, commands, constraints, decisions, and checks when they are present.
If the current working directory and the previous-session cwd differ, mention the relevant path explicitly.

Include only details that help the next agent act immediately:
- where to work
- what to read first
- what is already done
- what is still pending or unresolved
- the immediate next task or decision
- constraints or decisions to preserve
- checks already passed or still required
- what to report back

Prefer this default shape when the evidence supports it:
1. one sentence with the next action
2. short bullets with execution-critical context

If the evidence supports it, explicitly frame the instruction as a continuation and not a fresh start.
Do not end with a generic question unless the previous session clearly ended on an explicit user-facing decision.
If the previous session appears finished and there is no explicit pending step, ask for the highest-value follow-up that is actually supported by the evidence.
If the evidence is thin, say what should be inspected first instead of guessing.

Choose the response language naturally from the user's context and the preserved evidence. Do not force English unless the conversation clearly points there.
Be direct, self-contained, concise, and easy to act on.
Aim for roughly 120-260 words when needed for a materially better handoff; shorter is fine only when it still preserves progress, remaining work, constraints, and verification state.
Prefer a compact paragraph plus short bullets when that improves clarity.
