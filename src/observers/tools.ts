// Turns one observed tool call into GraphEvents. Pure: no engine access.
// Only facts Claude Code reported are recorded (source "observed").
import type { GraphEvent, Meta } from '../graph/model'
import { MAIN_AGENT } from '../graph/model'

export interface ObservedCall {
  tool: string
  id: string
  agentId?: string
  input: Record<string, unknown>
  cwd: string
  at: number
}

export interface ObservedResult {
  isError: boolean
  denied: boolean
  result: unknown
}

const READS = new Set(['Read', 'NotebookRead'])
const WRITES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const agentNodeId = (agentId?: string): string =>
  agentId ? `agent:${agentId}` : MAIN_AGENT

export const relPath = (path: string, cwd: string): string => {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p

const lineCount = (s: string | undefined): number => (s ? s.split('\n').length : 0)

const writeStats = (tool: string, input: Record<string, unknown>): Meta => {
  if (tool === 'Write') return { added: lineCount(str(input.content)), removed: 0 }
  if (tool === 'Edit')
    return { added: lineCount(str(input.new_string)), removed: lineCount(str(input.old_string)) }
  return {}
}

const ensureAgent = (id: string, at: number): GraphEvent => ({
  type: 'node.add',
  at,
  node: {
    id,
    kind: 'agent',
    label: id === MAIN_AGENT ? 'main' : id.slice('agent:'.length),
    source: 'observed',
  },
})

/** Events emitted when a call starts (before the tool runs). */
export const onStart = (c: ObservedCall): GraphEvent[] => {
  const actor = agentNodeId(c.agentId)
  const base: GraphEvent[] = [
    ensureAgent(actor, c.at),
    { type: 'node.update', at: c.at, id: actor, patch: { status: 'running', metadata: { tool: c.tool } } },
  ]
  if (c.tool === 'Agent') {
    const id = `agent:call:${c.id}`
    return [
      ...base,
      {
        type: 'node.add',
        at: c.at,
        node: {
          id,
          kind: 'agent',
          label: str(c.input.description) ?? 'subagent',
          status: 'running',
          source: 'observed',
          metadata: { type: str(c.input.subagent_type) ?? 'general-purpose' },
        },
      },
      { type: 'edge.add', at: c.at, from: actor, to: id, kind: 'spawned', source: 'observed' },
    ]
  }
  return base
}

const fileEvents = (c: ObservedCall, kind: 'reads' | 'writes'): GraphEvent[] => {
  const path = str(c.input.file_path) ?? str(c.input.notebook_path)
  if (!path) return []
  const rel = relPath(path, c.cwd)
  const id = `file:${rel}`
  return [
    {
      type: 'node.add',
      at: c.at,
      node: { id, kind: 'file', label: basename(rel), file: rel, source: 'observed' },
    },
    {
      type: 'edge.add',
      at: c.at,
      from: agentNodeId(c.agentId),
      to: id,
      kind,
      source: 'observed',
      metadata: kind === 'writes' ? writeStats(c.tool, c.input) : undefined,
    },
  ]
}

const taskId = (result: unknown): string | undefined => {
  const r = result as { task?: { id?: unknown }; id?: unknown } | undefined
  const raw = r?.task?.id ?? r?.id
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : undefined
}

const taskEvents = (c: ObservedCall, r: ObservedResult): GraphEvent[] => {
  const owner = agentNodeId(c.agentId)
  if (c.tool === 'TaskCreate') {
    const tid = taskId(r.result)
    if (!tid) return []
    const id = `task:${tid}`
    return [
      {
        type: 'node.add',
        at: c.at,
        node: {
          id,
          kind: 'task',
          label: str(c.input.subject) ?? `task ${tid}`,
          status: 'pending',
          source: 'observed',
          metadata: { description: str(c.input.description) ?? '' },
        },
      },
      { type: 'edge.add', at: c.at, from: owner, to: id, kind: 'spawned', source: 'observed' },
    ]
  }
  if (c.tool === 'TaskUpdate') {
    const tid = str(c.input.taskId)
    if (!tid) return []
    const id = `task:${tid}`
    const status = str(c.input.status)
    const subject = str(c.input.subject)
    const deps = Array.isArray(c.input.addBlockedBy) ? c.input.addBlockedBy.map(String) : []
    const blocks = Array.isArray(c.input.addBlocks) ? c.input.addBlocks.map(String) : []
    return [
      { type: 'node.update', at: c.at, id, patch: { ...(status && { status }), ...(subject && { label: subject }) } },
      ...deps.map((d): GraphEvent => ({ type: 'edge.add', at: c.at, from: id, to: `task:${d}`, kind: 'depends_on', source: 'observed' })),
      ...blocks.map((b): GraphEvent => ({ type: 'edge.add', at: c.at, from: `task:${b}`, to: id, kind: 'depends_on', source: 'observed' })),
    ]
  }
  if (c.tool === 'TodoWrite' && Array.isArray(c.input.todos)) {
    return (c.input.todos as Array<{ content?: unknown; status?: unknown }>).flatMap((t, i): GraphEvent[] => {
      const content = str(t.content)
      if (!content) return []
      const id = `todo:${content}`
      return [
        {
          type: 'node.add',
          at: c.at,
          node: { id, kind: 'task', label: content, status: str(t.status) ?? 'pending', source: 'observed', metadata: { order: i } },
        },
        { type: 'edge.add', at: c.at, from: owner, to: id, kind: 'spawned', source: 'observed' },
      ]
    })
  }
  return []
}

/** Events emitted when a call finishes. */
export const onEnd = (c: ObservedCall, r: ObservedResult): GraphEvent[] => {
  const actor = agentNodeId(c.agentId)
  const idle: GraphEvent = { type: 'node.update', at: c.at, id: actor, patch: { status: 'idle', metadata: { tool: null } } }
  if (r.denied) return [idle]

  if (c.tool === 'Agent') {
    const placeholder = `agent:call:${c.id}`
    const rec = r.result as { agentId?: unknown; status?: unknown } | undefined
    const real = typeof rec?.agentId === 'string' ? `agent:${rec.agentId}` : undefined
    const background = rec?.status === 'async_launched'
    const status = r.isError ? 'failed' : background ? 'running' : 'completed'
    return [
      { type: 'node.update', at: c.at, id: placeholder, patch: { status } },
      ...(real ? [{ type: 'node.alias', at: c.at, from: placeholder, to: real } as GraphEvent] : []),
      idle,
    ]
  }
  if (r.isError) return [idle]
  if (READS.has(c.tool)) return [...fileEvents(c, 'reads'), idle]
  if (WRITES.has(c.tool)) return [...fileEvents(c, 'writes'), idle]
  return [...taskEvents(c, r), idle]
}
