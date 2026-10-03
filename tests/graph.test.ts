import { describe, expect, test } from 'claude-code/testing'

import { replay } from '../src/graph/store'
import { onEnd, onStart } from '../src/observers/tools'
import type { ObservedCall } from '../src/observers/tools'
import { neighbors, parseView, visibleNodes } from '../src/ui/views'

const call = (tool: string, input: Record<string, unknown>, extra: Partial<ObservedCall> = {}): ObservedCall => ({
  tool,
  id: `tu_${tool}`,
  input,
  cwd: '/repo',
  at: 1,
  ...extra,
})
const ok = (result: unknown = {}) => ({ denied: false, isError: false, result })

describe('observer → graph', () => {
  test('Read and Edit become observed reads/writes edges with relative paths', () => {
    const r = call('Read', { file_path: '/repo/src/auth.ts' })
    const w = call('Edit', { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'a\nb\nc' })
    const g = replay([...onStart(r), ...onEnd(r, ok()), ...onStart(w), ...onEnd(w, ok())])
    const file = g.nodes['file:src/auth.ts']
    expect(file?.label).toBe('auth.ts')
    const edges = neighbors(g, 'agent:main').map(x => `${x.kind}:${x.other.id}:${x.edge.source}`)
    expect(edges).toEqual(['reads:file:src/auth.ts:observed', 'writes:file:src/auth.ts:observed'])
    const write = Object.values(g.edges).find(e => e.kind === 'writes')
    expect(write?.metadata).toEqual({ added: 3, removed: 1 })
    expect(g.nodes['agent:main']?.status).toBe('idle')
  })

  test('failed or denied calls add no file edges', () => {
    const r = call('Read', { file_path: '/repo/x.ts' })
    const g = replay([...onStart(r), ...onEnd(r, { denied: true, isError: false, result: undefined })])
    expect(g.nodes['file:x.ts']).toBeUndefined()
  })

  test('Agent placeholder merges into the real agent id and keeps its label', () => {
    const a = call('Agent', { description: 'inspect auth', prompt: 'p', subagent_type: 'Explore' })
    const inner = call('Read', { file_path: '/repo/a.ts' }, { id: 'tu_inner', agentId: 'ag1' })
    const g = replay([
      ...onStart(a),
      ...onStart(inner),
      ...onEnd(inner, ok()),
      ...onEnd(a, ok({ agentId: 'ag1' })),
    ])
    expect(g.nodes['agent:call:tu_Agent']).toBeUndefined()
    expect(g.nodes['agent:ag1']?.label).toBe('inspect auth')
    expect(g.nodes['agent:ag1']?.status).toBe('completed')
    const kinds = Object.values(g.edges).map(e => `${e.from}>${e.kind}>${e.to}`).sort()
    expect(kinds).toEqual(['agent:ag1>reads>file:a.ts', 'agent:main>spawned>agent:ag1'])
  })

  test('TaskCreate / TaskUpdate build a task DAG; unknown endpoints are not invented', () => {
    const c1 = call('TaskCreate', { subject: 'inspect', description: '' }, { id: 't1' })
    const c2 = call('TaskCreate', { subject: 'implement', description: '' }, { id: 't2' })
    const u = call('TaskUpdate', { taskId: '2', status: 'in_progress', addBlockedBy: ['1', '99'] })
    const g = replay([
      ...onEnd(c1, ok({ task: { id: '1' } })),
      ...onEnd(c2, ok({ task: { id: '2' } })),
      ...onEnd(u, ok()),
    ])
    expect(g.nodes['task:2']?.status).toBe('in_progress')
    const deps = Object.values(g.edges).filter(e => e.kind === 'depends_on')
    expect(deps.map(e => `${e.from}>${e.to}`)).toEqual(['task:2>task:1'])
  })

  test('views filter the same graph', () => {
    const r = call('Read', { file_path: '/repo/a.ts' })
    const t = call('TodoWrite', { todos: [{ content: 'write tests', status: 'pending', activeForm: 'x' }] })
    const g = replay([...onStart(r), ...onEnd(r, ok()), ...onEnd(t, ok())])
    expect(visibleNodes(g, 'tasks').map(n => n.kind)).toEqual(['agent', 'task'])
    expect(visibleNodes(g, 'code').map(n => n.kind)).toEqual(['agent', 'file'])
    expect(parseView('')).toBe('combined')
    expect(parseView('nope')).toBeUndefined()
  })
})
