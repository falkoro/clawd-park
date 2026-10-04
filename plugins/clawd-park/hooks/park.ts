// Clawd Park: a coral T-rex acting out the agent's work, a baby for each
// helper it sends, and the meteor that every failing test run brings closer.

import { Canvas, mix, seeded } from './canvas'

export type Kind = 'think' | 'read' | 'edit' | 'run' | 'test' | 'web' | 'agent' | 'other'
export type Step = { kind: Kind; text: string }
export type Outcome = 'pass' | 'deflected' | 'closer' | 'impact'

export const IMPACT_AT = 3 // failing test runs in a row that bring the meteor down
const IMPACT_S = 5
const DEFLECT_S = 1.5
const HOP_S = 0.6

// ---- what the agent is doing ----

const base = (p: unknown) => String(p ?? '').split('/').pop() || 'a file'
const short = (s: unknown, n: number) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim()
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}

// A test run: a runner by name, or `test` as a word of the command
// (npm test, go test ./..., cargo test, make test, npm run test:unit)
const TEST = /\b(pytest|jest|vitest|mocha|rspec|phpunit)\b|(^|\s)test(:\S*)?(\s|$)/

export function describe(tool: string, input: Record<string, unknown>): Step {
  switch (tool) {
    case 'Bash':
      return { kind: TEST.test(String(input.command ?? '')) ? 'test' : 'run', text: `running ${short(input.command, 36)}` }
    case 'Read': return { kind: 'read', text: `reading ${base(input.file_path)}` }
    case 'Grep': case 'Glob': return { kind: 'read', text: `searching for ${short(input.pattern, 28)}` }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return { kind: 'edit', text: `${tool === 'Write' ? 'writing' : 'editing'} ${base(input.file_path ?? input.notebook_path)}` }
    case 'WebFetch': return { kind: 'web', text: `fetching ${short(input.url, 30)}` }
    case 'WebSearch': return { kind: 'web', text: 'searching the web' }
    case 'Agent': case 'Task': return { kind: 'agent', text: 'hatching a helper' }
  }
  return { kind: 'other', text: `using ${tool.startsWith('mcp__') ? tool.split('__')[1] : tool}` }
}

