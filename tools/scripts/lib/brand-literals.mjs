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
 * Detect the brand name written as a LITERAL into user-visible copy
 * (AGL-2170).
 *
 * ## Why this exists
 *
 * AGL-2153 made the platform brand configuration — `PLATFORM_BRAND_NAME`, read
 * from `NEXT_PUBLIC_PLATFORM_BRAND_NAME` — and rewired the nine places that
 * mattered most, so a self-host operator can rename the product without
 * editing source. Nothing stopped the tenth from being written the next day,
 * and a sweep found the class was already much larger than the nine: an OS
 * desktop notification, a description written into the operator's own Stripe
 * account, copy telling their publishers that *Aglyn* takes a cut of each sale.
 *
 * Every one of those was authored by someone who had no reason to know the
 * brand had become configuration. That is what a ratchet is for.
 *
 * ## Why a ratchet and not a bare zero
 *
 * The same argument AGL-2025 makes for colours, and it holds harder here: a
 * gate that fails on every existing occurrence gets switched off within the
 * hour. The baseline is a per-file CEILING, so a file may lose literals freely
 * and only gains go red, and `stale` rows are red too — a row matching nothing
 * is an exemption nobody has read since it was written.
 *
 * ## What counts
 *
 * The brand name inside a STRING LITERAL in shipped code:
 *
 *     'Use your Aglyn account'                ← counts
 *     `Welcome to Aglyn, ${name}`             ← counts
 *     "Aglyn keeps 10% of each sale"          ← counts
 *     // Aglyn sends this now, not Firebase   ← does NOT count (comment)
 *     import { x } from '@aglyn/aglyn'        ← does NOT count (identifier)
 *     `${sub}.aglyn.app`                      ← does NOT count (hostname)
 *     const h: AglynHost = …                  ← does NOT count (identifier)
 *
 * **Comments are out**, matching the colour ratchet and for the same reason:
 * the question is what ships, and prose about the brand is not brand copy.
 * A doc comment explaining why a value is configurable would otherwise be
 * counted as the very thing it explains.
 *
 * **Hostnames and package identifiers are out**, and this is the exclusion
 * most worth defending. `aglyn.app`, `@aglyn/aglyn`, `aglyn-tenant-host` and
 * `AglynHost` are hundreds of occurrences of a DIFFERENT problem with a
 * different fix — the apex is `NEXT_PUBLIC_TENANT_DOMAIN` (AGL-2121), the
 * origins are their own issue, and the package scope is not user-visible at
 * all. Folding them in would bury the signal this gate exists to carry under
 * an order of magnitude of noise, which is how a gate stops being read.
 *
 * **Specs are out.** Pinning the brand string is exactly what a spec should do
 * — `platform-brand.spec.ts` asserts the literal `'Aglyn'` on purpose, in both
 * directions, and must keep doing so.
 */

/**
 * The brand as it appears in prose. Capitalised: a lowercase `aglyn` in a
 * string is almost always a hostname, a package scope, a CSS class or a
 * cookie name, and those are excluded by the rules below anyway.
 */
export const BRAND_WORD = 'Aglyn'

/**
 * Contexts where the word is an IDENTIFIER rather than copy, keyed off what
 * immediately surrounds it.
 *
 *  - preceded by `@`, `/`, `.`, `-`, or a word character → part of a longer
 *    name (`@aglyn/`, `x/aglyn`, `foo.Aglyn`, `sub-aglyn`, `MyAglyn`)
 *  - followed by `.`, `/`, `-`, `_`, or an uppercase/lowercase letter →
 *    `Aglyn.app`, `AglynHost`, `Aglynish`
 *
 * A trailing lowercase letter is deliberately excluded too: `Aglyn` as copy is
 * a proper noun and is followed by a space, punctuation or the end of the
 * string, never by more letters.
 */
const IDENTIFIER_BEFORE = /[@/.\-\w]$/
const IDENTIFIER_AFTER = /^[./\-_A-Za-z]/

/**
 * ## Regex literals, and why both walkers below have to know about them
 *
 * A regex literal can contain a quote — `/[&<>"']/g` is an ordinary HTML
 * escaper — and a walker that does not recognise one reads that `"` as the
 * start of a STRING. Everything after it is then parsed one quote out of
 * phase, for the rest of the file: comments stop being stripped, and the
 * doc-comment prose this detector deliberately ignores gets counted as copy.
 *
 * That is not hypothetical. `libs/plugins/commerce/src/lib/server/
 * supplier-update.ts` has exactly that escaper, and its only `Aglyn` is in a
 * doc comment fourteen lines later — the gate reported it as a GAINED literal
 * and went red on a file with no brand copy in it at all (AGL-2278). The same
 * desync runs the other way too: text the walker swallows into a phantom
 * string span is text it can no longer see a real literal in, so this class
 * manufactures false GREENS as readily as false REDS.
 *
 * ### Telling a regex from a division without a parser
 *
 * `/` is regex-or-division depending on the PRECEDING token, which is the one
 * genuinely ambiguous thing in JS lexing. The standard heuristic: after an
 * operand — an identifier, a number, `)`, `]`, or a closing quote — a `/` is
 * division; after an operator or an opening bracket it starts a regex.
 *
 * Two deliberate narrowings, each guarding a real shape in this repo:
 *
 *  - **`<` is never a regex opener here.** `</div>` in a `.tsx` file is a
 *    closing JSX tag whose `/` follows `<`, and treating it as a regex would
 *    swallow to the next `/` on the line — inventing exactly the desync this
 *    change exists to remove, in the file type that carries most of the copy.
 *    `x < /re/` is not real code; JSX is on every console page.
 *  - **A regex must close on its own line.** If no unescaped `/` terminates it
 *    before the newline, the guess was wrong: back out and treat the `/` as an
 *    ordinary character. Erring this way costs nothing — the worst case is the
 *    behaviour that existed before this change — while erring the other way
 *    consumes real code.
 */
