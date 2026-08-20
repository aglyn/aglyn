/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * A linear-time regular-expression engine (SEC-M8 / AGL-1881), used for host
 * redirect rules.
 *
 * WHY THIS EXISTS
 *
 * Redirect regexes are attacker-authored (any `author` on a paid site can
 * write `source` straight to Firestore — the console's validation is not a
 * control) and they execute on the tenant render path, in the Node process
 * shared by every tenant. `RegExp.prototype.exec` is a backtracking matcher,
 * so a pattern like `(a|a|aa)+` against `"aaaa…a!"` costs exponential time:
 * measured at 59 s for a 9-character pattern and a 27-character path, and it
 * keeps doubling from there. That is a multi-tenant denial of service.
 *
 * Three heuristics have been tried and bypassed (AGL-505 star height, a
 * length cap, nesting limits). A shape heuristic can never be sound: deciding
 * whether an arbitrary backtracking regex is safe is the same problem as
 * bounding its search tree. So this module does not inspect patterns for
 * dangerous shapes. It removes the backtracking engine.
 *
 * HOW IT IS LINEAR BY CONSTRUCTION
 *
 * The pattern is parsed into an AST, compiled to a small NFA bytecode, and
 * executed by a Thompson/Pike simulation: instead of trying one path at a
 * time and backtracking, it advances *all* live NFA states one input
 * character at a time, deduplicated by program counter. Each of the
 * `programLength` states is visited at most once per input character, so the
 * worst case is exactly `O(inputLength × programLength)` — there is no input
 * that makes it exponential, because there is no search tree to explode.
 *
 * Thread priority ordering, and cutting lower-priority threads when a match
 * is found, reproduce JavaScript's leftmost-first (greedy/lazy) semantics and
 * its capture-group results, so ordinary patterns behave exactly as they did.
 *
 * `new RegExp` is never called on the pattern. Constructs that cannot be
 * simulated in linear time — backreferences and lookaround — are not merely
 * rejected by a checker that might have a hole; there is no instruction that
 * could execute them, and the parser has no production that accepts them.
 *
 * WHAT THIS DOES NOT DO
 *
 * It is not a general-purpose RegExp replacement. It implements the subset
 * documented in `UNSUPPORTED_SYNTAX` below and nothing else, and it makes no
 * attempt at unicode mode, sticky/global state, or `lastIndex`.
 */

/**
 * Syntax deliberately outside the supported subset. Each entry is a
 * construct that either cannot be simulated in linear time at all
 * (backreferences, lookaround) or that is simply not implemented.
 */
export const UNSUPPORTED_SYNTAX = [
  'lookahead `(?=…)` / `(?!…)`',
  'lookbehind `(?<=…)` / `(?<!…)`',
  'backreferences `\\1`…`\\9`, `\\k<name>`',
  'named groups `(?<name>…)`',
  'word boundaries `\\b` / `\\B`',
  'unicode property escapes `\\p{…}` / `\\P{…}`',
  'inline flags and other `(?…)` groups',
  'negated shorthands (`\\D`, `\\W`, `\\S`) inside a `[…]` class',
] as const

/**
 * Ceiling on compiled program size. Bounded repeats are expanded (`a{3}`
 * becomes three copies), so this is what stops `(\d{99}){99}` from turning a
 * short pattern into a huge program.
 *
 * This is a resource bound, not a shape heuristic: execution is already
 * linear in program length, so bounding the program bounds total work at
 * `MAX_PROGRAM_LENGTH × inputLength` ≈ 1000 × 500 = 5×10^5 state visits in
 * the absolute worst case — a few milliseconds, and flat in the input rather
 * than exponential. Nothing about *which* patterns are dangerous is being
 * guessed here; every accepted pattern is already safe.
 */
const MAX_PROGRAM_LENGTH = 1000

/** Largest bounded-repeat count accepted, e.g. the `99` in `a{2,99}`. */
const MAX_REPEAT_COUNT = 100

