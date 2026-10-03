// The plan graph: Claude declares the work as a control block diagram before
// doing it, then reports each step's state. Every node and edge here is the
// agent's own statement (source "agent"), never an observed fact.
import type { EdgeKind, Graph, GraphEvent } from '../graph/model'

export type StepStatus = 'planned' | 'active' | 'done' | 'failed'

export interface PlanInput {
  title: string
  steps: { id: string; label: string }[]
  links?: { from: string; to: string; kind?: 'flow' | 'feedforward' | 'feedback'; label?: string }[]
}

export interface StepInput {
  id: string
  status: StepStatus
  note?: string
}

const STATUSES: readonly StepStatus[] = ['planned', 'active', 'done', 'failed']

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'What the plan achieves' },
    steps: {
      type: 'array',
      description: 'Blocks of the diagram, in execution order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short id, e.g. "impl"' },
          label: { type: 'string', description: 'Block text, 2-4 words' },
        },
        required: ['id', 'label'],
      },
    },
    links: {
      type: 'array',
      description:
        'Arrows. flow: normal forward path (default: consecutive steps). feedforward: a step that feeds a later step directly. feedback: loop back when a check fails, e.g. tests → impl.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: ['flow', 'feedforward', 'feedback'] },
          label: { type: 'string', description: 'Condition, e.g. "tests fail"' },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['title', 'steps'],
} as const

export const STEP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Step id from the plan' },
    status: { type: 'string', enum: STATUSES },
    note: { type: 'string', description: 'Short result or reason' },
  },
  required: ['id', 'status'],
} as const

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plan'

export const stepNodeId = (planId: string, stepId: string): string => `plan:${planId}:${stepId}`

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Validates the model's input. Returns an error message or the parsed plan. */
export const parsePlan = (raw: unknown): PlanInput | string => {
  if (!isObj(raw) || typeof raw.title !== 'string' || !raw.title.trim()) return 'title is required'
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return 'steps must be a non-empty array'
  const steps = raw.steps.filter(isObj).map(s => ({ id: String(s.id ?? ''), label: String(s.label ?? '') }))
  if (steps.some(s => !s.id || !s.label)) return 'every step needs id and label'
  const ids = new Set(steps.map(s => s.id))
  if (ids.size !== steps.length) return 'step ids must be unique'
  const links = (Array.isArray(raw.links) ? raw.links : []).filter(isObj).map(l => ({
    from: String(l.from ?? ''),
    to: String(l.to ?? ''),
    kind: (['flow', 'feedforward', 'feedback'].includes(String(l.kind)) ? l.kind : 'flow') as 'flow' | 'feedforward' | 'feedback',
    label: typeof l.label === 'string' ? l.label : undefined,
  }))
  const bad = links.find(l => !ids.has(l.from) || !ids.has(l.to))
  if (bad) return `link ${bad.from} → ${bad.to} names an unknown step`
  return { title: raw.title.trim(), steps, links }
}

export const parseStep = (raw: unknown): StepInput | string => {
  if (!isObj(raw) || typeof raw.id !== 'string') return 'id is required'
  if (!STATUSES.includes(raw.status as StepStatus)) return `status must be one of ${STATUSES.join(', ')}`
  return { id: raw.id, status: raw.status as StepStatus, note: typeof raw.note === 'string' ? raw.note : undefined }
}

export const planEvents = (plan: PlanInput, at: number): { planId: string; events: GraphEvent[] } => {
  const planId = slug(plan.title)
  const root = `plan:${planId}`
  const explicitFlow = (plan.links ?? []).some(l => (l.kind ?? 'flow') === 'flow')
  // Without explicit flow arrows, consecutive steps form the forward path.
  const implicit = explicitFlow
    ? []
    : plan.steps.slice(1).map((s, i) => ({ from: plan.steps[i]!.id, to: s.id, kind: 'flow' as const, label: undefined }))
  const links = [...implicit, ...(plan.links ?? [])]
  const events: GraphEvent[] = [
    { type: 'node.add', at, node: { id: root, kind: 'requirement', label: plan.title, source: 'agent', status: 'active', metadata: { plan: planId } } },
    ...plan.steps.map((s, i): GraphEvent => ({
      type: 'node.add',
      at: at + i / 1000,
      node: { id: stepNodeId(planId, s.id), kind: 'task', label: s.label, source: 'agent', status: 'planned', metadata: { plan: planId, step: s.id, order: i } },
    })),
    ...plan.steps.map((s): GraphEvent => ({ type: 'edge.add', at, from: root, to: stepNodeId(planId, s.id), kind: 'implements', source: 'agent' })),
    ...links.map((l): GraphEvent => ({
      type: 'edge.add',
      at,
      from: stepNodeId(planId, l.from),
      to: stepNodeId(planId, l.to),
      kind: (l.kind ?? 'flow') as EdgeKind,
      source: 'agent',
      metadata: l.label ? { label: l.label, fired: 0 } : { fired: 0 },
    })),
  ]
  return { planId, events }
}

/** Latest plan id in the graph, or undefined. */
export const currentPlan = (g: Graph): string | undefined =>
  Object.values(g.nodes)
    .filter(n => n.kind === 'requirement' && n.id.startsWith('plan:') && typeof n.metadata?.plan === 'string')
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.metadata?.plan as string | undefined

/**
 * A failed step fires its feedback arrows: the loop counter goes up and the
 * target step is set active again.
 */
export const stepEvents = (g: Graph, planId: string, step: StepInput, at: number): GraphEvent[] | string => {
  const id = stepNodeId(planId, step.id)
  if (!g.nodes[id]) return `unknown step "${step.id}" in plan ${planId}`
  const base: GraphEvent[] = [
    { type: 'node.update', at, id, patch: { status: step.status, metadata: step.note ? { note: step.note } : {} } },
  ]
  if (step.status !== 'failed') return base
  const loops = Object.values(g.edges).filter(e => e.from === id && e.kind === 'feedback')
  return [
    ...base,
    ...loops.flatMap((e): GraphEvent[] => [
      { type: 'edge.add', at, from: e.from, to: e.to, kind: 'feedback', source: 'agent', metadata: { fired: Number(e.metadata?.fired ?? 0) + 1 } },
      { type: 'node.update', at, id: e.to, patch: { status: 'active' } },
    ]),
  ]
}
