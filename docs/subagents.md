# Sub-agents

Sub-agents let an agent spawn focused, read-only children to work on tasks in parallel. The parent keeps working while each child runs its own LLM loop and reports back.

## When to use them

- **Research fan-out** — spawn 3 sub-agents to look up different topics, synthesize the results
- **Parallel documentation lookups** — one reads the source, another searches the web, a third checks notes
- **Candidate evaluation** — one sub-agent per option, each returns a verdict
- **Any read-only task you can hand off** while you keep working on something else

Don't use them for trivial one-off reads — just call `read`, `grep`, or `webfetch` directly. Sub-agents are for work that needs its own reasoning loop.

## Tools

### spawn

Creates a sub-agent. Returns immediately.

```
spawn({
  prompt: "Read /root/kern/src/runtime.ts and list every singleton/module-level variable. Return a table.",
  maxSteps: 20
})
```

- `prompt` — self-contained task. The child starts with no context about the parent's current work.
- `maxSteps` — max reasoning steps (default 20, max 50)

Returns a sub-agent ID like `sa_abc123`. The child runs in the background.

### subagents

Inspect and manage sub-agents.

```
subagents({ action: "list" })                      // all sub-agents
subagents({ action: "status", id: "sa_abc123" })   // detailed status
subagents({ action: "result", id: "sa_abc123" })   // final result text
subagents({ action: "cancel", id: "sa_abc123" })   // abort a running child
```

## How it works

### Runtime model

Each sub-agent runs its own `Runtime` instance in-process, with:

- A restricted tool set (read-only — see below)
- Its own session file at `.kern/subagents/<id>/session.jsonl`
- Its own LLM loop using the same model and provider as the parent
- An `AbortSignal` so `cancel` can interrupt mid-turn

Sub-agents run concurrently with the parent and with each other. The parent's turn is *not* blocked by any of them.

### Announces

When a sub-agent finishes, its final answer is enqueued as a new message turn on a `subagent:<id>` channel, prefixed with a header like:

```
[subagent:sa_abc123 done, 12.4s, 5 tool calls]
<the child's final answer>
```

From the parent's perspective, this looks like any other incoming message — it will be picked up after the current turn (or mid-turn if the parent is still running). `status` is `done`, `error`, or `cancelled`.

The web UI renders these with a distinct orange ⎘ avatar so you can tell them apart from user messages.

### Allowed tools

Sub-agents run with a strict read-only toolset:

| Tool | Purpose |
|---|---|
| `read` | Read files, list directories |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `webfetch` | Fetch a URL |
| `websearch` | Search the web |
| `pdf` | Extract text from PDFs |
| `image` | Analyze images |
| `recall` | Search long-term memory |

Sub-agents **cannot**:

- Run shell commands (`bash` / `pwsh`)
- Edit or write files (`edit`, `write`)
- Send messages (`message`)
- Manage the runtime (`kern`)
- Spawn further sub-agents (no nested delegation in v1)

This boundary is intentional. If you need a child that can mutate state, call the destructive tool in the parent based on the sub-agent's report.

### State and persistence

Sub-agent state lives under `.kern/subagents/<id>/`:

| File | Contents |
|---|---|
| `record.json` | Metadata: id, status, prompt, result, timings, maxSteps |
| `session.jsonl` | Full transcript — the child's messages, tool calls, tool results |

Statuses: `running`, `done`, `error`, `cancelled`.

The `subagents` plugin reloads disk state on startup, so completed children survive a restart. Running children do not — they're cancelled on shutdown.

## Limits and costs

- **Concurrency** — no hard cap. Each sub-agent is a real LLM loop, so spawning 20 at once costs 20 model calls in flight.
- **Tokens** — each sub-agent has its own context. A sub-agent with `maxSteps: 20` can easily burn 20k–100k tokens depending on the task.
- **Cache** — sub-agents don't share prompt cache with the parent or each other (different prompts, different sessions).
- **Model** — inherited from the parent's config. There's no per-sub-agent model override yet.

## Disabling

The sub-agents plugin is on by default. There's no config flag to disable it today — if you don't want it, the model simply won't call `spawn` without a reason to.

## See also

- [Tools](tools.md) — full tool list including `spawn` and `subagents`
- [Memory](memory.md) — how `recall` works (sub-agents use it too)
