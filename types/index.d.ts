// TraceGraph's type contract: the graph model (DESIGN.md §5, §12, §16) and pane state.
// Self-contained by rule: no imports.

export type NodeKind =
  | 'task'
  | 'agent'
  | 'file'
  | 'symbol'
  | 'decision'
  | 'requirement'
  | 'tool'
  | 'test'

export type EdgeKind =
  | 'depends_on'
  | 'spawned'
  | 'reads'
  | 'writes'
  | 'implements'
  | 'tests'
  | 'motivated_by'
  | 'decided'
  | 'calls'

// Observed facts and interpretations must never look the same (DESIGN.md §6).
export type GraphSource = 'observed' | 'agent' | 'user' | 'static-analysis'

export type Meta = Record<string, string | number | boolean | null>

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  source: GraphSource
  status?: string
  createdAt: number
  updatedAt: number
  file?: string
  line?: number
  metadata?: Meta
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  source: GraphSource
  createdAt: number
  count: number
  metadata?: Meta
}

export interface Graph {
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
}

// Event-sourced log entries (DESIGN.md §12). Each line of the JSONL file is one.
export type GraphEvent =
  | {
      type: 'node.add'
      at: number
      node: Omit<GraphNode, 'createdAt' | 'updatedAt'>
    }
  | {
      type: 'node.update'
      at: number
      id: string
      patch: Partial<Pick<GraphNode, 'label' | 'status' | 'line'>> & { metadata?: Meta }
    }
  | {
      type: 'edge.add'
      at: number
      from: string
      to: string
      kind: EdgeKind
      source: GraphSource
      metadata?: Meta
    }
  // Merges node `from` into node `to`: used when a placeholder (a running
  // Agent call) learns the spawned agent's real id.
  | { type: 'node.alias'; at: number; from: string; to: string }

export type ViewName = 'combined' | 'tasks' | 'code'

export type PaneUi = {
  view: ViewName
  /** Index of the selected node within the current view. */
  selected: number
  /** True when the detail panel of the selected node is shown. */
  detail: boolean
}

declare module 'claude-code' {
  interface PluginState {
    tracegraph: { events: GraphEvent[]; ui: PaneUi }
  }
}