/** Largest capture-group count. Destinations only substitute `$1`…`$9`. */
const MAX_CAPTURE_GROUPS = 20

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { t: 'empty' }
  | { t: 'alt'; options: Node[] }
  | { t: 'cat'; items: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number; greedy: boolean }
  | { t: 'char'; c: number }
  | { t: 'class'; ranges: number[]; negated: boolean }
  | { t: 'any' }
  | { t: 'assertStart' }
  | { t: 'assertEnd' }
  | { t: 'group'; index: number; node: Node }

/** Thrown for any pattern outside the supported subset. Never escapes. */
class PatternError extends Error {}

// ---------------------------------------------------------------------------
// Character-class helpers
// ---------------------------------------------------------------------------

const DIGIT_RANGES = [0x30, 0x39]
const WORD_RANGES = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]
const SPACE_RANGES = [
  0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028,
  0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
]

/** `.` matches anything but a line terminator (no `s` flag), as in JS. */
const isLineTerminator = (code: number) =>
  code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029

/** Ranges are stored as flat `[lo, hi, lo, hi, …]` pairs. */
function rangesContain(ranges: number[], code: number): boolean {
  for (let i = 0; i < ranges.length; i += 2) {
    if (code >= ranges[i] && code <= ranges[i + 1]) return true
  }
  return false
}