const OPERAND_END = /[\w$)\]'"`]/
const REGEX_KEYWORD =
  /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|yield|await|case|do|else)$/

/**
 * Does a `/` at this point open a regex literal, given the significant
 * character before it and the code emitted so far?
 */
function opensRegex(prev, emitted) {
  if (prev === '<') return false
  if (!prev) return true
  if (!OPERAND_END.test(prev)) return true
  // `return /x/`, `typeof /x/` — an operand-looking tail that is a keyword.
  // Trailing whitespace trimmed: one caller passes the emitted source (which
  // keeps it) and the other a significant-characters-only tail (which does
  // not), and the pattern anchors at the end.
  return REGEX_KEYWORD.test(emitted.slice(-24).replace(/\s+$/, ''))
}

/**
 * End offset (exclusive, flags included) of the regex literal starting at
 * `start`, or `-1` when it does not terminate on its own line — in which case
 * the `/` was not a regex opener after all.
 */
function regexLiteralEnd(source, start) {
  let i = start + 1
  let inClass = false
  const n = source.length
  // `//` was consumed as a comment before we got here, so an immediate `/` is
  // not reachable. `/=` IS a valid regex start (`/= 'Aglyn'/` matches an
  // assignment) — divide-assign never reaches here, because `a /= 2` has an
  // operand before the slash and `opensRegex` has already said no.
  if (source[i] === undefined) return -1
  while (i < n) {
    const ch = source[i]
    if (ch === '\n') return -1
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) {
      i += 1
      while (i < n && /[a-z]/.test(source[i])) i += 1 // flags
      return i
    }
    i += 1
  }
  return -1
}

/**
 * Strip comments and mask nothing else.
 *
 * Line and block comments only — a `//` inside a string (`'https://x'`) would
 * be mangled by a naive strip, so string spans are walked first and preserved.
 * Doing this properly matters: the colour ratchet's equivalent step is what
 * keeps a paragraph explaining the rule from tripping the rule.
 *
 * Regex literals are copied through verbatim, for the reason set out above.
 *
 * A block comment's NEWLINES survive it. They carry no brand copy, but every
 * line number this module reports is counted in the stripped source, so
 * collapsing them silently shifted `--list` output by the height of whatever
 * comment came before it — in practice by the fifteen-line licence header on
 * every file in the repo, which is enough to send a reader to the wrong entry
 * and let them conclude the gate is confused.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  const n = source.length
  /** Last significant (non-whitespace) character emitted — the `/` oracle. */
  let prev = ''
  while (i < n) {
    const ch = source[i]
    // String or template literal — copy verbatim, honouring escapes.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += source[i]
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      prev = quote
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'
        i += 1
      }
      i += 2
      continue
    }
    if (ch === '/' && opensRegex(prev, out)) {
      const end = regexLiteralEnd(source, i)
      if (end !== -1) {
        out += source.slice(i, end)
        i = end
        prev = '/'
        continue
      }
    }
    out += ch
    if (!/\s/.test(ch)) prev = ch
    i += 1
  }
  return out
}

/**
 * Every string-literal span in the (comment-stripped) source, as
 * `{ start, end }` offsets into it. Template literals included — copy is
 * routinely interpolated (`` `Welcome to Aglyn, ${name}` ``).
 */
function stringSpans(source) {
  const spans = []
  let i = 0
  const n = source.length
  /**
   * As in `stripComments` — comments are gone by here, regexes are not.
   * `tail` is the last few significant characters, kept rolling rather than
   * re-sliced from the head: a `slice(0, i)` per character is quadratic, and
   * this walks fifteen thousand files.
   */
  let prev = ''
  let tail = ''
  const note = (ch) => {
    if (/\s/.test(ch)) return
    prev = ch
    tail = (tail + ch).slice(-12)
  }
  while (i < n) {
    const ch = source[i]
    if (ch !== "'" && ch !== '"' && ch !== '`') {
      if (ch === '/' && opensRegex(prev, tail)) {
        const end = regexLiteralEnd(source, i)
        if (end !== -1) {
          i = end
          note('/')
          continue
        }
      }
      note(ch)
      i += 1
      continue
    }
    const quote = ch
    const start = i
    i += 1
    while (i < n) {
      if (source[i] === '\\') {
        i += 2
        continue
      }
      if (source[i] === quote) {
        i += 1
        break
      }
      i += 1
    }
    spans.push({ start, end: i })
    note(quote)
  }
  return spans
}

/**
 * Occurrences of the brand word in user-visible copy, with line numbers.
 *
 * @param {string} source file contents
 * @returns {{ line: number, text: string }[]}
 */
export function findBrandLiterals(source) {
  const scanned = stripComments(source)
  const found = []
  const lineOf = (index) => scanned.slice(0, index).split('\n').length

  for (const { start, end } of stringSpans(scanned)) {
    const span = scanned.slice(start, end)
    let offset = 0
    for (;;) {
      const at = span.indexOf(BRAND_WORD, offset)
      if (at === -1) break
      offset = at + BRAND_WORD.length
      const before = span.slice(Math.max(0, at - 1), at)
      const after = span.slice(offset, offset + 1)
      if (IDENTIFIER_BEFORE.test(before)) continue
      if (IDENTIFIER_AFTER.test(after)) continue
      found.push({
        line: lineOf(start + at),
        text: span.slice(0, 120),
      })
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

export { compareToBaseline } from './ratchet-baseline.mjs'
