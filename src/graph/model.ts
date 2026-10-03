// Unified graph model (DESIGN.md §5, §16). The types live in the contract.
import type { EdgeKind, Graph } from '../../types'

export type {
  EdgeKind,
  Graph,
  GraphEdge,
  GraphEvent,
  GraphNode,
  GraphSource,
  Meta,
  NodeKind,
} from '../../types'

export const EMPTY_GRAPH: Graph = { nodes: {}, edges: {} }

export const MAIN_AGENT = 'agent:main'

export const edgeId = (from: string, kind: EdgeKind, to: string): string =>
  `${from}|${kind}|${to}`
