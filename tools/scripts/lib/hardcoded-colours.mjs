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
 * A hex literal that is the VALUE of a colour-valued CSS/`sx` property:
 *
 *     sx: { color: '#2196f3' }          ← counts
 *     backgroundColor: '#111827'         ← counts
 *     border: '1px solid #d1d5db'        ← counts (shorthand)
 *     sx: { color: 'primary.main' }      ← does NOT count, and must not
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
 */

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
 * Strip `//`, `/* *\/` and JSX `{/* *\/}` comments, replacing each with
 * equivalent-length whitespace so byte offsets — and therefore line
 * numbers — survive.
 *
 * Written as a tiny scanner rather than a regex because a regex that tries to
 * do this gets string literals wrong, and a `//` inside `'https://…'` would
 * blank the rest of a real line. The AGL-2004 failure was exactly this shape
 * in the other direction: a line comment quoting `datasets/*` opened a
 * 571-line phantom block comment and the guard silently stopped running.
 *
 * @param {string} source
 * @returns {string} same length as `source`
 */
export function stripComments(source) {
  const text = String(source ?? '')
  const out = text.split('')
  let i = 0
  const blank = (from, to) => {
    for (let j = from; j < to && j < out.length; j++)
      if (out[j] !== '\n') out[j] = ' '
  }

  while (i < text.length) {
    const two = text.slice(i, i + 2)

    if (two === '//') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      blank(i, end)
      i = end
      continue
    }

    if (two === '/*') {
      let end = text.indexOf('*/', i + 2)
      end = end === -1 ? text.length : end + 2
      blank(i, end)
      i = end
      continue
    }

    // A string literal: skip it whole so a `//` or `/*` inside cannot open a
    // comment. Template literals may contain `${…}` but a comment inside an
    // interpolation is vanishingly rare and blanking it would be harmless.
    if (two[0] === '"' || two[0] === "'" || two[0] === '`') {
      const quote = two[0]
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text[j] === quote) break
        // An unterminated single/double-quoted string cannot span lines.
        if (quote !== '`' && text[j] === '\n') break
        j++
      }
      i = j + 1
      continue
    }

    i++
  }

  return out.join('')
}

/**
 * Every hardcoded colour in one file's text.
 *
 * @param {string} source
 * @returns {Array<{ line: number, property: string, hex: string, text: string }>}
 */
export function findHardcodedColours(source) {
  const text = String(source ?? '')
  const scanned = stripComments(text)
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
  }

  return found.sort((a, b) => a.line - b.line)
}

/**
 * Compare a measured census against a baseline of per-file ceilings.
 *
 * Three distinct verdicts, because collapsing them hides the interesting one:
 *
 *  - `regressions` — a file gained literals, or a file with none gained its
 *    first. This is what goes red.
 *  - `improvements` — a file has fewer than its baseline. Not a failure, but
 *    reported, because the baseline should be lowered in the same commit.
 *  - `stale` — a baseline row for a file that is now clean or gone. Also red:
 *    an exemption nobody has read is the AGL-2002 shape.
 *
 * @param {Record<string, number>} counts measured, file → count
 * @param {Record<string, number>} baseline file → allowed ceiling
 */
export function compareToBaseline(counts, baseline) {
  const regressions = []
  const improvements = []
  const stale = []

  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0
    if (count > allowed) regressions.push({ file, count, allowed })
    else if (count < allowed) improvements.push({ file, count, allowed })
  }

  for (const [file, allowed] of Object.entries(baseline))
    if (!counts[file]) stale.push({ file, allowed })

  const by = (a, b) => a.file.localeCompare(b.file)
  return {
    clean: regressions.length === 0 && stale.length === 0,
    regressions: regressions.sort(by),
    improvements: improvements.sort(by),
    stale: stale.sort(by),
  }
}
