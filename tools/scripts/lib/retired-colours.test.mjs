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
 * Pins the AGL-1431 detector.
 *
 *   node --test tools/scripts/lib/retired-colours.test.mjs
 *
 * A detector for a defect that shows up 176 times has one dangerous failure
 * mode: reporting a small number, or zero, and being believed. Every case
 * here is built from bytes actually observed in the live `/pricing` payload
 * on 2026-08-11, and the counting cases assert the FULL multiplicity — a
 * detector that deduped to distinct rules would report 6 where the page has
 * 170, which is exactly how this regression stayed invisible.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  RETIRED_COLOURS,
  auditRenderedPage,
  findColourOccurrences,
} from './retired-colours.mjs'

/** The escaped-JSON shape the flight payload uses. 143 of these on /pricing. */
const authoredNode = (hex) =>
  `{\\"fontSize\\":\\"15px\\",\\"fontWeight\\":600,\\"color\\":\\"${hex}\\",\\"@scheme dark\\":{}}`

/** The emitted emotion rule for the same node. Only 6 distinct on /pricing. */
const emittedRule = (hex) => `line-height:1.5;font-size:15px;color:${hex};`

/** The theme describing its own dark-scheme primary.dark. Present everywhere. */
const themePalette = `\\"primary\\":{\\"main\\":\\"#00b0ff\\",\\"dark\\":\\"#4fc3f7\\",\\"contrastText\\":\\"#FFF\\"}`

test('counts every occurrence, not every distinct rule', () => {
  // The shape that made this invisible: one authored decision duplicated
  // across the compare table's ✓ glyphs, deduped by emotion to one rule.
  const html = `${authoredNode('#0090d9').repeat(163)}${emittedRule('#0090d9')}`
  const found = findColourOccurrences(html, '#0090d9')

  assert.equal(found.total, 164)
  assert.equal(found.violations, 164, 'must not dedupe to distinct rules')
  assert.equal(found.byKey.color, 164)
})

test('finds the hex in all three delivered shapes', () => {
  for (const html of [
    `\\"color\\":\\"#0090d9\\"`, // escaped JSON, flight payload
    `"color":"#0090d9"`, // plain JSON, script tag
    `color:#0090d9;`, // emitted CSS
    `"backgroundColor": "#0090D9"`, // spaced, and uppercase
  ])
    assert.equal(
      findColourOccurrences(html, '#0090d9').violations,
      1,
      `missed the hex in: ${html}`,
    )
})

test('exempts the theme palette slot but not an authored pin', () => {
  // Both on one page, which is precisely the live /pricing situation.
  const html = `${themePalette}${themePalette}${authoredNode('#4fc3f7').repeat(19)}`
  const found = findColourOccurrences(html, '#4fc3f7')

  assert.equal(found.total, 21)
  assert.equal(found.exempt, 2, 'the two palette slots are the theme, not an author')
  assert.equal(found.exemptByKey.dark, 2)
  assert.equal(found.violations, 19)
})

test('a page carrying only the theme palette is clean', () => {
  // `/` and `/product/media` measured exactly this on 2026-08-11: two
  // occurrences of #4fc3f7, zero authored. If this ever reports a violation
  // the check would cry wolf on the pages the migration got right.
  const { clean, findings } = auditRenderedPage(`${themePalette}${themePalette}`)

  assert.equal(clean, true)
  const dark = findings.find((f) => f.hex === '#4fc3f7')
  assert.equal(dark.total, 2)
  assert.equal(dark.violations, 0)
})

test('an unattributed occurrence still counts', () => {
  // Bias is deliberate: a hex we cannot explain is a hex we report. The
  // opposite bias is what a broken check looks like.
  const found = findColourOccurrences('<p>brand blue is #0090d9</p>', '#0090d9')

  assert.equal(found.violations, 1)
  assert.equal(found.byKey['(unattributed)'], 1)
})

test('does not match a longer hex token', () => {
  // #0090d9ff is a different colour; matching it would be a false positive.
  assert.equal(findColourOccurrences('color:#0090d9ff;', '#0090d9').total, 0)
  assert.equal(findColourOccurrences('color:#0090d9;', '#0090d9').total, 1)
})

test('the retired set stays small and self-describing', () => {
  // This is a named-set check, not a palette linter. Growing it silently is
  // how it turns into a sweep nobody can act on.
  assert.deepEqual(
    RETIRED_COLOURS.map((c) => c.hex),
    ['#0090d9', '#4fc3f7'],
  )
  for (const colour of RETIRED_COLOURS) {
    assert.ok(colour.retiredBy, `${colour.hex} must name the issue that retired it`)
    assert.ok(colour.replacement, `${colour.hex} must name a replacement`)
  }
})

test('the AA replacement is never itself reported', () => {
  // #0073ae is the migration target — 22 occurrences on live /pricing.
  const { clean } = auditRenderedPage(`\\"color\\":\\"#0073ae\\"`.repeat(22))
  assert.equal(clean, true)
})
