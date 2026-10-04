import type { EngineInterface, Register } from 'claude-code'

import { Canvas } from './canvas'
import { IMPACT_AT, Park, describe, verdict } from './park'

const FRAME_MS = 50 // 20 frames a second
const ROWS = 8
const SAFE_KEY = 'turns-since-extinction'

type Timer = { cancel: () => void }

// The module's own state; a reload starts it over, except the count, which
// is kept in the store
let enabled = true
let park: Park | undefined
let canvas: Canvas | undefined
let columns = 78
let turnActive = false
let extinctThisTurn = false
let tick: Timer | undefined
let helpers = 0
const mounted = new Set<string>()
let wasRefused = false

const sized = () => (canvas && canvas.w === columns ? canvas : (canvas = new Canvas(columns, ROWS)))

function save($: EngineInterface) {
  if (park) $.store.set(SAFE_KEY, park.safeTurns).catch(() => {})
}

async function frame($: EngineInterface) {
  if (!park || !enabled || !mounted.size) return
  park.advance(FRAME_MS / 1000)
  const c = sized()
  park.draw(c)
  const cells = c.base64()
  for (const id of mounted) {
    const r = await $.ui.blit({ requestId: id, key: 'park', cells })
    // Refused while the spinner is hidden, behind a permission prompt say;
    // a redraw is asked for once, in case it came back without the Raster
    const isRefused = !!(r && 'deny' in r && r.deny)
    if (isRefused && !wasRefused) $.ui.invalidate('ui.render')
    wasRefused = isRefused
  }
}

export const register: Register = (on, options) => {
  enabled = options.enabled !== false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'park',
        description: 'Clawd Park under the spinner: status, on, or off',
        argumentHint: '[on|off]',
        immediate: true,
      })
    } catch {
      // Another plugin holds the name; the park still draws
    }
    park = new Park(Number(await $.store.get(SAFE_KEY).catch(() => 0)) || 0)
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    park ??= new Park()
    turnActive = true
    extinctThisTurn = false
    park.doing({ kind: 'think', text: 'thinking it over' })
    tick ??= $.clock.every(FRAME_MS, () => void frame($))
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    // A helper's loop ends turns of its own
    if (e.agentId) return next(e)
    turnActive = false
    tick?.cancel()
    tick = undefined
    mounted.clear()
    if (park && !extinctThisTurn) {
      park.safeTurns++
      save($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!park) return next(e)
    const step = describe(e.tool, e as unknown as Record<string, unknown>)
    park.doing(step)
    const helper = step.kind === 'agent' ? `helper-${++helpers}` : undefined
    if (helper) park.hatch(helper)
    try {
      const r = await next(e)
      const v = step.kind === 'test' ? verdict(r) : undefined
      if (v && park.tested(v === 'fail') === 'impact') {
        extinctThisTurn = true
        save($)
      }
      return r
    } finally {
      if (helper) park.leave(helper)
    }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!enabled || !park || !turnActive || e.surface !== 'terminal') return next(e)
    columns = Math.max(20, Math.min(512, (e.viewport?.columns ?? 80) - 2))
    mounted.add(e.requestId)
    const c = sized()
    park.draw(c)
    const { Box, Raster } = $.ui.resolve(e)
    const spinner = await next(e)
    return (
      <Box flexDirection="column">
        {spinner}
        <Raster key="park" columns={columns} rows={ROWS} cells={c.base64()} />
      </Box>
    )
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      enabled = arg === 'on'
      $.ui.invalidate('ui.render')
      return { text: enabled ? 'Clawd Park is open.' : 'Clawd Park is closed for this session. `/park on` opens it again; to close it for good, turn "Show the park" off in /plugin.' }
    }
    const n = park?.safeTurns ?? 0
    const f = park?.failures ?? 0
    return {
      text: [
        `Clawd Park is ${enabled ? 'open' : 'closed'}. ${n} turn${n === 1 ? '' : 's'} since the last extinction.`,
        f ? `The meteor is coming: ${f} failing test run${f === 1 ? '' : 's'} in a row, and it lands at ${IMPACT_AT}.` : 'No meteor in sight.',
      ].join('\n'),
    }
  })
}
