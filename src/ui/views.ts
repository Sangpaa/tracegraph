// View filters over the one graph (DESIGN.md §7) and the text rows a pane draws.
import type { EdgeKind, Graph, GraphEdge, GraphNode, NodeKind } from '../graph/model'

import type { ViewName } from '../../types'

export type { ViewName }

export const VIEWS: readonly ViewName[] = ['combined', 'tasks', 'code']

const VIEW_KINDS: Record<ViewName, ReadonlySet<NodeKind>> = {
  combined: new Set<NodeKind>(['agent', 'task', 'file', 'decision', 'requirement']),
  tasks: new Set<NodeKind>(['agent', 'task']),
  code: new Set<NodeKind>(['agent', 'file', 'symbol']),
}

const KIND_ORDER: NodeKind[] = ['requirement', 'decision', 'agent', 'task', 'file', 'symbol', 'test', 'tool']

export const parseView = (s: string): ViewName | undefined => {
  const v = s.trim().toLowerCase()
  if (v === '' || v === 'all') return 'combined'
  if (v === 'task') return 'tasks'
  if (v === 'files' || v === 'changes') return 'code'
  return (VIEWS as readonly string[]).includes(v) ? (v as ViewName) : undefined
}

export const STATUS_MARK: Record<string, string> = {
  running: '●',
  in_progress: '●',
  pending: '○',
  idle: '◌',
  completed: '✓',
  failed: '✕',
  deleted: '–',
}

export const mark = (n: GraphNode): string => (n.status ? STATUS_MARK[n.status] ?? '·' : '·')

/** Nodes visible in a view, ordered by kind then creation time. */
export const visibleNodes = (g: Graph, view: ViewName): GraphNode[] =>
  Object.values(g.nodes)
    .filter(n => VIEW_KINDS[view].has(n.kind))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )

export interface EdgeRow {
  dir: 'out' | 'in'
  kind: EdgeKind
  other: GraphNode
  edge: GraphEdge
}

export const neighbors = (g: Graph, id: string): EdgeRow[] =>
  Object.values(g.edges).flatMap((edge): EdgeRow[] => {
    const to = g.nodes[edge.to]
    const from = g.nodes[edge.from]
    if (edge.from === id && to) return [{ dir: 'out', kind: edge.kind, other: to, edge }]
    if (edge.to === id && from) return [{ dir: 'in', kind: edge.kind, other: from, edge }]
    return []
  })

// "━" observed, "┄" anything interpreted (DESIGN.md §6).
export const edgeGlyph = (e: GraphEdge): string => (e.source === 'observed' ? '━' : '┄')

export const edgeLabel = (r: EdgeRow): string => {
  const stats =
    r.kind === 'writes' && typeof r.edge.metadata?.added === 'number'
      ? ` +${r.edge.metadata.added} -${r.edge.metadata.removed ?? 0}`
      : ''
  const times = r.edge.count > 1 ? ` ×${r.edge.count}` : ''
  const arrow = r.dir === 'out' ? `${edgeGlyph(r.edge)}${r.kind}▶` : `◀${r.kind}${edgeGlyph(r.edge)}`
  return `${arrow} ${r.other.kind}:${r.other.file ?? r.other.label}${stats}${times}`
}

export const summary = (g: Graph): string => {
  const count = (k: NodeKind) => Object.values(g.nodes).filter(n => n.kind === k).length
  const running = Object.values(g.nodes).filter(n => n.status === 'running' || n.status === 'in_progress').length
  return `${count('agent')} agents · ${count('task')} tasks · ${count('file')} files · ${running} active`
}

export const clampIndex = (i: number, len: number): number => (len === 0 ? 0 : Math.max(0, Math.min(len - 1, i)))
