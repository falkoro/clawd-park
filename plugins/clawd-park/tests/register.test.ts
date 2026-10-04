import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SPINNER = {
  plugin: 'clawd-park',
  surface: 'terminal',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Working', message: null, suffix: '…', mode: 'tool-use' },
  viewport: { columns: 80, rows: 24 },
} as const

// The engine beneath the plugin: a spinner line, a clock, a store, tools that
// answer `output`, and a screen that counts blits and redraws (refusing blits
// while `screen.deny`)
function engine(on: On, stored: Record<string, unknown> = {}) {
  const output = { text: 'Tests: 12 passed', isError: false }
  const screen = { deny: false, blits: 0, redraws: 0 }
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: { command: 'park' } }))
  on('store.get', (_$, e) => ({ value: stored[e.key] }))
  on('store.set', (_$, e) => ((stored[e.key] = e.value), { value: undefined }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: output.text, text: output.text, ...(output.isError ? { isError: true } : {}) }) as any)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Working…'] }))
  on('ui.invalidate', () => (screen.redraws++, { value: undefined }))
  on('ui.blit', () => (screen.blits++, { value: screen.deny ? { deny: 'not mounted' } : {} }))
  return { clock, output, screen, stored }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'make the tests pass', turnId: 't1' })
}

const done = ($: any, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })

const status = async ($: any) => (await $.command.run({ command: 'park', args: '' })).text as string

test('the park draws under the normal spinner while a turn runs, and not between turns', async ($, on) => {
  engine(on)
  await start($)
  let spinner = await $.ui.mount(SPINNER)
  const raster = await spinner.find({ type: 'Raster' })
  expect(raster!.props).toMatchObject({ columns: 78, rows: 8 })
  expect(await spinner.find({ text: /Working/ })).toBeDefined()
  await done($)
  await spinner.unmount()
  spinner = await $.ui.mount(SPINNER)
  expect(await spinner.find({ type: 'Raster' })).toBeUndefined()
})

test('frames are blitted on a timer, and a refusal asks for one redraw', async ($, on) => {
  const { clock, screen } = engine(on)
  await start($)
  await $.ui.mount(SPINNER)
  await clock.advance(500)
  expect(screen.blits).toBeGreaterThanOrEqual(9)
  screen.deny = true
  await clock.advance(500)
  expect(screen.redraws).toBe(1)
})

test('a turn with no extinction adds to the count, which is kept between sessions', async ($, on) => {
  const { stored } = engine(on, { 'turns-since-extinction': 4 })
  await start($)
  await done($)
  expect(stored['turns-since-extinction']).toBe(5)
  expect(await status($)).toMatch(/5 turns since the last extinction/)
})

test("a helper's turn ending is not the main turn ending", async ($, on) => {
  const { stored } = engine(on, { 'turns-since-extinction': 2 })
  await start($)
  await $.tool.call({ tool: 'Agent', prompt: 'look around' } as any)
  await done($, 'helper-1')
  expect(stored['turns-since-extinction']).toBe(2)
  expect(await (await $.ui.mount(SPINNER)).find({ type: 'Raster' })).toBeDefined()
})

test('three failing test runs in a row bring the meteor down and reset the count', async ($, on) => {
  const { output, stored } = engine(on, { 'turns-since-extinction': 9 })
  await start($)
  output.text = 'Exit code 1\nTests: 1 failed'
  output.isError = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(await status($)).toMatch(/2 failing test runs in a row/)
  // Other commands failing don't count
  await $.tool.call({ tool: 'Bash', command: 'npm run build' } as any)
  expect(await status($)).toMatch(/2 failing test runs in a row/)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(stored['turns-since-extinction']).toBe(0)
  await done($)
  expect(stored['turns-since-extinction']).toBe(0)
  expect(await status($)).toMatch(/0 turns since the last extinction\.\nNo meteor in sight/)
})

test('a passing run breaks the meteor up', async ($, on) => {
  const { output } = engine(on)
  await start($)
  output.text = 'Exit code 1\nFAIL cart.test.ts'
  output.isError = true
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as any)
  expect(await status($)).toMatch(/1 failing test run in a row/)
  output.text = 'Tests: 3 passed'
  output.isError = false
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as any)
  expect(await status($)).toMatch(/No meteor in sight/)
})

test('/park off closes the park for the session and /park on opens it', async ($, on) => {
  engine(on)
  await start($)
  expect((await $.command.run({ command: 'park', args: 'off' } as any)).text).toMatch(/closed/)
  const spinner = await $.ui.mount(SPINNER)
  expect(await spinner.find({ type: 'Raster' })).toBeUndefined()
  await spinner.unmount()
  await $.command.run({ command: 'park', args: 'on' } as any)
  expect(await (await $.ui.mount(SPINNER)).find({ type: 'Raster' })).toBeDefined()
})

test('turned off in the options, the spinner is left alone', { options: { enabled: false } }, async ($, on) => {
  engine(on)
  await start($)
  const spinner = await $.ui.mount(SPINNER)
  expect(await spinner.find({ type: 'Raster' })).toBeUndefined()
  expect(await spinner.find({ text: /Working/ })).toBeDefined()
})