/** The single-character escapes JS gives a non-literal meaning. */
function controlEscape(ch: string): number | null {
  switch (ch) {
    case 'n':
      return 0x0a
    case 'r':
      return 0x0d
    case 't':
      return 0x09
    case 'f':
      return 0x0c
    case 'v':
      return 0x0b
    case '0':
      return 0x00
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Recursive-descent parser for the supported subset.
 *
 * The grammar has no production for lookaround or backreferences, so those
 * are rejected structurally rather than by pattern inspection.
 */
class Parser {
  private pos = 0
  /** Group 0 is the whole match, so user groups start at 1. */
  groupCount = 0

  constructor(private readonly src: string) {}

  parse(): Node {
    const node = this.parseAlternation()
    if (this.pos < this.src.length) {
      // Only an unbalanced `)` can get here.
      throw new PatternError(`unexpected "${this.src[this.pos]}"`)
    }
    return node
  }

  private peek(): string {
    return this.src[this.pos]
  }

  private parseAlternation(): Node {
    const options: Node[] = [this.parseConcat()]
    while (this.peek() === '|') {
      this.pos++
      options.push(this.parseConcat())
    }
    return options.length === 1 ? options[0] : { t: 'alt', options }
  }

  private parseConcat(): Node {
    const items: Node[] = []
    while (this.pos < this.src.length) {
      const ch = this.peek()
      if (ch === '|' || ch === ')') break
      items.push(this.parseRepeat())
    }
    if (items.length === 0) return { t: 'empty' }
    return items.length === 1 ? items[0] : { t: 'cat', items }
  }

  private parseRepeat(): Node {
    const atom = this.parseAtom()
    let min: number
    let max: number
    const ch = this.peek()
    if (ch === '*') {
      this.pos++
      min = 0
      max = Infinity
    } else if (ch === '+') {
      this.pos++
      min = 1
      max = Infinity
    } else if (ch === '?') {
      this.pos++
      min = 0
      max = 1
    } else if (ch === '{') {
      const bounds = this.tryParseBounds()
      if (bounds === null) return atom
      min = bounds[0]
      max = bounds[1]
    } else {
      return atom
    }
    let greedy = true
    if (this.peek() === '?') {
      this.pos++
      greedy = false
    }
    if (this.peek() === '*' || this.peek() === '+') {
      // `a**` is a syntax error in JS too; refuse rather than guess.
      throw new PatternError('a quantifier cannot follow a quantifier')
    }
    if (
      atom.t === 'assertStart' ||
      atom.t === 'assertEnd' ||
      atom.t === 'empty'
    ) {
      throw new PatternError('nothing to repeat')
    }
    return { t: 'rep', node: atom, min, max, greedy }
  }

  /**
   * `{2}`, `{2,}`, `{2,5}`. A `{` that is not a valid bound is a literal
   * brace in JS (`/a{x/` is fine), so return null and let the caller keep
   * the atom; `parseAtom` will have already consumed the `{` as a literal.
   */
  private tryParseBounds(): [number, number] | null {
    const start = this.pos
    this.pos++ // consume `{`
    const digits = (): number | null => {
      const from = this.pos
      while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos])) {
        this.pos++
      }
      if (this.pos === from) return null
      return Number(this.src.slice(from, this.pos))
    }
    const min = digits()
    if (min === null) {
      this.pos = start
      return null
    }
    let max = min
    if (this.peek() === ',') {
      this.pos++
      if (this.peek() === '}') {
        max = Infinity
      } else {
        const parsed = digits()
        if (parsed === null) {
          this.pos = start
          return null
        }
        max = parsed
      }
    }
    if (this.peek() !== '}') {
      this.pos = start
      return null
    }
    this.pos++
    if (min > MAX_REPEAT_COUNT || (max !== Infinity && max > MAX_REPEAT_COUNT)) {
      throw new PatternError(`repeat counts above ${MAX_REPEAT_COUNT}`)
    }
    if (max < min) throw new PatternError('repeat range is backwards')
    return [min, max]
  }

  private parseAtom(): Node {
    const ch = this.src[this.pos]
    if (ch === '(') return this.parseGroup()
    if (ch === '[') return this.parseClass()
    if (ch === '\\') return this.parseEscape()
    if (ch === '.') {
      this.pos++
      return { t: 'any' }
    }
    if (ch === '^') {
      this.pos++
      return { t: 'assertStart' }
    }
    if (ch === '$') {
      this.pos++
      return { t: 'assertEnd' }
    }
    if (ch === '*' || ch === '+' || ch === '?') {
      throw new PatternError('nothing to repeat')
    }
    this.pos++
    return { t: 'char', c: ch.charCodeAt(0) }
  }

  private parseGroup(): Node {
    this.pos++ // consume `(`
    let index = 0
    if (this.peek() === '?') {
      const kind = this.src[this.pos + 1]
      if (kind === ':') {
        this.pos += 2
      } else if (kind === '=' || kind === '!') {
        throw new PatternError('lookahead is not supported')
      } else if (kind === '<') {
        const after = this.src[this.pos + 2]
        throw new PatternError(
          after === '=' || after === '!'
            ? 'lookbehind is not supported'
            : 'named groups are not supported',
        )
      } else {
        throw new PatternError('this group type is not supported')
      }
    } else {
      this.groupCount++
      if (this.groupCount > MAX_CAPTURE_GROUPS) {
        throw new PatternError(`more than ${MAX_CAPTURE_GROUPS} capture groups`)
      }
      index = this.groupCount
    }
    const node = this.parseAlternation()
    if (this.peek() !== ')') throw new PatternError('unbalanced "("')
    this.pos++
    return index === 0 ? node : { t: 'group', index, node }
  }

  private parseEscape(): Node {
    this.pos++ // consume `\`
    const ch = this.src[this.pos]
    if (ch === undefined) throw new PatternError('trailing backslash')
    this.pos++
    if (ch >= '1' && ch <= '9') {
      throw new PatternError('backreferences are not supported')
    }
    if (ch === 'k') throw new PatternError('backreferences are not supported')
    if (ch === 'b' || ch === 'B') {
      throw new PatternError('word boundaries are not supported')
    }
    if (ch === 'p' || ch === 'P') {
      throw new PatternError('unicode property escapes are not supported')
    }
    if (ch === 'd') return { t: 'class', ranges: DIGIT_RANGES, negated: false }
    if (ch === 'D') return { t: 'class', ranges: DIGIT_RANGES, negated: true }
    if (ch === 'w') return { t: 'class', ranges: WORD_RANGES, negated: false }
    if (ch === 'W') return { t: 'class', ranges: WORD_RANGES, negated: true }
    if (ch === 's') return { t: 'class', ranges: SPACE_RANGES, negated: false }
    if (ch === 'S') return { t: 'class', ranges: SPACE_RANGES, negated: true }
    if (ch === 'u' || ch === 'x') {
      const width = ch === 'u' ? 4 : 2
      const hex = this.src.slice(this.pos, this.pos + width)
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
        throw new PatternError(`malformed \\${ch} escape`)
      }
      this.pos += width
      return { t: 'char', c: parseInt(hex, 16) }
    }
    const control = controlEscape(ch)
    if (control !== null) return { t: 'char', c: control }
    // `\.` `\/` `\(` … — an escaped literal.
    return { t: 'char', c: ch.charCodeAt(0) }
  }

  private parseClass(): Node {
    this.pos++ // consume `[`
    let negated = false
    if (this.peek() === '^') {
      this.pos++
      negated = true
    }
    const ranges: number[] = []
    let first = true
    for (;;) {
      const ch = this.src[this.pos]
      if (ch === undefined) throw new PatternError('unterminated "["')
      if (ch === ']' && !first) {
        this.pos++
        break
      }
      first = false
      const lo = this.parseClassMember(ranges)
      if (lo === null) continue // a shorthand already pushed its own ranges
      // A `-` before `]` is a literal dash.
      if (this.peek() === '-' && this.src[this.pos + 1] !== ']') {
        this.pos++
        const hi = this.parseClassMember(ranges)
        if (hi === null) {
          throw new PatternError('a shorthand cannot be a range endpoint')
        }
        if (hi < lo) throw new PatternError('character range is backwards')
        ranges.push(lo, hi)
      } else {
        ranges.push(lo, lo)
      }
    }
    if (ranges.length === 0 && !negated) {
      // `[]` never matches in JS. Represent it as a negated match-everything.
      return { t: 'class', ranges: [0, 0x10ffff], negated: true }
    }
    return { t: 'class', ranges, negated }
  }

  /**
   * One member of a class. Returns its code point, or null when it was a
   * shorthand (`\d`, `\w`, `\s`) whose ranges were appended directly.
   */
  private parseClassMember(ranges: number[]): number | null {
    const ch = this.src[this.pos]
    if (ch !== '\\') {
      this.pos++
      return ch.charCodeAt(0)
    }
    this.pos++
    const esc = this.src[this.pos]
    if (esc === undefined) throw new PatternError('trailing backslash')
    this.pos++
    if (esc >= '1' && esc <= '9') {
      throw new PatternError('backreferences are not supported')
    }
    if (esc === 'D' || esc === 'W' || esc === 'S') {
      // The union of a negated shorthand with other members is not a simple
      // range list. Refuse rather than get it subtly wrong.
      throw new PatternError(
        `\\${esc} inside a character class is not supported`,
      )
    }
    if (esc === 'p' || esc === 'P') {
      throw new PatternError('unicode property escapes are not supported')
    }
    if (esc === 'd') {
      ranges.push(...DIGIT_RANGES)
      return null
    }
    if (esc === 'w') {
      ranges.push(...WORD_RANGES)
      return null
    }
    if (esc === 's') {
      ranges.push(...SPACE_RANGES)
      return null
    }
    if (esc === 'b') return 0x08 // `\b` is a backspace inside a class, as in JS
    if (esc === 'u' || esc === 'x') {
      const width = esc === 'u' ? 4 : 2
      const hex = this.src.slice(this.pos, this.pos + width)
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
        throw new PatternError(`malformed \\${esc} escape`)
      }
      this.pos += width
      return parseInt(hex, 16)
    }
    const control = controlEscape(esc)
    if (control !== null) return control
    return esc.charCodeAt(0)
  }
}

