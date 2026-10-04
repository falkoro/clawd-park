import { expect, test } from 'claude-code/testing'

import { Canvas } from '../hooks/canvas'
import { Park, describe, verdict } from '../hooks/park'

const screen = (c: Canvas) =>
  Array.from({ length: c.h }, (_, y) => Array.from({ length: c.w }, (_, x) => String.fromCodePoint(c.cells[(y * c.w + x) * 3]!)).join('')).join('\n')

function run(park: Park, seconds: number, c = new Canvas(80, 8)) {
  for (let s = 0; s < seconds; s += 0.05) park.advance(0.05)
  park.draw(c)
  return screen(c)
}

test('steps are sorted by what the tool does', () => {
  for (const command of ['npm test', 'go test ./...', 'npm run test:unit', 'pytest -q', 'npx vitest run']) expect(describe('Bash', { command }).kind).toBe('test')
  for (const command of ['ls', 'npm run build', 'cat latest.log', 'git attest']) expect(describe('Bash', { command }).kind).toBe('run')
  expect(describe('Read', { file_path: '/src/cart.ts' })).toEqual({ kind: 'read', text: 'reading cart.ts' })
  expect(describe('Write', { file_path: 'a/b.md' })).toEqual({ kind: 'edit', text: 'writing b.md' })
  expect(describe('Agent', {}).kind).toBe('agent')
  expect(describe('mcp__github__create_issue', {}).text).toBe('using github')
})

test('a test run fails on a non-zero exit or counted failures, and one that never ran is no verdict', () => {
  expect(verdict({ text: 'Tests: 12 passed' })).toBe('pass')
  expect(verdict({ text: 'Tests: 0 failed, 12 passed' })).toBe('pass')
  expect(verdict({ text: 'Tests: 2 failed, 10 passed' })).toBe('fail')
  expect(verdict({ text: 'FAIL src/cart.test.ts' })).toBe('fail')
  // node --test, piped through grep so the exit code is grep's
  expect(verdict({ text: '✖ only the carnivores get meat\nℹ pass 0\nℹ fail 1' })).toBe('fail')
  expect(verdict({ text: '# pass 0\n# fail 2' })).toBe('fail')
  expect(verdict({ text: 'ℹ pass 1\nℹ fail 0' })).toBe('pass')
  expect(verdict({ isError: true, text: 'Exit code 1\nexpected 10, got 9.99' })).toBe('fail')
  expect(verdict({ isError: true, text: "The user doesn't want to proceed with this tool use." })).toBeUndefined()
  expect(verdict({ deny: 'blocked by a hook' })).toBeUndefined()
})

test('three failing runs in a row bring the meteor down; a pass in between breaks it up', () => {
  const park = new Park(7)
  expect(park.tested(true)).toBe('closer')
  expect(park.tested(false)).toBe('deflected')
  expect(park.failures).toBe(0)
  expect(park.tested(false)).toBe('pass')
  expect([park.tested(true), park.tested(true)]).toEqual(['closer', 'closer'])
  expect(park.safeTurns).toBe(7)
  expect(park.tested(true)).toBe('impact')
  expect(park.safeTurns).toBe(0)
  expect(park.failures).toBe(0)
})

test('the park shows the count, the step, the meteor and the extinction', () => {
  const park = new Park(5)
  park.doing({ kind: 'test', text: 'running npm test' })
  let s = run(park, 0.1)
  expect(s).toContain('5 turns since the last extinction')
  expect(s).toContain('[running npm test]')
  park.tested(true)
  park.tested(true)
  expect(run(park, 2)).toContain('[tests failed 2x]')
  park.tested(true)
  s = run(park, 2)
  expect(s).toContain('EXTINCTION: 3 failing test runs in a row')
  expect(s).toContain('0 turns since the last extinction')
  // The dust settles and the park comes back
  expect(run(park, 4)).not.toContain('EXTINCTION')
})

test('a narrow terminal gets a short counter', () => {
  const s = run(new Park(1), 0.1, new Canvas(40, 8))
  expect(s).toContain('1 turns safe')
})

test('helpers hatch as babies and walk off when done', () => {
  const park = new Park()
  park.hatch('a')
  park.hatch('b')
  expect(park.babies).toHaveLength(2)
  park.leave('a')
  run(park, 5)
  expect(park.babies.map((b) => b.id)).toEqual(['b'])
})
