# pi-fxxk

<p align="center">
  <img src="./showcase.png" alt="pi-fxxk showcase" width="960" />
</p>

[![npm version](https://img.shields.io/npm/v/pi-fxxk)](https://www.npmjs.com/package/pi-fxxk)
[![npm downloads](https://img.shields.io/npm/dm/pi-fxxk)](https://www.npmjs.com/package/pi-fxxk)

`pi-fxxk` is a Pi extension that turns `fxxk` into a two-stage handoff command.

## Why this exists

Because this annoying handoff keeps happening:

- Your task runs long, the context blows up, the model gets noticeably dumber, and now you have to open a fresh session and manually `@` files again just to explain where the work should continue.
- A long task finishes a chunk, and then you still have to ask the model to write a little `compact` summary of what it already did, what is still pending, and where the next session should pick things up.
- You already did the brainstorm, the planning, the workflow ceremony, maybe even used Superpowers or compound-engineering, the todos are still sitting right there unfinished, and the model still goes: "Yes, I can continue. Anything else do you want me to do?" Come on. Just continue.

`pi-fxxk` exists to kill that handoff friction. Instead of re-explaining the situation like a human glue script, you generate the handoff while the current session still has the best context, then resume from that exact prompt in the next session.

## What it does

`pi-fxxk` now uses a two-stage workflow:

1. run `/fxxk` in the source session to generate a copyable handoff prompt from the current session
2. run `/new` manually
3. run `/fxxk` in the new session to consume that exact staged prompt

You can also provide an explicit goal when generating the staged prompt:

```text
/fxxk finish the next test slice and run verification
```

In the source session, `/fxxk`:
- reads the current session's visible context
- reuses an already explicit handoff prompt when one is present in transcript history
- otherwise composes a fresh handoff prompt
- extracts more than just the next action: it tries to preserve completed work, remaining work, key files, verification state, constraints, and completion criteria when that evidence exists
- lets you review or copy it
- stages it as a single-use prompt for the next session

In the next session, `/fxxk`:
- looks for the staged prompt linked from the source session
- sends that exact prompt as the next user message
- clears it after successful use

If no staged prompt exists, `/fxxk` warns that the previous session did not generate a `/fxxk` prompt and sends nothing.

## Inspired by

Inspired by [`thefuck`](https://github.com/nvbn/thefuck). Thanks to that project for the naming joke and the original spark behind turning `fxxk` into a fast recovery and continuation gesture.

## Prompt file

The handoff system prompt lives in a separate file so it can be iterated independently:

- `handoff-system-prompt.md`

## Installation

Install from npm:

```bash
pi install npm:pi-fxxk
```

Or from git:

```bash
pi install git:github.com/vurihuang/pi-fxxk
```

Restart Pi after installation so the extension is loaded.

### Load it for a single run

```bash
pi -e npm:pi-fxxk
```

### Install from a local path

```bash
pi install /absolute/path/to/pi-fxxk
```

You can also install from the current directory while developing:

```bash
pi install -l .
```

### Load from a local path for one session

```bash
pi -e /absolute/path/to/pi-fxxk
```

## Verify installation

After restarting Pi, open any session and run:

```text
/fxxk
```

If the command is available and the extension stages or consumes a handoff prompt as expected, the installation is working.

## Usage

### 1. Generate the staged handoff prompt in the source session

Run:

```text
/fxxk
```

If you want to steer the handoff goal, pass it inline:

```text
/fxxk continue with a planning pass before implementation
```

This generates a handoff prompt from the current session, opens it for review or copy, and stages it for the next session.

The target shape is closer to a continuation execution contract than a tiny recap: one clear next action, then only the progress, remaining work, files, checks, and constraints that materially help the next session continue without guessing.

### 2. Open the next session manually

Run:

```text
/new
```

### 3. Consume the staged prompt in the new session

Run:

```text
/fxxk
```

The slash command and the plain-text trigger behave the same way.

### Example flow

#### 1. Stage the next-session prompt from the current session

Previous session is still open and has the best context. Run:

```text
/fxxk
```

Typical result:

- the extension reads the current session
- it generates or reuses the best handoff prompt available
- it opens that prompt for review or copy
- it stages the prompt as a single-use handoff for the next session

#### 2. Stage a verification-focused handoff

If the next session should focus on verification, run:

```text
/fxxk run the required checks, fix failures, then finish the task
```

This biases the staged handoff prompt toward type-checking, linting, tests, and remaining fixes.

#### 3. Resume from the staged prompt in the next session

After `/new`, run:

```text
/fxxk
```

Typical result:

- the extension finds the staged prompt linked from the source session
- it sends that exact prompt into the new session
- it clears the staged prompt so it cannot be reused accidentally

#### 4. Cache miss behavior

If the source session never generated a staged prompt, `/fxxk` in the child session:

- warns that no staged `/fxxk` prompt was found
- sends nothing

## Notes

- The slash command is `/fxxk`
- Plain `fxxk` input is also intercepted and handled
- `/fxxk` is session-aware: it stages in the source session, consumes in the child session, and warns on cache miss instead of falling back
- Staged prompts are single-use and are cleared after successful consumption
- If you run `/fxxk` multiple times in the source session, only the latest staged prompt remains active
- `/fxxk` still prefers explicit workflow artifacts and compact recent evidence over summarizing an entire prior session when it has to synthesize a new prompt
- when a recent assistant report already contains handoff structure like completed work, remaining tasks, verification, or execution constraints, `/fxxk` now tries to preserve those layers instead of collapsing everything into a one-line next step
- If the session history already contains an explicit copy-paste handoff prompt, `/fxxk` reuses it directly
- Workflow markdown is only treated as the source of truth when the preserved session evidence is thin or explicitly points back to that artifact
- `/fxxk` now biases generation toward a richer continuation contract instead of a minimal next-step prompt
- model-generated handoffs and deterministic fallback both try to follow the natural response language and structure implied by the preserved user context and evidence

## Install as a pi package

This project is already structured as a pi package via the `pi` field in `package.json`:

```json
{
  "pi": {
    "extensions": ["./fxxk.js"]
  }
}
```

That means Pi can install it from a local path, npm, or git using the standard pi package flow.
