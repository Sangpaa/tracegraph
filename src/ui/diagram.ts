// Draws a plan as a control block diagram in monospace text. Pure.
//
//          ┌──────── feedforward ────────┐
//   ┌─────┴┐   ┌───────┐   ┌───────┐   ┌▼──────┐
//   │✓ spec│──▶│● impl │──▶│✕ test │──▶│○ ship │
//   └──────┘   └───▲───┘   └───┬───┘   └───────┘
//                  └───────────┘ tests fail ×2
//
// Feedforward arrows run above the blocks, feedback loops below. The loops are
// drawn only for a chain (one block per column); otherwise they are listed.
import type { Graph, GraphEdge, GraphNode } from '../graph/model'

const GAP = '──▶'

// What a cell becomes when a loop drawn further out passes down through it.
const JOIN: Record<string, string> = { ' ': '│', '─': '┼', '└': '├', '┘': '┤', '┌': '├', '┐': '┤' }

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff)

/** Terminal cell width: CJK and Hangul take two cells. */
export const cellWidth = (s: string): number => [...s].reduce((n, ch) => n + (isWide(ch.codePointAt(0)!) ? 2 : 1), 0)


const clip = (s: string, w: number): string => {
  if (cellWidth(s) <= w) return s
  let out = ''
  for (const ch of s) {
    if (cellWidth(out + ch) > w - 1) break
    out += ch
  }
  return `${out}…`
}

const STATUS: Record<string, string> = { planned: '○', active: '●', done: '✓', failed: '✕' }
const MAX_LABEL = 18

export interface Block {
  id: string
  text: string
  col: number
  row: number
}

export interface Layout {
  blocks: Block[]
  columns: Block[][]
  forward: GraphEdge[]
  feedforward: GraphEdge[]
  feedback: GraphEdge[]
}

export const planSteps = (g: Graph, planId: string): GraphNode[] =>
  Object.values(g.nodes)
    .filter(n => n.kind === 'task' && n.metadata?.plan === planId)
    .sort((a, b) => Number(a.metadata?.order ?? 0) - Number(b.metadata?.order ?? 0))

/** Columns by longest forward path (flow + feedforward); feedback is ignored for layering. */
export const layout = (g: Graph, planId: string): Layout => {
  const steps = planSteps(g, planId)
  const ids = new Set(steps.map(s => s.id))
  const edges = Object.values(g.edges).filter(e => ids.has(e.from) && ids.has(e.to))
  const forward = edges.filter(e => e.kind === 'flow')
  const feedforward = edges.filter(e => e.kind === 'feedforward')
  const feedback = edges.filter(e => e.kind === 'feedback')
  const col = new Map(steps.map(s => [s.id, 0]))
  // Bellman-style relaxation, bounded by the step count so a cycle cannot hang.
  for (let i = 0; i < steps.length; i++) {
    for (const e of [...forward, ...feedforward]) {
      const next = (col.get(e.from) ?? 0) + 1
      if (next > (col.get(e.to) ?? 0) && next < steps.length) col.set(e.to, next)
    }
  }
  const columns: Block[][] = []
  const blocks = steps.map(s => {
    const c = col.get(s.id) ?? 0
    const column = (columns[c] ??= [])
    const block: Block = { id: s.id, text: `${STATUS[s.status ?? ''] ?? '○'} ${clip(s.label, MAX_LABEL)}`, col: c, row: column.length }
    column.push(block)
    return block
  })
  return { blocks, columns: columns.filter(c => c.length > 0), forward, feedforward, feedback }
}

const fired = (e: GraphEdge): string => {
  const n = Number(e.metadata?.fired ?? 0)
  return n > 0 ? ` ×${n}` : ''
}

const label = (e: GraphEdge): string => (typeof e.metadata?.label === 'string' ? ` ${e.metadata.label}` : '')

const quoted = (e: GraphEdge): string => (typeof e.metadata?.label === 'string' ? `  "${e.metadata.label}"` : '')

