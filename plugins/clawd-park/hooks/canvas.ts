// A grid of terminal cells and the drawing primitives the park uses.
// Every cell is three numbers, as a Raster packs them: code point, fg, bg.

export const DEFAULT = 0x01000000 // the terminal's own color
const KEEP = -1 // leave the cell's current color alone

const SPACE = 0x20
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const FULL = 0x2588 // █

// A color from a number (0xRRGGBB), a '#rrggbb' string, or nothing
export function color(v: unknown, fallback = KEEP): number {
  if (v === undefined || v === null) return fallback
  if (typeof v === 'number') return v === DEFAULT ? DEFAULT : v & 0xffffff
  return parseInt(String(v).replace('#', ''), 16)
}

const clamp255 = (x: number) => Math.max(0, Math.min(255, Math.round(x)))

export function mix(a: unknown, b: unknown, k: number): number {
  const x = color(a, 0), y = color(b, 0)
  k = Math.max(0, Math.min(1, k))
  const lerp = (sh: number) => clamp255(((x >> sh) & 255) * (1 - k) + ((y >> sh) & 255) * k)
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0)
}

// A seeded random number source, so the park moves the same way in tests
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Canvas {
  readonly cells: Uint32Array
  readonly w: number
  readonly h: number
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.cells = new Uint32Array(w * h * 3)
    this.clear()
  }

  clear() {
    for (let i = 0; i < this.cells.length; i += 3) {
      this.cells[i] = SPACE
      this.cells[i + 1] = DEFAULT
      this.cells[i + 2] = DEFAULT
    }
  }

  // Low-level write; fg/bg of KEEP leave the cell's color as it is
  set(x: number, y: number, cp: number, fg: number, bg: number) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 3
    this.cells[i] = cp
    if (fg !== KEEP) this.cells[i + 1] = fg
    if (bg !== KEEP) this.cells[i + 2] = bg
  }

  put(x: number, y: number, ch: string, fg?: unknown, bg?: unknown) {
    this.set(x, y, ch.codePointAt(0)!, color(fg, DEFAULT), color(bg))
  }

  text(x: number, y: number, s: string, fg?: unknown, bg?: unknown) {
    const f = color(fg, DEFAULT), b = color(bg)
    let cx = Math.floor(x)
    for (const ch of s) this.set(cx++, y, ch.codePointAt(0)!, f, b)
  }

  fill(x: number, y: number, w: number, h: number, bg: unknown) {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) this.set(xx, yy, SPACE, KEEP, color(bg))
  }

  // A half-cell pixel: py counts half rows, so pixels are about square
  pixel(x: number, py: number, c: unknown) {
    x = Math.floor(x)
    py = Math.floor(py)
    if (x < 0 || py < 0 || x >= this.w || py >= this.h * 2) return
    const i = ((py >> 1) * this.w + x) * 3
    const cp = this.cells[i]!, fg = this.cells[i + 1]!, bg = this.cells[i + 2]!
    let top = bg, bottom = bg
    if (cp === UPPER) top = fg
    else if (cp === LOWER) bottom = fg
    else if (cp === FULL) top = bottom = fg
    const v = color(c, DEFAULT)
    if (py & 1) bottom = v
    else top = v
    // ▀ paints its top half in fg; with no top color, ▄ keeps the default above
    const lowerOnly = top === DEFAULT
    this.cells[i] = lowerOnly && bottom === DEFAULT ? SPACE : lowerOnly ? LOWER : UPPER
    this.cells[i + 1] = lowerOnly ? bottom : top
    this.cells[i + 2] = lowerOnly ? DEFAULT : bottom
  }

  disc(cx: number, pcy: number, r: number, c: unknown) {
    for (let py = Math.floor(pcy - r); py <= pcy + r; py++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dy = py + 0.5 - pcy
        if (dx * dx + dy * dy <= r * r) this.pixel(x, py, c)
      }
    }
  }

  // Pixel art: each character of a row is one pixel in the palette's color
  // for it, two pixel rows to a cell; '.' is see-through. py counts half rows.
  art(x: number, py: number, rows: string[], palette: Record<string, unknown>) {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] !== '.') this.pixel(x + dx, py + dy, palette[row[dx]!] ?? '#ffffff')
    })
  }

  // A label on a dark chip: [like this]
  tag(x: number, y: number, label: string, fg: unknown = 0xc8c8d8) {
    this.text(x, y, `[${label}]`, fg, 0x1c1c26)
  }

  base64(): string {
    const bytes = new Uint8Array(this.cells.buffer)
    const native = (bytes as unknown as { toBase64?: () => string }).toBase64
    if (native) return native.call(bytes)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }
}
