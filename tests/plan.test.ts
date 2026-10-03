import { describe, expect, test } from 'claude-code/testing'

import { replay } from '../src/graph/store'
import { currentPlan, parsePlan, parseStep, planEvents, stepEvents } from '../src/observers/plan'
import type { PlanInput } from '../src/observers/plan'
import { cellWidth, drawPlan } from '../src/ui/diagram'
import { displayPath } from '../src/ui/views'

const PLAN: PlanInput = {
  title: 'OAuth Login',
  steps: [
    { id: 'spec', label: 'spec' },
    { id: 'impl', label: 'implement' },
    { id: 'test', label: 'test' },
    { id: 'ship', label: 'ship' },
  ],
  links: [
    { from: 'test', to: 'impl', kind: 'feedback', label: 'tests fail' },
    { from: 'spec', to: 'test', kind: 'feedforward', label: 'cases' },
  ],
}

describe('plan graph', () => {
  test('rejects links to unknown steps and bad statuses', () => {
    expect(parsePlan({ title: 't', steps: [{ id: 'a', label: 'A' }], links: [{ from: 'a', to: 'zz' }] })).toContain('unknown step')
    expect(parsePlan({ title: '', steps: [] })).toBe('title is required')
    expect(parseStep({ id: 'a', status: 'meh' })).toContain('status must be')
  })

  test('a failed step fires its feedback loop and reactivates the target', () => {
    const { planId, events } = planEvents(PLAN, 1)
    let g = replay(events)
    expect(currentPlan(g)).toBe('oauth-login')
    const evs = stepEvents(g, planId, { id: 'test', status: 'failed' }, 2)
    if (typeof evs === 'string') throw new Error(evs)
    g = replay([...events, ...evs])
    expect(g.nodes['plan:oauth-login:impl']?.status).toBe('active')
    const loop = Object.values(g.edges).find(e => e.kind === 'feedback')
    expect(loop?.metadata?.fired).toBe(1)
    expect(loop?.source).toBe('agent')
  })

  test('draws a chain with feedforward above and feedback below', () => {
    const { planId, events } = planEvents(PLAN, 1)
    const evs = stepEvents(replay(events), planId, { id: 'test', status: 'failed' }, 2)
    if (typeof evs === 'string') throw new Error(evs)
    const lines = drawPlan(replay([...events, ...evs]), planId, 120)
    const text = lines.join('\n')
    expect(text).toContain('──▶')
    expect(text).toContain('cases')
    expect(text).toContain('tests fail ×1')
    expect(text).toContain('▲')
    expect(text).toContain('▼')
  })

  test('falls back to a vertical list when narrow', () => {
    const { planId, events } = planEvents(PLAN, 1)
    const lines = drawPlan(replay(events), planId, 20)
    expect(lines[0]).toBe('[○ spec]')
    expect(lines.join('\n')).toContain('↺ feedback     test ──▶ implement  "tests fail"')
  })

  test('parallel branches are joined by a bus between columns', () => {
    const { planId, events } = planEvents(
      {
        title: 'p',
        steps: [{ id: 's', label: 's' }, { id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'e', label: 'e' }],
        links: [{ from: 's', to: 'a' }, { from: 's', to: 'b' }, { from: 'a', to: 'e' }, { from: 'b', to: 'e' }],
      },
      1,
    )
    const text = drawPlan(replay(events), planId, 80).join('\n')
    expect(text).toContain('─┬▶')
    expect(text).toContain('└▶')
    expect(text).toContain('─┘')
    expect(text).not.toContain('  → ')
  })

  test('Hangul labels take two cells; outside paths are shortened', () => {
    expect(cellWidth('구현')).toBe(4)
    expect(displayPath('/tmp/a/b/demo.md')).toBe('…/b/demo.md')
    expect(displayPath('src/a.ts')).toBe('src/a.ts')
  })
})