const put = (line: string[], x: number, ch: string) => {
  if (x >= 0 && x < line.length) line[x] = ch
}

/** Draws loops between block centres on lines above (feedforward) or below (feedback). */
const loopLines = (
  loops: { a: number; b: number; text: string }[],
  width: number,
  above: boolean,
): string[] => {
  const sorted = [...loops].sort((p, q) => Math.abs(p.b - p.a) - Math.abs(q.b - q.a))
  const lines = sorted.map((loop, k) => {
    const row = Array.from({ length: width }, () => ' ')
    const lo = Math.min(loop.a, loop.b)
    const hi = Math.max(loop.a, loop.b)
    for (let x = lo; x <= hi; x++) row[x] = '─'
    put(row, lo, above ? '┌' : '└')
    put(row, hi, above ? '┐' : '┘')
    // Loops drawn further out pass through this line.
    for (const outer of sorted.slice(k + 1)) {
      for (const x of [outer.a, outer.b]) row[x] = JOIN[row[x] ?? ' '] ?? row[x]!
    }
    return `${row.join('').trimEnd()}${loop.text}`
  })
  return above ? lines.reverse() : lines
}

/** Monospace lines of the diagram, or a vertical list when it does not fit. */
export const drawPlan = (g: Graph, planId: string, cols: number): string[] => {
  const lay = layout(g, planId)
  if (lay.blocks.length === 0) return []
  const widths = lay.columns.map(c => Math.max(...c.map(b => cellWidth(b.text))) + 2)
  const total = widths.reduce((a, w) => a + w + 2, 0) + GAP.length * (widths.length - 1)
  if (total > cols) return drawVertical(lay)

  const x0 = widths.map((_, i) => widths.slice(0, i).reduce((a, w) => a + w + 2 + GAP.length, 0))
  const centre = (id: string): number => {
    const b = lay.blocks.find(x => x.id === id)!
    return x0[b.col]! + Math.floor((widths[b.col]! + 2) / 2)
  }
  const isChain = lay.columns.every(c => c.length === 1)
  const backLoops = isChain ? lay.feedback.filter(e => centre(e.to) < centre(e.from)) : []
  const ffLoops = isChain ? lay.feedforward : []
  const below = loopLines(backLoops.map(e => ({ a: centre(e.to), b: centre(e.from), text: `${label(e)}${fired(e)}` })), total, false)
  const above = loopLines(ffLoops.map(e => ({ a: centre(e.from), b: centre(e.to), text: label(e) })), total, true)

  const rows = Math.max(...lay.columns.map(c => c.length))
  const grid = Array.from({ length: rows * 3 }, () => Array.from({ length: total }, () => ' '))
  lay.blocks.forEach(b => {
    const w = widths[b.col]!
    const x = x0[b.col]!
    const y = b.row * 3
    for (let i = 0; i < w + 2; i++) {
      grid[y]![x + i] = i === 0 ? '┌' : i === w + 1 ? '┐' : '─'
      grid[y + 2]![x + i] = i === 0 ? '└' : i === w + 1 ? '┘' : '─'
    }
    grid[y + 1]![x] = '│'
    grid[y + 1]![x + w + 1] = '│'
    // A wide character fills two cells: the second holds '' so join() keeps the width.
    let cx = x + 2
    for (const ch of b.text) {
      grid[y + 1]![cx] = ch
      if (cellWidth(ch) === 2) grid[y + 1]![cx + 1] = ''
      cx += cellWidth(ch)
    }
  })
  const drawn = drawBuses(lay, grid, x0.map((x, i) => x + widths[i]! + 2))
  for (const e of ffLoops) {
    put(grid[0]!, centre(e.from), '┴')
    put(grid[0]!, centre(e.to), '▼')
  }
  for (const e of backLoops) {
    put(grid[2]!, centre(e.to), '▲')
    put(grid[2]!, centre(e.from), '┬')
  }
  const out: string[] = [...above, ...grid.map(row => row.join('').trimEnd())]
  out.push(...below)
  return [...out, ...listed(lay, isChain ? [] : lay.feedforward, isChain ? lay.feedback.filter(e => !backLoops.includes(e)) : lay.feedback, drawn)]
}