// ---------------------------------------------------------------------------
// Bytecode
// ---------------------------------------------------------------------------

type Inst =
  | { op: 'char'; c: number }
  | { op: 'class'; ranges: number[]; negated: boolean }
  | { op: 'any' }
  | { op: 'split'; x: number; y: number }
  | { op: 'jmp'; x: number }
  | { op: 'save'; slot: number }
  /** Records the input offset an optional iteration started at. */
  | { op: 'mark'; slot: number }
  /** Fails the thread unless the iteration since `mark` consumed input. */
  | { op: 'progress'; slot: number }
  /** Resets the captures inside a repeated body at each iteration. */
  | { op: 'clear'; slots: number[] }
  | { op: 'assertStart' }
  | { op: 'assertEnd' }
  | { op: 'match' }

/** Capture-group indices appearing anywhere inside a subtree. */
function collectGroups(node: Node, into: number[]): number[] {
  switch (node.t) {
    case 'group':
      into.push(node.index)
      collectGroups(node.node, into)
      break
    case 'alt':
      for (const option of node.options) collectGroups(option, into)
      break
    case 'cat':
      for (const item of node.items) collectGroups(item, into)
      break
    case 'rep':
      collectGroups(node.node, into)
      break
    default:
      break
  }
  return into
}

class Compiler {
  readonly prog: Inst[] = []
  /**
   * Scratch slots (allocated above the capture slots) holding the offset an
   * optional iteration began at, for the empty-iteration rule below.
   */
  markSlots = 0

