import { expect, test } from 'claude-code/testing'

test('a Read call shows up in the pane on every surface', async ($, on) => {
  const written: string[] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('clock.now', () => ({ value: 1000 }))
  on('fs.write', (_$, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '/repo/src/auth.ts', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }) as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth.ts' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tracegraph', surface, component: 'Pane', requestId: 'tracegraph', props: {} } as never)
    expect(await ui.find({ type: 'Text', text: /src\/auth\.ts/ })).toBeDefined()
    await ui.press({ key: 'detail' })
    expect(await ui.find({ type: 'Text', text: /reads/ })).toBeDefined()
    await ui.press({ key: 'detail' })
    await ui.unmount()
  }
  expect(written.some(p => p.endsWith('.claude/graph/sess-1.jsonl'))).toBe(true)
})
