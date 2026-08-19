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
 * Strip comments and mask nothing else.
 *
 * Line and block comments only — a `//` inside a string (`'https://x'`) would
 * be mangled by a naive strip, so string spans are walked first and preserved.
 * Doing this properly matters: the colour ratchet's equivalent step is what
 * keeps a paragraph explaining the rule from tripping the rule.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  const n = source.length
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
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
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
  while (i < n) {
    const ch = source[i]
    if (ch !== "'" && ch !== '"' && ch !== '`') {
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