  /** Group 0 (the whole match) opens the program and closes it. */
  compileProgram(node: Node): void {
    this.emit({ op: 'save', slot: 0 })
    this.compile(node)
    this.emit({ op: 'save', slot: 1 })
    this.emit({ op: 'match' })
  }

  private emit(inst: Inst): number {
    if (this.prog.length >= MAX_PROGRAM_LENGTH) {
      throw new PatternError(
        `pattern compiles to more than ${MAX_PROGRAM_LENGTH} instructions`,
      )
    }
    this.prog.push(inst)
    return this.prog.length - 1
  }

  compile(node: Node): void {
    switch (node.t) {
      case 'empty':
        return
      case 'char':
        this.emit({ op: 'char', c: node.c })
        return
      case 'class':
        this.emit({
          op: 'class',
          ranges: node.ranges,
          negated: node.negated,
        })
        return
      case 'any':
        this.emit({ op: 'any' })
        return
      case 'assertStart':
        this.emit({ op: 'assertStart' })
        return
      case 'assertEnd':
        this.emit({ op: 'assertEnd' })
        return
      case 'cat':
        for (const item of node.items) this.compile(item)
        return
      case 'group':
        this.emit({ op: 'save', slot: node.index * 2 })
        this.compile(node.node)
        this.emit({ op: 'save', slot: node.index * 2 + 1 })
        return
      case 'alt':
        this.compileAlt(node.options)
        return
      case 'rep':
        this.compileRep(node)
        return
    }
  }

  private compileAlt(options: Node[]): void {
    // Chain of splits; every branch jumps to a shared end.
    const jumpsToEnd: number[] = []
    for (let i = 0; i < options.length; i++) {
      const last = i === options.length - 1
      let split = -1
      if (!last) split = this.emit({ op: 'split', x: 0, y: 0 })
      if (split >= 0) {
        ;(this.prog[split] as { x: number }).x = this.prog.length
      }
      this.compile(options[i])
      if (!last) jumpsToEnd.push(this.emit({ op: 'jmp', x: 0 }))
      if (split >= 0) {
        ;(this.prog[split] as { y: number }).y = this.prog.length
      }
    }
    const end = this.prog.length
    for (const jump of jumpsToEnd) (this.prog[jump] as { x: number }).x = end
  }

  /**
   * Emits one *optional* iteration of a repeated body, applying the two
   * ECMAScript RepeatMatcher rules that a naive NFA gets wrong:
   *
   *  - captures inside the body are reset at the start of every iteration,
   *    so `/^(?:(a)|b)*$/.exec('ab')` leaves group 1 `undefined`;
   *  - an iteration that consumes nothing is discarded once `min` is
   *    satisfied, so `/^(-|\d*)?/.exec('')` also leaves group 1 `undefined`
   *    rather than capturing an empty string.
   *
   * Both are capture-visible only — they never change whether a pattern
   * matches — but getting them right keeps this engine a drop-in for the
   * patterns customers already have.
   */
  private compileOptionalBody(body: Node, captures: number[]): number {
    if (captures.length > 0) {
      this.emit({
        op: 'clear',
        slots: captures.flatMap((index) => [index * 2, index * 2 + 1]),
      })
    }
    const slot = this.markSlots++
    this.emit({ op: 'mark', slot })
    this.compile(body)
    this.emit({ op: 'progress', slot })
    return slot
  }

