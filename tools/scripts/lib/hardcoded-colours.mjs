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
 * Detect a colour written as a LITERAL into a style position, anywhere in
 * source (AGL-2025).
 *
 * ## Why this exists next to the retired-colour census and not inside it
 *
 * The census (`retired-colours.mjs`) answers a different question. It carries
 * a two-entry `RETIRED_COLOURS` list and asks "is one of THESE two hexes
 * present" — of the published page, of the node corpus, and of source. That
 * is the right shape for its job: a completed migration being undone.
 *
 * It is the wrong shape for "an author pinned a colour". On 2026-08-18 the
 * census was RED — on a retired hex appearing in two doc comments (AGL-1939) —
 * while 161 hardcoded hexes sat in `libs/plugins` registry entries and 293
 * across the repo, none of them retired, none of them visible to it. A guard
 * precise about two values and blind to the category is the shape AGL-2002
 * and AGL-2004 are about: it cannot fail for the reason you need it to.
 *
 * So this file asks the general question, and the two coexist. Retiring a
 * specific colour stays the census's job, because it knows the replacement
 * and the reason; refusing NEW literals is this one's.
 *
 * ## Why a ratchet and not a bare zero
 *
 * There are 293 non-spec occurrences today. A guard that fails on all of them
 * is a guard someone turns off within the hour. A guard that fails on the
 * 294th is one that survives, and the debt can only shrink: the baseline is a
 * per-file CEILING, so a file may lose literals freely and gains are the only
 * thing that goes red. Deleting a file's last literal requires removing its
 * baseline row too — an entry that no longer matches anything is an entry
 * nobody has read since it was added, the same posture `EXEMPT` takes in
 * `retired-colours.test.mjs`.
 *
 * ## What counts
 *
 * A hex literal — or a fully-literal `rgb()`/`hsl()` call — that is the VALUE
 * of a colour-valued CSS/`sx` property:
 *
 *     sx: { color: '#2196f3' }          ← counts
 *     backgroundColor: '#111827'         ← counts
 *     border: '1px solid #d1d5db'        ← counts (shorthand)
 *     boxShadow: '0 8px 24px rgba(0,0,0,0.18)'   ← counts (literal rgba)
 *     sx: { color: 'primary.main' }      ← does NOT count, and must not
 *     backgroundColor: `rgba(${tv.palette.surface.mainChannel} / 0.96)`
 *                                        ← does NOT count: a channel TOKEN
 *     "#1042"                            ← does NOT count (not a style slot)
 *     // the brand blue is #00b0ff       ← does NOT count (comment)
 *
 * Comments are deliberately OUT, which is the one place this deliberately
 * disagrees with the census. The census counts them because a comment naming
 * a retired hex is an instruction to re-author it. Here the question is what
 * ships, and prose about a colour is not a colour. That difference is why
 * AGL-1939 is red and this is not, on the same two comments.
 *
 * Specs are OUT: pinning a rendered colour value is exactly what a spec
 * should do, and 225 of the 518 total occurrences are that.
 *
 * ## Why the TypeScript parser, and not a hand-rolled comment stripper (AGL-2354)
 *
 * This module used to blank comments with a character-by-character scanner:
 * skip `//` to the newline, `/* *\/` to its terminator, and skip string
 * literals whole so a `//` inside `'https://…'` could not open one. Its
 * sibling `brand-literals.mjs` carried the same shape and produced THREE
 * false GREENS in a single day (AGL-2278, AGL-2319, AGL-2350) before it was
 * replaced by the parser.
 *
 * This one was audited against a parser-based oracle over all 14,704 swept
 * files and agreed with it **line for line on every one** — the corpus does
 * not contain a shape that breaks it today. It is still replaced, because the
 * scanner *can* be broken and the corpus changes daily. A hand-written lexer
 * does not know the grammar, and the construct it does not know about is a
 * REGULAR EXPRESSION:
 *
 *     const trailing = /\/*$/          ← `/*` opens a phantom block comment
 *     path.split(/\/\//)               ← `\/` + `/` reads as `//`
 *
 * The first is the AGL-2004 shape exactly: everything from that regex to the
 * next `*\/` anywhere in the file is blanked, so every hardcoded colour in
 * between becomes invisible and the gate certifies a file it can no longer
 * read. Neither regex is exotic — stripping trailing slashes and splitting on
 * `//` are ordinary lines to write.
 *
 * So the text the finder walks is now produced by the parser: every byte that
 * is not part of a real token is blanked, which removes comments because they
 * are trivia rather than nodes, and regex literals are blanked as well because
 * the parser knows what a regex is. A hex inside `/color:\s*#[0-9a-f]{6}/` is
 * a matcher, not a style.
 */

import { createRequire } from 'node:module'

/**
 * `typescript` ships CommonJS. A `createRequire` bound to this module resolves
 * it from the repo's own `node_modules` however the script was invoked, which
 * a bare `import ts from 'typescript'` does not when the caller runs from
 * elsewhere. Same reasoning as `brand-literals.mjs`.
 */
const ts = createRequire(import.meta.url)('typescript')