const nameOf = (lay: Layout, id: string): string => lay.blocks.find(b => b.id === id)?.text.slice(2) ?? id

/** Links that the boxes cannot show are listed under the diagram. */
const listed = (lay: Layout, ff: GraphEdge[], fb: GraphEdge[], drawn: ReadonlySet<GraphEdge>): string[] => {
  const skipped = lay.forward.filter(e => !drawn.has(e))
  const lines = [
    ...skipped.map(e => `  → ${nameOf(lay, e.from)} ──▶ ${nameOf(lay, e.to)}${quoted(e)}`),
    ...ff.map(e => `  ⇢ feedforward  ${nameOf(lay, e.from)} ──▶ ${nameOf(lay, e.to)}${quoted(e)}`),
    ...fb.map(e => `  ↺ feedback     ${nameOf(lay, e.from)} ──▶ ${nameOf(lay, e.to)}${quoted(e)}${fired(e)}`),
  ]
  return lines.length ? ['', ...lines] : []
}

const drawVertical = (lay: Layout): string[] => {
  const order = [...lay.blocks].sort((a, b) => a.col - b.col || a.row - b.row)
  const lines = order.flatMap((b, i) => [`[${b.text}]`, ...(i < order.length - 1 ? ['   │', '   ▼'] : [])])
  return [...lines, ...listed(lay, lay.feedforward, lay.feedback, new Set(lay.forward))]
}

// Box-drawing glyph for a bus cell, keyed by up, down, left, right.
const BUS: Record<string, string> = {
  '0011': '─', '0001': '─', '0010': '─', '1100': '│', '0101': '┌', '1001': '└', '0110': '┐', '1010': '┘',
  '1101': '├', '1110': '┤', '0111': '┬', '1011': '┴', '1111': '┼', '1000': '│', '0100': '│',
}

/**
 * Draws forward arrows between adjacent columns in the three-cell gap: sources
 * enter from the left, a vertical bus joins them, targets leave with ▶.
 * Edges that share a block form one bus; buses that would overlap are left
 * for the list. Returns the edges it drew.
 */
const drawBuses = (lay: Layout, grid: string[][], gapStart: number[]): Set<GraphEdge> => {
  const at = new Map(lay.blocks.map(b => [b.id, b]))
  const drawn = new Set<GraphEdge>()
  for (let c = 0; c < lay.columns.length - 1; c++) {
    const edges = lay.forward.filter(e => at.get(e.from)?.col === c && at.get(e.to)?.col === c + 1)
    // Group edges that share a source or a target.
    const groups: GraphEdge[][] = []
    for (const e of edges) {
      const hit = groups.filter(g => g.some(o => o.from === e.from || o.to === e.to))
      const merged = [...hit.flat(), e]
      groups.splice(0, groups.length, ...groups.filter(g => !hit.includes(g)), merged)
    }
    const used: [number, number][] = []
    const x = gapStart[c]!
    for (const group of groups) {
      const src = new Set(group.map(e => at.get(e.from)!.row * 3 + 1))
      const dst = new Set(group.map(e => at.get(e.to)!.row * 3 + 1))
      const ys = [...src, ...dst]
      const lo = Math.min(...ys)
      const hi = Math.max(...ys)
      if (used.some(([a, b]) => lo <= b && a <= hi)) continue
      used.push([lo, hi])
      for (let y = lo; y <= hi; y++) {
        const key = `${y > lo ? 1 : 0}${y < hi ? 1 : 0}${src.has(y) ? 1 : 0}${dst.has(y) ? 1 : 0}`
        grid[y]![x] = src.has(y) ? '─' : ' '
        grid[y]![x + 1] = BUS[key] ?? '│'
        grid[y]![x + 2] = dst.has(y) ? '▶' : ' '
      }
      group.forEach(e => drawn.add(e))
    }
  }
  return drawn
}
