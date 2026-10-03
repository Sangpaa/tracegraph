// Pure, immutable reducer: replays GraphEvents into a Graph.
import type { Graph, GraphEdge, GraphEvent, GraphNode, Meta } from './model'
import { EMPTY_GRAPH, edgeId } from './model'

const mergeMeta = (a?: Meta, b?: Meta): Meta | undefined =>
  a === undefined && b === undefined ? undefined : { ...a, ...b }

const addNode = (g: Graph, ev: Extract<GraphEvent, { type: 'node.add' }>): Graph => {
  const old = g.nodes[ev.node.id]
  const node: GraphNode = old
    ? {
        ...old,
        ...ev.node,
        createdAt: old.createdAt,
        updatedAt: ev.at,
        metadata: mergeMeta(old.metadata, ev.node.metadata),
      }
    : { ...ev.node, createdAt: ev.at, updatedAt: ev.at }
  return { ...g, nodes: { ...g.nodes, [node.id]: node } }
}

const updateNode = (g: Graph, ev: Extract<GraphEvent, { type: 'node.update' }>): Graph => {
  const old = g.nodes[ev.id]
  if (!old) return g
  const node: GraphNode = {
    ...old,
    ...ev.patch,
    updatedAt: ev.at,
    metadata: mergeMeta(old.metadata, ev.patch.metadata),
  }
  return { ...g, nodes: { ...g.nodes, [node.id]: node } }
}

const addEdge = (g: Graph, ev: Extract<GraphEvent, { type: 'edge.add' }>): Graph => {
  // Edges only connect known nodes: no invented endpoints.
  if (!g.nodes[ev.from] || !g.nodes[ev.to]) return g
  const id = edgeId(ev.from, ev.kind, ev.to)
  const old = g.edges[id]
  const edge: GraphEdge = old
    ? { ...old, count: old.count + 1, metadata: mergeMeta(old.metadata, ev.metadata) }
    : {
        id,
        from: ev.from,
        to: ev.to,
        kind: ev.kind,
        source: ev.source,
        createdAt: ev.at,
        count: 1,
        metadata: ev.metadata,
      }
  return { ...g, edges: { ...g.edges, [id]: edge } }
}

const alias = (g: Graph, ev: Extract<GraphEvent, { type: 'node.alias' }>): Graph => {
  const src = g.nodes[ev.from]
  if (!src || ev.from === ev.to) return g
  const dst = g.nodes[ev.to]
  const merged: GraphNode = dst
    ? { ...dst, ...src, id: ev.to, createdAt: Math.min(src.createdAt, dst.createdAt), metadata: mergeMeta(src.metadata, dst.metadata) }
    : { ...src, id: ev.to }
  const { [ev.from]: _gone, ...rest } = g.nodes
  const nodes = { ...rest, [ev.to]: merged }
  const edges = Object.values(g.edges).reduce<Record<string, GraphEdge>>((acc, e) => {
    const from = e.from === ev.from ? ev.to : e.from
    const to = e.to === ev.from ? ev.to : e.to
    const id = edgeId(from, e.kind, to)
    const prev = acc[id]
    acc[id] = prev ? { ...prev, count: prev.count + e.count } : { ...e, id, from, to }
    return acc
  }, {})
  return { nodes, edges }
}

export const apply = (g: Graph, ev: GraphEvent): Graph => {
  switch (ev.type) {
    case 'node.add':
      return addNode(g, ev)
    case 'node.update':
      return updateNode(g, ev)
    case 'edge.add':
      return addEdge(g, ev)
    case 'node.alias':
      return alias(g, ev)
  }
}

export const replay = (events: readonly GraphEvent[]): Graph => events.reduce(apply, EMPTY_GRAPH)

export const toJsonl = (events: readonly GraphEvent[]): string =>
  events.map(ev => JSON.stringify(ev)).join('\n') + (events.length ? '\n' : '')
