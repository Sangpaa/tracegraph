import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphEvent, PaneUi } from '../types'
import { replay, toJsonl } from '../src/graph/store'
import { onEnd, onStart } from '../src/observers/tools'
import type { ObservedCall } from '../src/observers/tools'
import { PLAN_SCHEMA, STEP_SCHEMA, currentPlan, parsePlan, parseStep, planEvents, stepEvents } from '../src/observers/plan'
import { drawPlan } from '../src/ui/diagram'
import {
  VIEWS,
  clampIndex,
  displayPath,
  edgeLabel,
  mark,
  neighbors,
  parseView,
  summary,
  visibleNodes,
} from '../src/ui/views'

const PANE = 'tracegraph'
const MAX_EVENTS = 5000
const PLAN_TOOL = 'mcp__tracegraph__plan'
const STEP_TOOL = 'mcp__tracegraph__step'

// A sample plan for /graph demo: a chain with two feedback loops and a feedforward.
const DEMO_PLAN = {
  title: 'TraceGraph v0.2 배포 (demo)',
  steps: [
    { id: 'design', label: '설계 검토' },
    { id: 'impl', label: '구현' },
    { id: 'test', label: '테스트' },
    { id: 'review', label: '코드 리뷰' },
    { id: 'ship', label: '배포' },
  ],
  links: [
    { from: 'test', to: 'impl', kind: 'feedback' as const, label: '테스트 실패' },
    { from: 'review', to: 'impl', kind: 'feedback' as const, label: '리뷰 지적' },
    { from: 'design', to: 'test', kind: 'feedforward' as const, label: '테스트 기준' },
  ],
}
const DEMO_STEPS: [string, 'active' | 'done' | 'failed'][] = [
  ['design', 'done'], ['impl', 'done'], ['test', 'failed'], ['impl', 'done'], ['test', 'done'], ['review', 'active'],
]

const GUIDANCE = [
  'TraceGraph is active. Before multi-step work (3 or more steps), first call',
  `${PLAN_TOOL} to declare the plan as a control block diagram: the steps, the`,
  'forward flow, feedforward arrows (a step that feeds a later one directly) and',
  'feedback loops (where a failed check sends work back, e.g. "tests fail" from',
  'test to implement). While working, call',
  `${STEP_TOOL} with status active when a step starts, done when it ends, and failed`,
  'when its check fails (this fires its feedback loop). Keep labels 2-4 words.',
].join(' ')

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
      description: 'Open the TraceGraph pane: /graph [plan|combined|tasks|code|demo]',
    })
    await $.tool.register({
      name: 'plan',
      description:
        'Declare the plan for the work you are about to do, as a control block diagram (steps, flow, feedforward, feedback). Shown live to the user in the TraceGraph pane. Call again to replace the plan.',
      inputSchema: PLAN_SCHEMA,
    })
    await $.tool.register({
      name: 'step',
      description:
        'Report a plan step\'s state: active, done, or failed (failed fires its feedback loops). Call when a step starts and when it ends.',
      inputSchema: STEP_SCHEMA,
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, { id: 'tracegraph:plan', text: GUIDANCE, scope: 'session' as const }] }
  })

  on('tool.call', { tool: /^mcp__tracegraph__plan$/ }, async ($, e) => {
    const plan = parsePlan(e)
    if (typeof plan === 'string') return { result: `Plan rejected: ${plan}`, isError: true }
    const { planId, events: evs } = planEvents(plan, await $.clock.now())
    await record($, evs)
    await setUi($, u => ({ ...u, view: 'plan', selected: 0, detail: false }))
    void $.ui.open({ id: PANE, title: 'TraceGraph' })
    return { result: `Plan "${planId}" drawn with ${plan.steps.length} steps. Report progress with ${STEP_TOOL}.` }
  })

  on('tool.call', { tool: /^mcp__tracegraph__step$/ }, async ($, e) => {
    const step = parseStep(e)
    if (typeof step === 'string') return { result: `Step rejected: ${step}`, isError: true }
    const graph = replay(await read($, events))
    const planId = currentPlan(graph)
    if (!planId) return { result: `No plan yet. Call ${PLAN_TOOL} first.`, isError: true }
    const evs = stepEvents(graph, planId, step, await $.clock.now())
    if (typeof evs === 'string') return { result: evs, isError: true }
    await record($, evs)
    const loops = evs.filter(x => x.type === 'edge.add').length
    return { result: `Step ${step.id}: ${step.status}${loops ? ` (feedback fired ${loops}x)` : ''}.` }
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await record($, [{ type: 'node.update', at: await $.clock.now(), id: `agent:${e.agent_id}`, patch: { status: 'completed' } }])
    return next(e)
  })

  on('command.run', { command: 'graph' }, async ($, e) => {
    if (e.args.trim() === 'demo') {
      const now = await $.clock.now()
      const { planId, events: evs } = planEvents(DEMO_PLAN, now)
      const steps = DEMO_STEPS.reduce<GraphEvent[]>((acc, [id, status], i) => {
        const more = stepEvents(replay([...evs, ...acc]), planId, { id, status }, now + i + 1)
        return typeof more === 'string' ? acc : [...acc, ...more]
      }, [])
      await record($, [...evs, ...steps])
      await setUi($, u => ({ ...u, view: 'plan', selected: 0, detail: false }))
      await $.ui.open({ id: PANE, title: 'TraceGraph' })
      return { text: 'TraceGraph demo plan drawn.' }
    }
    const parsed = parseView(e.args)
    const hasPlan = currentPlan(replay(await read($, events))) !== undefined
    const view = e.args.trim() === '' && hasPlan ? 'plan' : parsed
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
        <Button key="p" hotkey="p" plain label="plan" onPress={show('plan')} />
        <Button key="t" hotkey="t" plain label="tasks" onPress={show('tasks')} />
        <Button key="c" hotkey="c" plain label="code" onPress={show('code')} />
        <Button key="g" hotkey="g" plain label="all" onPress={show('combined')} />
      </Box>
    )

    if (state.view === 'plan' && !state.detail) {
      const planId = currentPlan(graph)
      const title = planId ? graph.nodes[`plan:${planId}`]?.label : undefined
      const lines = planId ? drawPlan(graph, planId, Math.max(20, (e.viewport?.columns ?? 80) - 2)) : []
      return (
        <Box flexDirection="column">
          <Text bold>{title ?? 'No plan yet'}</Text>
          {!planId && <Text dimColor>Claude draws a plan here before multi-step work (tool: plan).</Text>}
          {lines.map((line, i) => (
            <Text key={`l${i}`} wrap="truncate">{line || ' '}</Text>
          ))}
          <Text dimColor>○ planned ● active ✓ done ✕ failed · ┄ stated by Claude, not observed</Text>
          {toolbar}
        </Box>
      )
    }

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
          {current.file && <Text>{displayPath(current.file)}{current.line ? `:${current.line}` : ''}</Text>}
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
              {mark(n)} {n.kind.padEnd(5)} {n.file ? displayPath(n.file) : n.label}
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