/**
 * CSS properties whose value is a colour, in the camelCase form `sx` and
 * React inline styles use, plus the kebab-case form emitted CSS uses.
 *
 * `boxShadow`/`textShadow`/`border*`/`outline`/`background` are shorthands —
 * a hex can sit anywhere inside their value, so they are matched loosely
 * below rather than as `key: '#hex'`.
 */
export const COLOUR_PROPERTIES = [
  'color',
  'backgroundColor',
  'background-color',
  'borderColor',
  'border-color',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
  'columnRuleColor',
  'fill',
  'stroke',
  'stopColor',
  'floodColor',
  'lightingColor',
]

/** Shorthands that may carry a colour somewhere inside a longer value. */
export const COLOUR_SHORTHANDS = [
  'background',
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'outline',
  'boxShadow',
  'box-shadow',
  'textShadow',
  'text-shadow',
]

/** A CSS hex colour. 3, 4, 6 or 8 digits — `#fff`, `#ffff`, `#ffffff`, `#ffffffff`. */
const HEX = '#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-fA-F])'

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A colour-valued key and the start of its value:
 *
 *     color: '#2196f3'                    bare key, quoted value
 *     "color": "#2196f3"                  quoted key (JSON-ish)
 *     color:#0288d1;                      emitted CSS, unquoted
 *     borderTopColor: color || '#e0e0e0'  a fallback default
 *     border: '1px solid #d1d5db'         a shorthand
 *
 * The value is NOT matched here. Anchoring the hex to the key would miss
 * every form where an expression sits in between — and `color || '#e0e0e0'`
 * is not a corner case, it is how `email-blocks.tsx` writes all five of its
 * author-overridable defaults. The value region is walked instead, by
 * `valueRegion` below.
 */
const COLOUR_KEY = new RegExp(
  `(?:^|[^A-Za-z0-9_$-])(${[...COLOUR_PROPERTIES, ...COLOUR_SHORTHANDS]
    .map(escape)
    .join('|')})["']?\\s*:`,
  'g',
)

/** Every hex inside an already-extracted region. */
const BARE_HEX = new RegExp(HEX, 'g')

/**
 * A colour written as a FUNCTION with entirely literal arguments —
 * `rgb()`, `rgba()`, `hsl()`, `hsla()`.
 *
 * Hex is not the only way to pin a colour, and until now it was the only one
 * this detector could see: 28 literal `rgba(...)` values across 10 files sat
 * in colour slots completely invisible to it, which is the same "precise
 * about one form, blind to the category" shape the census had.
 *
 * ## Why the arguments must be literal — this is the whole subtlety
 *
 * MUI's channel tokens are WRITTEN AS `rgba()`, and they are the CORRECT
 * pattern:
 *
 *     backgroundColor: `rgba(${tv.palette.surface.mainChannel} / 0.96)`  ← themed
 *     borderRightColor: `rgba(${tv.palette.warning.darkChannel} / 0.36)` ← themed
 *     boxShadow: '0px 8px 24px rgba(0,0,0,0.18)'                        ← pinned
 *
 * Measured on the tree: 72 `rgb`/`hsl` calls sit in colour slots and 44 of
 * them are that channel idiom. A detector matching `rgba(` would fire on all
 * 72 — flagging correctly-themed code, and specifically pushing authors AWAY
 * from the token form this issue exists to push them toward. That is the
 * false-positive direction that gets a guard deleted.
 *
 * So every argument must be a bare number (optionally `%` or `deg`). An
 * interpolation, a `var(--…)`, or any identifier means the value is derived
 * from something, and derived is the thing we are asking for. Both the legacy
 * comma form and the modern space/slash form are matched, because
 * `rgb(255 255 255 / 0.5)` pins exactly as hard as `rgba(255,255,255,0.5)`.
 */
const COLOUR_FUNCTION =
  /\b(?:rgba?|hsla?)\(\s*[0-9.]+(?:%|deg)?(?:\s*[,/ ]\s*[0-9.]+(?:%|deg)?){2,3}\s*\)/g

/**
 * The extent of the value that starts at `from`.
 *
 * Ends at the first `,` `;` `}` `)` that is at the depth the value started
 * at, or at a newline — whichever comes first. Quotes are skipped whole so a
 * comma inside `'1px solid #ccc, #ddd'` does not end the value early, and
 * nesting is tracked so `{ default: '#F5F5F5', paper: '#FFF' }` is read as
 * one region rather than truncated at its first comma.
 *
 * A newline terminates because every real occurrence in this repo is written
 * on one line, and running past it would let one key claim hexes belonging to
 * the next.
 *
 * @param {string} text
 * @param {number} from index just after the colon
 * @returns {number} index one past the end of the value
 */
function valueRegion(text, from) {
  let depth = 0
  let i = from
  while (i < text.length) {
    const ch = text[i]

    if (ch === '\n') break

    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === ch) break
        if (ch !== '`' && text[i] === '\n') break
        i++
      }
      i++
      continue
    }

    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) break
      depth--
    } else if ((ch === ',' || ch === ';') && depth === 0) break

    i++
  }
  return i
}

