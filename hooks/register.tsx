import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphEvent, PaneUi } from '../types'
import { replay, toJsonl } from '../src/graph/store'
import { onEnd, onStart } from '../src/observers/tools'
import type { ObservedCall } from '../src/observers/tools'
import {
  VIEWS,
  clampIndex,
  edgeLabel,
  mark,
  neighbors,
  parseView,
  summary,
  visibleNodes,
} from '../src/ui/views'

const PANE = 'tracegraph'
const MAX_EVENTS = 5000

const events = atom({ plugin: 'tracegraph', key: 'events' } as const, [])
const ui = atom({ plugin: 'tracegraph', key: 'ui' } as const, {
  view: 'combined',
  selected: 0,
  detail: false,
})

// Serializes JSONL writes so a slow write never overtakes a newer one.
let writing: Promise<void> = Promise.resolve()

function persist($: EngineInterface, all: readonly GraphEvent[]): void {
  writing = writing
    .then(async () => {
      const sid = await $.session.id()
      await $.fs.write(`.claude/graph/${sid}.jsonl`, toJsonl(all))
    })
    .catch(() => undefined)
}

async function record($: EngineInterface, evs: GraphEvent[]): Promise<void> {
  if (evs.length === 0) return
  const all = await update($, events, list => [...list, ...evs].slice(-MAX_EVENTS))
  persist($, all)
}

function setUi($: EngineInterface, fn: (u: PaneUi) => PaneUi): Promise<PaneUi> {
  return update($, ui, fn)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'graph',
      description: 'Open the TraceGraph pane: /graph [combined|tasks|code]',
    })
    return next(e)
  })

  on('command.run', { command: 'graph' }, async ($, e) => {
    const view = parseView(e.args)
    if (!view) return { text: `Unknown view "${e.args}". Use one of: ${VIEWS.join(', ')}.` }
    await setUi($, u => ({ ...u, view, selected: 0, detail: false }))
    await $.ui.open({ id: PANE, title: 'TraceGraph' })
    return { text: `TraceGraph opened (${view} view).` }
  })

  on('tool.call', async ($, e, next) => {
    const { tool, tool_use_id, agentId, ...input } = e as typeof e & Record<string, unknown>
    const call: ObservedCall = {
      tool,
      id: tool_use_id,
      agentId,
      input,
      cwd: await $.session.cwd(),
      at: await $.clock.now(),
    }
    await record($, onStart(call))
    const ran = await next(e)
    await record(
      $,
      onEnd(
        { ...call, at: await $.clock.now() },
        { denied: ran.deny !== undefined, isError: ran.isError === true, result: ran.result },
      ),
    )
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, ui)
    const graph = replay(await read($, events))
    const nodes = visibleNodes(graph, state.view)
    const sel = clampIndex(state.selected, nodes.length)
    const current = nodes[sel]
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - 8)
    const start = Math.max(0, Math.min(sel - Math.floor(rows / 2), nodes.length - rows))

    const move = (d: number) => () => setUi($, u => ({ ...u, selected: clampIndex(u.selected + d, nodes.length) }))
    const show = (view: PaneUi['view']) => () => setUi($, u => ({ ...u, view, selected: 0, detail: false }))

    const toolbar = (
      <Box key="bar" flexDirection="row" gap={1}>
        <Button key="up" hotkey="k" plain label="prev" onPress={move(-1)} />
        <Button key="down" hotkey="j" plain label="next" onPress={move(1)} />
        <Button key="detail" hotkey="d" plain label={state.detail ? 'list' : 'detail'} onPress={() => setUi($, u => ({ ...u, detail: !u.detail }))} />
        <Button key="t" hotkey="t" plain label="tasks" onPress={show('tasks')} />
        <Button key="c" hotkey="c" plain label="code" onPress={show('code')} />
        <Button key="g" hotkey="g" plain label="all" onPress={show('combined')} />
      </Box>
    )

    if (state.detail && current) {
      const links = neighbors(graph, current.id)
      return (
        <Box flexDirection="column">
          <Text bold>
            {mark(current)} {current.label} [{current.kind.toUpperCase()}]
          </Text>
          <Text dimColor>
            id {current.id} · {current.status ?? 'no status'} · {current.source}
          </Text>
          {current.file && <Text>{current.file}{current.line ? `:${current.line}` : ''}</Text>}
          {Object.entries(current.metadata ?? {})
            .filter(([, v]) => v !== null && v !== '')
            .map(([k, v]) => (
              <Text key={`m-${k}`} dimColor>
                {k}: {String(v)}
              </Text>
            ))}
          <Text bold>Edges ({links.length})</Text>
          {links.length === 0 && <Text dimColor>none</Text>}
          {links.slice(0, rows).map(r => (
            <Text key={r.edge.id}>{edgeLabel(r)}</Text>
          ))}
          {toolbar}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {state.view} · {summary(graph)}
        </Text>
        {nodes.length === 0 && <Text dimColor>No activity yet. Graph fills as Claude reads, edits and spawns agents.</Text>}
        {nodes.slice(start, start + rows).map((n, i) => {
          const out = neighbors(graph, n.id).filter(r => r.dir === 'out').length
          const isSel = start + i === sel
          return (
            <Text key={n.id} bold={isSel} inverse={isSel}>
              {mark(n)} {n.kind.padEnd(5)} {n.file ?? n.label}
              {n.metadata?.tool ? ` ⟨${n.metadata.tool}⟩` : ''}
              {out ? ` →${out}` : ''}
            </Text>
          )
        })}
        {toolbar}
      </Box>
    )
  })
}
