# TraceGraph for Claude Code

> See not only what Claude is doing, but why each change exists and where it lives in the code.

## 1. Overview

TraceGraph is a proposed Claude Code Mod that combines the strongest ideas from:

- [`jc01rho/omo-herdr-dag`](https://github.com/jc01rho/omo-herdr-dag)
- [`devdotfast/whiteboard`](https://github.com/devdotfast/whiteboard)

The goal is to create a **Claude Code-native live graph workspace** that visualizes:

- what Claude and its agents are currently doing,
- how tasks depend on one another,
- which files and symbols are being read or changed,
- why a change was made,
- which requirement or decision led to that change,
- and how all of those entities relate to each other.

Rather than launching a separate desktop application or external workflow viewer, TraceGraph should live primarily inside a **Claude Code pane** and react directly to Claude Code events through Mods / function hooks.

---

## 2. Inspiration

### omo-herdr-dag

`omo-herdr-dag` is strong at showing the **execution state of an agent workflow**.

Useful ideas to preserve:

- Live task DAG
- Parent/child task relationships
- Explicit dependencies
- Agent/subagent states
- Running / blocked / completed / failed states
- Current task and current tool
- Task duration and progress
- Expand/collapse
- Persistent workflow snapshots
- Avoiding invented dependencies when they were not explicitly observed

Its main strength can be summarized as:

> **What is Claude doing right now?**

### devdotfast/whiteboard

`whiteboard` is stronger at helping humans understand the **software itself and the reasoning behind changes**.

Useful ideas to preserve:

- Interactive architecture diagrams
- Diagram node → source code navigation
- Sequence / ER / architecture visualization
- Agent decision log
- Requirement → decision → implementation traceability
- Semantic understanding of code changes
- Linking visual artifacts to real code locations

Its main strength can be summarized as:

> **Why does this change exist, and where does it live in the code?**

---

## 3. Product Direction

TraceGraph should combine both perspectives into a single graph.

Instead of having a separate:

- task graph,
- code graph,
- decision log,
- architecture diagram,

the system should maintain **one underlying graph model** and expose different filtered views of it.

Example:

```text
                        ┌───────────────┐
                        │ OAuth Login   │
                        │ TASK          │
                        └───────┬───────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
                 ▼              ▼              ▼

           ┌───────────┐  ┌───────────┐  ┌───────────┐
           │ inspect   │  │ implement │  │ tests     │
           │ TASK      │  │ TASK      │  │ TASK      │
           └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
                 │              │              │
                 │              ▼              │
                 │        ┌───────────┐         │
                 │        │ auth.ts   │◄────────┘
                 │        │ FILE      │
                 │        └─────┬─────┘
                 │              │
                 │              ▼
                 │       ┌───────────────┐
                 │       │ login()       │
                 │       │ SYMBOL        │
                 │       └───────┬───────┘
                 │               │
                 │               ▼
                 │       ┌───────────────┐
                 └──────►│ use OAuth PKCE│
                         │ DECISION      │
                         └───────────────┘
```

This makes the graph useful for both:

1. observing the agent,
2. understanding the resulting software.

---

## 4. Core Architecture

```text
                    ┌─────────────────────────────┐
                    │       Claude Code           │
                    │                             │
                    │  agent / tool / edit events │
                    └──────────────┬──────────────┘
                                   │
                            function hooks
                                   │
                    ┌──────────────▼──────────────┐
                    │       Graph Engine          │
                    │                             │
                    │ task DAG                    │
                    │ code entities               │
                    │ decisions                   │
                    │ files / symbols             │
                    │ changes                     │
                    └──────────────┬──────────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ Claude Code Pane  │
                         │                   │
                         │  interactive DAG  │
                         │  details / diff   │
                         └───────────────────┘
```

The Mod observes Claude Code events, turns those observations into graph mutations, persists them, and renders filtered graph views.

---

## 5. Unified Graph Model

### Node types

Initial proposal:

```ts
type NodeKind =
  | "task"
  | "agent"
  | "file"
  | "symbol"
  | "decision"
  | "requirement"
  | "tool"
  | "test";
```

Possible future extensions:

```text
finding
service
endpoint
database
package
commit
pull_request
ci_job
deployment
```

### Edge types

```ts
type EdgeKind =
  | "depends_on"
  | "spawned"
  | "reads"
  | "writes"
  | "implements"
  | "tests"
  | "motivated_by"
  | "decided"
  | "calls";
```

Future possibilities:

```text
imports
contains
blocks
fixes
deploys
reviews
fails
produces
```

---

## 6. Provenance Is Critical

Not every edge has the same level of certainty.

TraceGraph should distinguish between **observed facts** and **model interpretation**.

### Observed graph

Generated automatically from Claude Code activity.

Examples:

```text
Claude Read foo.ts
Claude Edit bar.ts
Agent spawned
Tests executed
Task finished
```

These are high-confidence facts.

### Semantic graph

Generated by Claude or another analysis layer.

Examples:

```text
AuthService depends on SessionStore
This change fixes a race condition
This file implements requirement X
```

These are interpretations and should never look identical to observed facts.

Suggested provenance field:

```ts
type GraphSource =
  | "observed"
  | "agent"
  | "user"
  | "static-analysis";
```

Example:

```ts
interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  source: GraphSource;
}
```

Visual distinction:

```text
━━━━━━  observed
- - - - inferred / semantic
```

This avoids presenting an LLM inference as if it were a verified code dependency.

---

## 7. Primary Views

The backend graph should remain unified.

Views are filters over the same data.

### 7.1 Execution View

Inspired by `omo-herdr-dag`.

```text
Planning
   │
   ├────► Backend ────► Tests
   │         ●
   │       running
   │
   └────► Frontend
             ✓
```

Shows:

- task tree / DAG
- agent status
- dependency state
- active tool
- duration
- blockers
- completed / failed tasks

Command idea:

```text
/graph tasks
```

---

### 7.2 Architecture View

Inspired by `whiteboard`.

```text
 Browser
    │
    ▼
 API Route
    │
    ├────► Auth Service
    │          │
    │          ▼
    │        Redis
    │
    ▼
 Database
```

Shows:

- files
- symbols
- services
- modules
- imports
- call relationships
- architecture-level semantic relationships

Command:

```text
/graph code
```

---

### 7.3 Change View

Connects requirements, decisions, tasks, and code edits.

```text
Requirement
    │
    ▼
Decision
    │
    ├──── auth.ts      +24 -5
    ├──── session.ts   +12 -2
    └──── auth.test.ts +38
```

Command:

```text
/graph changes
```

This is where TraceGraph becomes more than a workflow monitor.

---

### 7.4 Combined View

```text
/graph
```

or

```text
/graph combined
```

Shows task, code, and decision relationships together.

---

## 8. Node Detail UX

Selecting a node should open contextual details.

Example decision node:

```text
┌──────────────────────────────────────────┐
│ OAuth PKCE                       DECISION│
├──────────────────────────────────────────┤
│ Why                                      │
│ Avoid client-secret storage in desktop   │
│ flow.                                    │
│                                          │
│ Evidence                                 │
│ src/auth/oauth.ts:42                     │
│ src/auth/callback.ts:91                  │
│                                          │
│ Created by                               │
│ auth-agent                               │
│                                          │
│ During                                   │
│ task: implement-oauth                    │
│                                          │
│ [Open code] [Show diff] [Show trace]     │
└──────────────────────────────────────────┘
```

Useful actions:

- Open code
- Show diff
- Show execution trace
- Show related tasks
- Show parent decision
- Show requirement
- Focus subgraph

---

## 9. Navigation

Suggested keyboard model:

```text
↑ / ↓       select node
← / →       navigate edges
Enter       expand / open details
f           focus selected node
d           show diff
o           open code
t           execution view
c           code view
g           combined graph
r           requirement / decision view
Esc         back
```

The UX should feel like a native Claude Code tool rather than a browser visualization embedded into a terminal.

---

## 10. Mod API

A major design opportunity is to expose the graph as a shared Claude Code Mod capability.

Proposed noun:

```text
$.graph
```

Possible interface:

```ts
interface Graph {
  addNode(node: GraphNode): Promise<void>;

  updateNode(
    id: string,
    patch: Partial<GraphNode>
  ): Promise<void>;

  addEdge(edge: GraphEdge): Promise<void>;

  getNode(
    id: string
  ): Promise<GraphNode | undefined>;

  neighbors(
    id: string
  ): Promise<GraphNode[]>;

  focus(
    id: string
  ): Promise<void>;

  open(
    options?: GraphViewOptions
  ): Promise<void>;
}
```

This allows other Mods to participate in the graph ecosystem.

Example security Mod:

```ts
await $.graph.addNode({
  id: "finding:123",
  kind: "finding",
  label: "SQL injection"
});
```

Example CI Mod:

```text
PR
 │
 ├── unit-test ✓
 ├── lint ✓
 └── e2e ✕
```

TraceGraph could therefore become a **visual graph infrastructure layer for Claude Code**, rather than only a standalone visualization plugin.

---

## 11. Event Pipeline

```text
Claude Code Events
       │
       ▼
┌────────────────────┐
│ Observation Layer  │
│                    │
│ tool calls         │
│ agent lifecycle    │
│ file changes       │
│ task changes       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Graph Store        │
│                    │
│ nodes              │
│ edges              │
│ provenance         │
│ snapshots          │
└─────────┬──────────┘
          │
       ┌──┴───────────────┐
       │                  │
       ▼                  ▼
 Layout Engine        Query Engine
       │                  │
       └───────┬──────────┘
               ▼
        Claude Code UI
```

---

## 12. Storage

Do not start with a complex database.

An event-sourced JSONL format should be enough for the initial implementation.

Example:

```text
.claude/
  graph/
    <session-id>.jsonl
```

Events:

```json
{"type":"node.add","id":"task:1","kind":"task","label":"Implement auth"}
{"type":"node.add","id":"file:auth.ts","kind":"file","label":"auth.ts"}
{"type":"edge.add","from":"task:1","to":"file:auth.ts","kind":"writes","source":"observed"}
```

Advantages:

- simple
- append-only
- debuggable
- easy replay
- easy session restoration
- future migration to SQLite remains possible

---

## 13. Architecture Principles

### Stay native to Claude Code

Avoid rebuilding the full `whiteboard` desktop application model.

Do not start with:

- Electron
- Code OSS
- a custom full IDE
- large external UI runtimes

Prefer:

- Claude Code pane
- function hooks
- native keyboard interactions
- optional editor jump for source locations

The Mod should enhance Claude Code rather than compete with it.

### Reuse existing capabilities where possible

For example, semantic diff is valuable, but should not be a v0 requirement.

The initial implementation can integrate with Claude Code's existing diff functionality rather than building a full AST-aware diff engine immediately.

---

## 14. MVP Roadmap

### v0.1 — Live execution graph

Goal:

> Make Claude's execution visible.

Node types:

```text
task
agent
file
```

Edge types:

```text
depends_on
spawned
reads
writes
```

Features:

- `/graph`
- live task DAG
- agent/subagent visibility
- file reads and writes
- status updates
- node detail panel
- session event log
- focus selected node
- open related source
- show relevant diff

This alone would already provide a Claude Code-native alternative to a separate workflow DAG viewer.

---

### v0.2 — Reasoning and traceability

Add:

```text
decision
requirement
```

Relationships:

```text
requirement
   ↓
decision
   ↓
task
   ↓
file
```

Introduce APIs such as:

```ts
$.graph.recordDecision(...)
```

or higher-level commands that allow agents to explicitly annotate why a change is being made.

---

### v0.3 — Static code graph

Add automated static analysis.

Examples:

```text
file → imports → file
symbol → calls → symbol
class → contains → method
```

At this stage, Architecture View becomes substantially more useful.

---

### v0.4 — Semantic change analysis

Add concepts inspired by Whiteboard's semantic diff.

Possible goals:

- function-level modifications
- renamed symbols
- changed control flow
- added/removed API behavior
- schema changes
- semantic test impact

This should be treated as a separate subsystem rather than blocking the initial Mod.

---

## 15. Possible Repository Structure

```text
tracegraph/
├── .claude-plugin/
│   └── plugin.json
│
├── hooks/
│   ├── hooks.json
│   └── register.ts
│
├── src/
│   ├── graph/
│   │   ├── model.ts
│   │   ├── store.ts
│   │   ├── events.ts
│   │   └── query.ts
│   │
│   ├── observers/
│   │   ├── tools.ts
│   │   ├── agents.ts
│   │   ├── tasks.ts
│   │   └── files.ts
│   │
│   ├── ui/
│   │   ├── graph-pane.ts
│   │   ├── layout.ts
│   │   ├── node-detail.ts
│   │   └── keyboard.ts
│   │
│   ├── integrations/
│   │   ├── diff.ts
│   │   └── editor.ts
│   │
│   └── api/
│       └── graph-noun.ts
│
├── tests/
├── README.md
└── DESIGN.md
```

---

## 16. Suggested Data Types

```ts
interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;

  status?: string;
  source: GraphSource;

  createdAt?: number;
  updatedAt?: number;

  file?: string;
  line?: number;
  symbol?: string;

  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  source: GraphSource;

  createdAt?: number;

  metadata?: Record<string, unknown>;
}
```

---

## 17. Key Differentiator

Most agent visualization tools answer:

> What are the agents doing?

Most architecture tools answer:

> How is the code structured?

TraceGraph should answer both, plus:

> Why does this change exist?

The ideal trace looks like:

```text
Requirement
     │
     ▼
Decision
     │
     ▼
Task
     │
     ▼
Agent
     │
     ▼
File / Symbol
     │
     ▼
Diff / Test / Result
```

This gives the user a navigable history from intent to implementation.

---

## 18. Product Thesis

TraceGraph should not merely visualize a DAG.

Its purpose is to build a **live, inspectable provenance graph of AI-assisted software development**.

The graph should connect:

```text
intent
→ reasoning
→ execution
→ code
→ verification
```

in a way that is native to Claude Code.

The core product statement:

> **See not only what Claude is doing, but why each change exists and where it lives in the code.**

---

## 19. Possible Names

Current working name:

- **TraceGraph**

Other possibilities:

- `claude-graph`
- `codegraph`
- `agent-map`
- `modgraph`
- `trace-map`
- `agentgraph`
- `code-trace`
- `graphmod`

`TraceGraph` fits the concept especially well because the product is fundamentally about tracing relationships between intent, agents, execution, and code.

---

## 20. First Implementation Target

The first useful milestone should be deliberately small:

```text
Claude Code
   │
   ├── task events
   ├── agent events
   ├── tool events
   └── file read/write events
          │
          ▼
      Graph Store
          │
          ▼
     Native graph pane
```

If this works reliably, the remaining features can be layered on top without changing the core model.

The most important early validation is:

> Can a developer look at the graph during a long Claude Code session and immediately understand what is happening, what changed, and how to navigate to the relevant code?

If the answer is yes, the foundation is strong.