/**
 * Which dialect to parse as.
 *
 * `.ts` must NOT be parsed as `.tsx`: the two disagree about `<T>value`, which
 * is a type assertion in one and an unclosed JSX element in the other. Getting
 * that wrong would not throw — the parser recovers — it would quietly reshape
 * the tree, which is precisely the class of silent misreading this rewrite
 * exists to end.
 *
 * `ScriptKind.JS` parses JSX, so a `.js`/`.mjs`/`.cjs` file carrying JSX is
 * covered without a separate case.
 */
function scriptKindFor(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts'))
    return ts.ScriptKind.TS
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

/**
 * Blank every byte that is not part of a real token, plus every regex literal,
 * replacing each with equivalent-length whitespace so byte offsets — and
 * therefore line numbers — survive.
 *
 * Comments fall out for free: a comment is trivia, never a token, so nothing
 * here has to know what a comment looks like. Regex literals are blanked
 * explicitly because a hex inside `/color:\s*#[0-9a-f]{6}/` is a matcher, not
 * a style.
 *
 * Everything else is KEPT, and that is deliberate. A string literal is not
 * blanked — `'.badge { color:#0288d1; }'` is emitted CSS and one of the shapes
 * this detector exists to catch — and neither is JSX text or punctuation, both
 * of which the finder's key/value regexes need.
 *
 * Two subtleties the parser makes you ask for:
 *
 *  - **JSDoc is parsed into NODES.** `getChildren()` hands back the `JSDoc`
 *    subtree of a documented declaration, so a naive token walk keeps
 *    doc-comment prose — and this repo's doc comments name hexes constantly.
 *    Verified: without the skip below, three files report occurrences that are
 *    plainly comments, including `#7A5CF0` in a paragraph about a gradient.
 *  - **`JsxText` must use `pos`, not `getStart()`.** It has no leading trivia
 *    and its whitespace is significant; skipping trivia would read a `//` in
 *    prose as a line comment.
 *
 * @param {string} source
 * @param {string} [path] file name, which selects the dialect
 * @returns {string} same length as `source`
 */
export function blankNonCode(source, path = 'source.tsx') {
  const text = String(source ?? '')
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(path),
  )
  const keep = new Uint8Array(file.text.length)

  const walk = (node) => {
    // A doc comment is a comment. Drop the subtree.
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    )
      return
    const children = node.getChildren(file)
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) return
      const start =
        node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(file)
      for (let i = start; i < node.end && i < keep.length; i++) keep[i] = 1
      return
    }
    for (const child of children) walk(child)
  }
  walk(file)

  const out = file.text.split('')
  for (let i = 0; i < out.length; i++)
    if (!keep[i] && out[i] !== '\n') out[i] = ' '
  return out.join('')
}

/**
 * Every hardcoded colour in one file's text.
 *
 * @param {string} source
 * @param {string} [path] file name, which selects the dialect. Defaults to a
 *   `.tsx` name: it is the superset that parses JSX, and the callers that omit
 *   the path are tests passing a fragment. The gate passes the real path,
 *   because `.ts` parsed as `.tsx` is a silent misread (see `scriptKindFor`).
 * @returns {Array<{ line: number, property: string, hex: string, text: string }>}
 *   `hex` carries the literal AS WRITTEN, lowercased — a hex, or a fully
 *   literal `rgb()`/`hsl()` call. The name predates the function form and is
 *   kept because the CLI and the whole test file read it.
 */
export function findHardcodedColours(source, path = 'source.tsx') {
  const text = String(source ?? '')
  const scanned = blankNonCode(text, path)
  const lines = text.split('\n')
  // Offset → line number, computed once.
  const lineAt = (offset) => {
    let line = 1
    for (let i = 0; i < offset && i < scanned.length; i++)
      if (scanned[i] === '\n') line++
    return line
  }

  const found = []
  const seen = new Set()

  const record = (offset, property, hex) => {
    const key = `${offset}:${hex}`
    if (seen.has(key)) return
    seen.add(key)
    const line = lineAt(offset)
    found.push({
      line,
      property,
      hex: hex.toLowerCase(),
      text: (lines[line - 1] ?? '').trim(),
    })
  }

  for (const match of scanned.matchAll(COLOUR_KEY)) {
    const valueStart = match.index + match[0].length
    const region = scanned.slice(valueStart, valueRegion(scanned, valueStart))
    for (const hex of region.matchAll(BARE_HEX))
      record(valueStart + hex.index, match[1], hex[0])
    for (const fn of region.matchAll(COLOUR_FUNCTION))
      record(valueStart + fn.index, match[1], fn[0])
  }

  return found.sort((a, b) => a.line - b.line)
}

/**
 * Compare a measured census against a baseline of per-file ceilings.
 *
 * Lives in `./ratchet-baseline.mjs` since AGL-2170, where the brand-literal
 * gate shares it — the three-verdict shape (and specifically that `stale` is
 * red) is a decision that must not exist in two copies. Re-exported here so
 * every existing caller and this module's own tests are unchanged.
 */
export { compareToBaseline } from './ratchet-baseline.mjs'