  private compileRep(node: {
    node: Node
    min: number
    max: number
    greedy: boolean
  }): void {
    const { min, max, greedy } = node
    const captures = collectGroups(node.node, [])
    // The mandatory copies: `min` is not yet satisfied, so the
    // empty-iteration rule does not apply to them.
    for (let i = 0; i < min; i++) this.compile(node.node)
    if (max === Infinity) {
      // L: split(body, end); body; jmp L; end:
      const split = this.emit({ op: 'split', x: 0, y: 0 })
      const bodyStart = this.prog.length
      this.compileOptionalBody(node.node, captures)
      this.emit({ op: 'jmp', x: split })
      const end = this.prog.length
      this.setSplit(split, bodyStart, end, greedy)
      return
    }
    // Bounded: `max - min` optional copies, each able to skip to the end.
    const splits: number[] = []
    for (let i = min; i < max; i++) {
      const split = this.emit({ op: 'split', x: 0, y: 0 })
      splits.push(split)
      const bodyStart = this.prog.length
      this.compileOptionalBody(node.node, captures)
      // Patch `x` now; `y` (the skip target) is patched to the shared end.
      if (greedy) (this.prog[split] as { x: number }).x = bodyStart
      else (this.prog[split] as { y: number }).y = bodyStart
    }
    const end = this.prog.length
    for (const split of splits) {
      if (greedy) (this.prog[split] as { y: number }).y = end
      else (this.prog[split] as { x: number }).x = end
    }
  }

  /** `x` is tried before `y`, so greedy puts the body first. */
  private setSplit(
    at: number,
    body: number,
    end: number,
    greedy: boolean,
  ): void {
    const inst = this.prog[at] as { x: number; y: number }
    inst.x = greedy ? body : end
    inst.y = greedy ? end : body
  }
}

// ---------------------------------------------------------------------------
// Pike VM
// ---------------------------------------------------------------------------

interface Thread {
  pc: number
  caps: number[]
}

/**
 * Simulates every live NFA state in lockstep across the input.
 *
 * The `visited` generation array is what makes this linear: within a single
 * input position each program counter is added at most once, so the whole
 * run costs at most `inputLength × programLength` steps regardless of what
 * the pattern looks like.
 */
