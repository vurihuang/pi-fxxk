# pi-fuck

<p align="center">
  <img src="./showcase.png" alt="pi-fuck showcase" width="960" />
</p>

[![npm version](https://img.shields.io/npm/v/pi-fuck)](https://www.npmjs.com/package/pi-fuck)
[![npm downloads](https://img.shields.io/npm/dm/pi-fuck)](https://www.npmjs.com/package/pi-fuck)

`pi-fuck` is a Pi extension that turns `fuck` into a two-stage handoff command.

## Why this exists

Because this annoying shit keeps happening:

- Your task runs long, the context blows up, the model gets noticeably dumber, and now you have to open a fresh session and manually `@` files again just to explain where the work should continue.
- A long task finishes a chunk, and then you still have to ask the model to write a stupid little `compact` summary of what it already did, what is still pending, and where the next session should pick things up.
- You already did the brainstorm, the planning, the workflow ceremony, maybe even used Superpowers or compound-engineering, the todos are still sitting right there unfinished, and the model still goes: "Yes, I can continue. Anything else you want me to do?" Come on. Just continue.

`pi-fuck` exists to kill that handoff friction. Instead of re-explaining the situation like a human glue script, you generate the handoff while the current session still has the best context, then resume from that exact prompt in the next session.

## What it does

`pi-fuck` now uses a two-stage workflow:

1. run `/fuck` in the source session to generate a copyable handoff prompt from the current session
2. run `/new` manually
3. run `/fuck` in the new session to consume that exact staged prompt

You can also provide an explicit goal when generating the staged prompt:

```text
/fuck finish the next test slice and run verification
```

In the source session, `/fuck`:
- reads the current session's visible context
- reuses an already explicit handoff prompt when one is present in transcript history
- otherwise composes a fresh handoff prompt
- lets you review/copy it
- stages it as a single-use prompt for the next session

In the next session, `/fuck`:
- looks for the staged prompt linked from the source session
- sends that exact prompt as the next user message
- clears it after successful use

If no staged prompt exists, `/fuck` warns that the previous session did not generate a `/fuck` prompt and sends nothing.

## Inspired by

Inspired by [`thefuck`](https://github.com/nvbn/thefuck). Thanks to that project for the naming joke and the original spark behind turning `fuck` into a fast recovery and continuation gesture.

## Prompt file

The handoff system prompt lives in a separate file so it can be iterated independently:

- `handoff-system-prompt.md`

## Installation

Install from npm:

```bash
pi install npm:pi-fuck
```

Or from git:

```bash
pi install git:github.com/vurihuang/pi-fuck
```

Restart Pi after installation so the extension is loaded.

### Load it for a single run

```bash
pi -e npm:pi-fuck
```

### Install from a local path

```bash
pi install /absolute/path/to/pi-fuck
```

You can also install from the current directory while developing:

```bash
pi install -l .
```

### Load from a local path for one session

```bash
pi -e /absolute/path/to/pi-fuck
```

## Verify installation

After restarting Pi, open any session and run:

```text
/fuck
```

If the command is available and the extension stages or consumes a handoff prompt as expected, the installation is working.

## Usage

### 1. Generate the staged handoff prompt in the source session

Run:

```text
/fuck
```

If you want to steer the handoff goal, pass it inline:

```text
/fuck continue with a planning pass before implementation
```

This generates a handoff prompt from the current session, opens it for review/copy, and stages it for the next session.

### 2. Open the next session manually

Run:

```text
/new
```

### 3. Consume the staged prompt in the new session

Run:

```text
/fuck
```

The slash command and the plain-text trigger behave the same way.

### Example flow

#### 1. Stage the next-session prompt from the current session

Previous session is still open and has the best context. Run:

```text
/fuck
```

Typical result:

- the extension reads the current session
- it generates or reuses the best handoff prompt available
- it opens that prompt for review/copy
- it stages the prompt as a single-use handoff for the next session

#### 2. Stage a verification-focused handoff

If the next session should focus on verification, run:

```text
/fuck run the required checks, fix failures, then finish the task
```

This biases the staged handoff prompt toward type-checking, linting, tests, and remaining fixes.

#### 3. Resume from the staged prompt in the next session

After `/new`, run:

```text
/fuck
```

Typical result:

- the extension finds the staged prompt linked from the source session
- it sends that exact prompt into the new session
- it clears the staged prompt so it cannot be reused accidentally

#### 4. Cache miss behavior

If the source session never generated a staged prompt, `/fuck` in the child session:

- warns that no staged `/fuck` prompt was found
- sends nothing

## Notes

- The slash command is `/fuck`
- Plain `fuck` input is also intercepted and handled
- `/fuck` is session-aware: it stages in the source session, consumes in the child session, and warns on cache miss instead of falling back
- Staged prompts are single-use and are cleared after successful consumption
- If you run `/fuck` multiple times in the source session, only the latest staged prompt remains active
- `/fuck` still prefers explicit workflow artifacts and compact recent evidence over summarizing an entire prior session when it has to synthesize a new prompt
- If the session history already contains an explicit copy-paste handoff prompt, `/fuck` reuses it directly
- Workflow markdown is only treated as the source of truth when the preserved session evidence is thin or explicitly points back to that artifact
- All user-facing content and prompt instructions are kept in English

## Install as a pi package

This project is already structured as a pi package via the `pi` field in `package.json`:

```json
{
  "pi": {
    "extensions": ["./fuck.js"]
  }
}
```

That means Pi can install it from a local path, npm, or git using the standard pi package flow.
