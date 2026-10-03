# TraceGraph

> See not only what Claude is doing, but why each change exists and where it lives in the code.

TraceGraph is a Claude Code mod. It draws a live graph of the current session in a Claude Code pane:

- **agents**: the main loop and every subagent it spawns, with the tool each one runs now
- **tasks**: `TaskCreate` / `TaskUpdate` / `TodoWrite` items, their status and `depends_on` edges
- **files**: every file an agent reads or writes, with `+added -removed` line counts per write

All v0.1 edges are **observed** facts from Claude Code tool calls. TraceGraph does not invent dependencies. See [DESIGN.md](DESIGN.md) for the full design and roadmap.

> **Early access.** Claude Code function hooks (mods) are an early-access API. They can change between Claude Code releases.

## Install

From GitHub:

```sh
claude plugin marketplace add Sangpaa/tracegraph
claude plugin install tracegraph@tracegraph
```

From a local clone:

```sh
git clone https://github.com/Sangpaa/tracegraph
claude --plugin-dir ./tracegraph
```

## Use

```text
/graph            combined view
/graph tasks      agents + tasks
/graph code       agents + files
```

Keys in the pane:

| Key | Action |
|---|---|
| `j` / `k` | next / previous node |
| `d` | toggle the detail panel (edges, metadata, file path) |
| `t` / `c` / `g` | tasks / code / combined view |

Edge glyphs: `━` observed, `┄` interpreted (reserved for v0.2+).

## Storage

TraceGraph writes an event-sourced log for each session:

```text
<project>/.claude/graph/<session-id>.jsonl
```

Each line is one event (`node.add`, `node.update`, `edge.add`, `node.alias`). Replay the file to rebuild the graph. Add `.claude/graph/` to your project's `.gitignore` if you do not want to commit it.

## Develop

```sh
claude plugin validate .   # manifest, hooks, state contract
claude plugin test .       # tests/*.test.ts
tsc -p .                   # after Claude Code has loaded the mod once
```

Layout:

```text
hooks/register.tsx       wiring: /graph command, tool.call observer, pane renderer
src/graph/               model + pure event reducer (replay, JSONL)
src/observers/tools.ts   tool call → graph events (pure)
src/ui/views.ts          view filters and row text (pure)
types/index.d.ts         type contract ($.state + graph model)
```

## Roadmap

- **v0.1** live execution graph (this release)
- **v0.2** `decision` / `requirement` nodes, a model-callable tool to record why a change exists
- **v0.3** static code graph (imports, calls)
- **v0.4** semantic change analysis

## License

MIT