function run(
  prog: Inst[],
  slotCount: number,
  markBase: number,
  input: string,
): number[] | null {
  const visited = new Int32Array(prog.length).fill(-1)
  let generation = 0
  const length = input.length

  const addThread = (
    list: Thread[],
    pc: number,
    caps: number[],
    sp: number,
    mark: number,
  ): void => {
    // Iterative epsilon closure — a deep pattern must not blow the JS stack.
    const stack: Array<{ pc: number; caps: number[] }> = [{ pc, caps }]
    while (stack.length > 0) {
      const entry = stack.pop()
      if (visited[entry.pc] === mark) continue
      visited[entry.pc] = mark
      const inst = prog[entry.pc]
      if (inst.op === 'jmp') {
        stack.push({ pc: inst.x, caps: entry.caps })
      } else if (inst.op === 'split') {
        // Push `y` first so `x` (the higher priority branch) pops first.
        stack.push({ pc: inst.y, caps: entry.caps })
        stack.push({ pc: inst.x, caps: entry.caps })
      } else if (inst.op === 'save') {
        const next = entry.caps.slice()
        next[inst.slot] = sp
        stack.push({ pc: entry.pc + 1, caps: next })
      } else if (inst.op === 'mark') {
        const next = entry.caps.slice()
        next[markBase + inst.slot] = sp
        stack.push({ pc: entry.pc + 1, caps: next })
      } else if (inst.op === 'progress') {
        // Discard an iteration that consumed nothing (ECMAScript
        // RepeatMatcher step 2.b). This also guarantees the epsilon closure
        // cannot cycle forever through an empty-matching body.
        if (entry.caps[markBase + inst.slot] < sp) {
          stack.push({ pc: entry.pc + 1, caps: entry.caps })
        }
      } else if (inst.op === 'clear') {
        const next = entry.caps.slice()
        for (const slot of inst.slots) next[slot] = -1
        stack.push({ pc: entry.pc + 1, caps: next })
      } else if (inst.op === 'assertStart') {
        if (sp === 0) stack.push({ pc: entry.pc + 1, caps: entry.caps })
      } else if (inst.op === 'assertEnd') {
        if (sp === length) stack.push({ pc: entry.pc + 1, caps: entry.caps })
      } else {
        list.push({ pc: entry.pc, caps: entry.caps })
      }
    }
  }

  // NOTE: the iterative closure above uses a LIFO stack, which reverses the
  // order sibling epsilon branches are appended in. Priority is restored by
  // pushing the lower-priority branch first (see the `split` case), so `x`
  // is always explored before `y`.

  const initial = new Array<number>(slotCount).fill(-1)
  let current: Thread[] = []
  addThread(current, 0, initial, 0, generation++)
  let matched: number[] | null = null

  for (let sp = 0; sp <= length; sp++) {
    if (current.length === 0) break
    const code = sp < length ? input.charCodeAt(sp) : -1
    const next: Thread[] = []
    const mark = generation++
    for (let i = 0; i < current.length; i++) {
      const thread = current[i]
      const inst = prog[thread.pc]
      if (inst.op === 'match') {
        // Leftmost-first: this thread outranks every thread after it, so its
        // result is the one a backtracking engine would return. Threads
        // *ahead* of it are still live and may overwrite this on a later
        // step — which is exactly the greedy preference JS applies.
        matched = thread.caps
        break
      }
      if (code < 0) continue
      let consumes = false
      if (inst.op === 'char') {
        consumes = code === inst.c
      } else if (inst.op === 'any') {
        consumes = !isLineTerminator(code)
      } else if (inst.op === 'class') {
        const inRanges = rangesContain(inst.ranges, code)
        consumes = inst.negated ? !inRanges : inRanges
      }
      if (consumes) addThread(next, thread.pc + 1, thread.caps, sp + 1, mark)
    }
    // `exec` searches: JS retries the whole pattern at each later offset.
    // That matters whenever `^` binds to only part of the pattern, e.g.
    // `^/a|/b$`. Seeding a fresh start thread *after* the continuing ones
    // keeps it lower priority, so an earlier start always wins (leftmost).
    // Once a match exists no later start could be more leftmost, so seeding
    // stops — which is also what bounds this to one pass.
    if (matched === null && sp + 1 <= length) {
      addThread(next, 0, initial, sp + 1, mark)
    }
    current = next
  }
  return matched
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * A compiled pattern. `exec` mirrors the slice of `RegExp.prototype.exec`
 * the redirect matcher uses: index 0 is the whole match, index n is capture
 * group n, and a group that did not participate is `undefined`.
 */
export interface LinearPattern {
  readonly source: string
  /** Instruction count — worst-case cost is `input.length × programLength`. */
  readonly programLength: number
  exec(input: string): Array<string | undefined> | null
}

/**
 * Compiles a pattern for linear-time matching, or returns null when it is
 * malformed or uses syntax outside the supported subset.
 *
 * Never throws, and never hands the pattern to `new RegExp`.
 */
export function compileLinearPattern(pattern: string): LinearPattern | null {
  try {
    const parser = new Parser(pattern)
    const ast = parser.parse()
    const compiler = new Compiler()
    compiler.compileProgram(ast)
    const prog = compiler.prog
    const groupCount = parser.groupCount
    // Capture slots first, then one scratch slot per optional iteration.
    const markBase = (groupCount + 1) * 2
    const slotCount = markBase + compiler.markSlots
    return {
      source: pattern,
      programLength: prog.length,
      exec(input: string) {
        const caps = run(prog, slotCount, markBase, String(input ?? ''))
        if (caps === null) return null
        const result: Array<string | undefined> = []
        for (let group = 0; group <= groupCount; group++) {
          const start = caps[group * 2]
          const end = caps[group * 2 + 1]
          result.push(
            start < 0 || end < 0 || end < start
              ? undefined
              : input.slice(start, end),
          )
        }
        return result
      },
    }
  } catch (error) {
    if (error instanceof PatternError) return null
    // A genuinely unexpected fault must still fail closed rather than let an
    // unvalidated pattern through.
    return null
  }
}

/**
 * Explains why a pattern was refused, for console-side validation. Returns
 * null when the pattern is fine.
 */
export function explainLinearPattern(pattern: string): string | null {
  try {
    const parser = new Parser(pattern)
    const ast = parser.parse()
    new Compiler().compileProgram(ast)
    return null
  } catch (error) {
    if (error instanceof PatternError) return error.message
    return 'the pattern could not be understood'
  }
}