// A test run failed when it exited non-zero or its output counts failures:
// "2 failed", "1 failing", or node --test's "ℹ fail 1" ("# fail 1" as TAP),
// which still shows when the run is piped through grep or tail.
// One that never ran (refused, rejected at the prompt, timed out) is neither.
export function verdict(r: { deny?: unknown; isError?: boolean; text?: unknown }): 'pass' | 'fail' | undefined {
  if (r.deny) return undefined
  const text = String(r.text ?? '')
  if (/\bFAIL(ED)?\b|\b[1-9]\d* (failed|failing|failures?)\b|[ℹ#] fail [1-9]/.test(text) || (r.isError && /^Exit code [1-9]/m.test(text))) return 'fail'
  return r.isError ? undefined : 'pass'
}

// ---- the sprites, facing right; '.' is see-through ----

const HEAD = ['.XXXXX.', 'XXXXXXX', 'XoXXXXX', 'XXXXXXX', 'XXXwww.', 'XXXXX..']
const ROAR = ['.XXXXX.', 'XoXXXXX', 'XXXXXXX', 'XXXw.w.', 'XX.....', 'XXXwww.']
const BODY = ['......XXXX...', 'X....XXXXXXX.', 'XX..XXXXXX.X.', '.XXXXXXXXX...', '...XXXXXXX...']
const LEGS = ['....XX..XX...', '...XX....XX..']
const REX = { X: '#d77757', o: '#1e1414', w: '#f4efe6' } // Clawd's coral
const FOSSIL = { X: '#e8dcc0', o: '#3a3028', w: '#e8dcc0' }

const BABY = ['.......XX', '.......Xo', '......XX.', '.XXXXXXX.', 'XXXXXXXX.']
const BABY_LEGS = ['..X..X...', '.X....X..']
const BABY_COLORS = ['#7fc97f', '#6fa8dc', '#b48ead', '#e6c46a']
const EGG = ['.ss.', 'ssss', 'sdss', 'ssss', '.ss.']

const PTERO = [
  ['X.......X....', '.XX...XX.....', '..XXXXXXXoXXX', '...X.........'],
  ['.............', '..XXXXXXXoXXX', '.XX...XX.....', 'X.......X....'],
]
const FERN = ['..g..', 'g.g.g', '.ggg.', 'g.g.g', '.ggg.', '..g..', '..b..', '..b..']

const GRASS = '#4b6b2f', EARTH = '#3a2c1e', LABEL = '#e8d8b0', TAG_ALERT = '#ffb070'

const flip = (rows: string[]) => rows.map((r) => [...r].reverse().join(''))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function rexRows(pose: 'walk' | 'graze' | 'roar', stride: number, chew: boolean, facing: number) {
  const grid = Array.from({ length: 12 }, () => Array<string>(15).fill('.'))
  const stamp = (rows: string[], x: number, y: number) =>
    rows.forEach((r, dy) => [...r].forEach((ch, dx) => { if (ch !== '.') grid[y + dy]![x + dx] = ch }))
  stamp(BODY, 0, 6)
  stamp([LEGS[stride % 2]!], 0, 11)
  if (pose === 'graze') stamp(HEAD, 8, chew ? 5 : 4)
  else stamp(pose === 'roar' ? ROAR : HEAD, 6, 0)
  const rows = grid.map((r) => r.join(''))
  return facing < 0 ? flip(rows) : rows
}

// The bones: the skull whole, the body as ribs
const bones = (rows: string[]) => rows.map((r, y) => (y < 6 ? r : r.replace(/X/g, (x, i: number) => (i % 2 ? '.' : x))))

type Baby = { id: string; x: number; born: number; gone?: number; color: string; facing: number; walked: number }
type Effect = { kind: 'impact' | 'deflect' | 'hop'; at: number; x: number; py: number }

export class Park {
  safeTurns: number // turns since the last extinction
  failures = 0 // failing test runs in a row: how close the meteor is
  babies: Baby[] = []
  private t = 0
  private w = 80
  private step: Step = { kind: 'think', text: 'thinking it over' }
  private stepAt = 0
  private meteor?: { x: number; py: number } // in pixels
  private effect?: Effect
  private rex = { x: 6, target: 6, facing: 1, walked: 0 }
  private pteroAt = -Infinity
  private random = seeded(7)
  private hatched = 0

  constructor(safeTurns = 0) {
    this.safeTurns = safeTurns
  }

  get impacting() {
    return this.effect?.kind === 'impact'
  }

  doing(step: Step) {
    this.step = step
    this.stepAt = this.t
    if (step.kind === 'web') this.pteroAt = this.t
  }

  // A test run finished: a pass breaks up the meteor, a failure brings it closer
  tested(isFailed: boolean): Outcome {
    const m = this.meteor ?? { x: this.w - 8, py: 3 }
    if (!isFailed) {
      const had = this.failures > 0
      this.failures = 0
      this.meteor = undefined
      if (!this.impacting) this.effect = { kind: had ? 'deflect' : 'hop', at: this.t, ...m }
      return had ? 'deflected' : 'pass'
    }
    if (++this.failures < IMPACT_AT) return 'closer'
    this.failures = 0
    this.meteor = undefined
    this.safeTurns = 0
    this.effect = { kind: 'impact', at: this.t, ...m }
    return 'impact'
  }

  hatch(id: string) {
    const color = BABY_COLORS[this.hatched++ % BABY_COLORS.length]!
    this.babies.push({ id, x: this.rex.x - 10 * this.rex.facing, born: this.t, color, facing: this.rex.facing, walked: 0 })
  }

  leave(id: string) {
    const b = this.babies.find((b) => b.id === id && b.gone === undefined)
    if (b) b.gone = this.t
  }

  private volcanoX() {
    return this.w >= 60 ? this.w - 24 : undefined
  }

  private ferns() {
    const end = (this.volcanoX() ?? this.w) - 6
    const xs: number[] = []
    for (let x = 22; x < end; x += 30) xs.push(x)
    return xs.length ? xs : [Math.max(0, this.w - 6)]
  }

  advance(dt: number) {
    this.t += dt
    const { w, rex } = this
    if (this.effect && this.t - this.effect.at > (this.impacting ? IMPACT_S : this.effect.kind === 'hop' ? HOP_S : DEFLECT_S)) this.effect = undefined
    // The meteor drifts in to where its failures put it
    if (this.failures > 0) {
      const target = this.failures === 1 ? { x: w - 8, py: 3 } : { x: Math.round(w * 0.62), py: 6 }
      const m = (this.meteor ??= { x: w + 4, py: -3 })
      const k = Math.min(1, dt * 1.5)
      m.x += (target.x - m.x) * k
      m.py += (target.py - m.py) * k
    }
    if (!this.impacting) {
      // Rex goes where the step happens: to a fern to read, wandering to think
      const kind = this.step.kind
      if (kind === 'read') {
        const fern = this.ferns().reduce((a, b) => (Math.abs(b - rex.x) < Math.abs(a - rex.x) ? b : a))
        rex.target = fern - 12
      } else if (kind !== 'edit' && kind !== 'run' && kind !== 'test') {
        if (Math.abs(rex.target - rex.x) < 0.5 && this.random() < dt / 2) {
          rex.target = 2 + this.random() * Math.max(4, Math.min(w * 0.55, (this.volcanoX() ?? w) - 18))
        }
      }
      rex.target = clamp(rex.target, 0, w - 15)
      const d = rex.target - rex.x
      if (Math.abs(d) > 0.3) {
        const v = Math.sign(d) * Math.min(Math.abs(d), dt * 8)
        rex.x += v
        rex.facing = Math.sign(d)
        rex.walked += Math.abs(v)
      } else if (kind === 'read') rex.facing = 1
    }
    // Babies trail behind Rex; one whose helper is done walks off
    let i = 0
    for (const b of this.babies) {
      if (this.t - b.born < 0.8) continue
      const goal = b.gone !== undefined ? (rex.facing > 0 ? -14 : w + 4) : rex.facing > 0 ? rex.x - 11 * ++i : rex.x + 15 + 11 * i++
      const d = goal - b.x
      if (Math.abs(d) > 0.3) {
        const v = Math.sign(d) * Math.min(Math.abs(d), dt * 9)
        b.x += v
        b.facing = Math.sign(d)
        b.walked += Math.abs(v)
      } else b.facing = rex.facing
    }
    this.babies = this.babies.filter((b) => b.gone === undefined || this.t - b.gone < 4)
  }

  draw(c: Canvas) {
    this.w = c.w
    c.clear()
    const { t, rex, effect } = this
    const k = effect ? t - effect.at : 0
    if (effect?.kind === 'impact' && k >= 0.7 && k < 1.1) {
      c.fill(0, 0, c.w, c.h, mix('#fff4d0', '#ff7a2a', (k - 0.7) / 0.4))
      return
    }
    const ground = c.h - 1
    const vx = this.volcanoX()
    if (vx !== undefined) this.drawVolcano(c, vx)
    for (const x of this.ferns()) c.art(x, ground * 2 - 8, FERN, { g: '#5f9a3a', b: '#6b4a2a' })
    for (let x = 0; x < c.w; x++) c.put(x, ground, '▀', x % 7 === 3 ? '#5f8a3a' : GRASS, EARTH)
    const n = this.safeTurns
    c.text(1, ground, c.w >= 50 ? `${n} turn${n === 1 ? '' : 's'} since the last extinction` : `${n} turns safe`, LABEL, EARTH)
    const extinct = effect?.kind === 'impact' && k >= 1.1
    // A pterodactyl flies laps while the agent is on the web
    if (!extinct && (this.step.kind === 'web' || t - this.pteroAt < 4)) {
      const px = (((t - this.pteroAt) * 16) % (c.w + 26)) - 13
      c.art(px, 1 + Math.round(Math.sin(t * 3)), PTERO[Math.floor(t * 5) % 2]!, { X: '#b08060', o: '#1e1414' })
    }
    if (!extinct) {
      for (const b of this.babies) {
        const py = ground * 2 - 6
        if (t - b.born < 0.8) c.art(b.x + (Math.floor(t * 10) % 2), py + 1, EGG, { s: '#f0e6cc', d: '#9ab07a' })
        else {
          const rows = [...BABY, BABY_LEGS[Math.floor(b.walked / 1.2) % 2]!]
          c.art(b.x, py, b.facing < 0 ? flip(rows) : rows, { X: b.color, o: '#1e1414' })
        }
      }
    }
    this.drawRex(c, ground, extinct)
    if (this.meteor) this.drawMeteor(c, this.meteor.x, this.meteor.py, this.failures === 1 ? 1.6 : 2.6)
    if (effect?.kind === 'deflect') this.drawSparks(c, effect, k / DEFLECT_S)
    if (effect?.kind === 'impact') {
      if (k < 0.7) this.drawMeteor(c, effect.x + (rex.x + 7 - effect.x) * (k / 0.7), effect.py + (ground * 2 - 2 - effect.py) * (k / 0.7), 3, false)
      else this.drawDust(c, k)
    }
  }

  private drawRex(c: Canvas, ground: number, extinct: boolean) {
    const { t, rex, step, effect } = this
    const k = effect ? t - effect.at : 0
    const arrived = Math.abs(rex.target - rex.x) <= 0.3
    let py = ground * 2 - 12
    if (effect?.kind === 'hop') py -= Math.round(Math.sin((k / HOP_S) * Math.PI) * 3)
    if (step.kind === 'edit' && !extinct) py -= Math.floor(t * 4) % 2
    const roaring = (step.kind === 'run' && t - this.stepAt < 1.2) || effect?.kind === 'deflect'
    const pose = extinct ? 'walk' : step.kind === 'read' && arrived ? 'graze' : roaring ? 'roar' : 'walk'
    const stride = arrived ? 0 : Math.floor(rex.walked / 1.5)
    const rows = rexRows(pose, stride, Math.floor(t * 3) % 2 === 1, rex.facing)
    c.art(rex.x, py, extinct ? bones(rows) : rows, extinct ? FOSSIL : REX)
    // Dust kicked up by the stomping that an edit is
    if (step.kind === 'edit' && !extinct && Math.floor(t * 4) % 2) {
      c.put(rex.x + 2, ground - 1, '·', '#a89880')
      c.put(rex.x + 11, ground - 1, '∙', '#a89880')
    }
    if (this.impacting) return
    const label = step.text.slice(0, c.w - 2)
    c.tag(clamp(Math.round(rex.x + 7 - (label.length + 2) / 2), 0, c.w - label.length - 2), 0, label)
  }

  private drawMeteor(c: Canvas, x: number, py: number, r: number, tagged = true) {
    const n = Math.round(r * 3)
    for (let i = 1; i <= n; i++) c.pixel(x + i, py - i * 0.6, mix('#ff9a3a', '#3a1a10', i / n))
    c.disc(x, py, r, '#ff7a2a')
    c.disc(x, py, Math.max(0.8, r - 1), Math.floor(this.t * 8) % 2 ? '#ffe2a0' : '#fff4d0')
    if (!tagged) return
    const label = `tests failed ${this.failures}x`
    c.tag(Math.max(0, Math.round(x - r) - label.length - 3), Math.max(0, Math.floor(py / 2)), label, TAG_ALERT)
  }

  private drawSparks(c: Canvas, e: Effect, k: number) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      c.put(e.x + Math.cos(a) * k * 12, Math.floor((e.py + Math.sin(a) * k * 10) / 2), k < 0.5 ? '✦' : '·', mix('#ffe08a', '#ff5a2a', k))
    }
    c.tag(clamp(Math.round(e.x) - 8, 0, c.w - 12), 0, 'tests pass', '#7fe08a')
  }

  private drawVolcano(c: Canvas, x0: number) {
    const cx = x0 + 11, top = c.h * 2 - 11
    for (let r = 0; r < 9; r++) {
      const half = 2 + r * 1.25
      for (let x = Math.ceil(cx - half); x <= cx + half; x++) {
        const lava = (r === 0 && Math.abs(x - cx) < 2) || (r > 0 && r < 4 && x === cx + (r % 2))
        c.pixel(x, top + r, lava ? (r === 0 ? '#ff7a3a' : '#d4552a') : x < cx - half + 1.5 ? '#5c4a40' : '#4a3a34')
      }
    }
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 0.4 + i / 3) % 1
      const y = Math.round(top / 2 - 1 - phase * 3)
      if (y >= 0) c.put(cx + Math.round(Math.sin(this.t + i * 2) + phase * 3), y, phase < 0.5 ? 'o' : '°', mix('#9a908a', '#3a3632', phase))
    }
  }

  // After the flash, dust that settles, and the news
  private drawDust(c: Canvas, k: number) {
    const left = 1 - (k - 1.1) / 1.9
    for (let y = 0; y < c.h - 1; y++) {
      for (let x = 0; x < c.w; x++) {
        const v = (Math.sin(x * 0.35 + y * 1.7 + k * 2) + Math.sin(x * 0.13 - k * 1.3 + y)) / 4 + 0.5
        if (v < left) c.set(x, y, 0x20, -1, mix('#5a4632', '#6b5640', v))
      }
    }
    if (k < 1.6) return
    const msg = c.w >= 52 ? ` EXTINCTION: ${IMPACT_AT} failing test runs in a row ` : ' EXTINCTION '
    c.text(Math.max(0, Math.floor((c.w - msg.length) / 2)), 2, msg, TAG_ALERT, 0x1c1c26)
  }
}
