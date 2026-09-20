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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A labelled select that draws something while it is EMPTY must shrink its
 * label.
 *
 * MUI shrinks a label when the input reports itself filled, and an empty
 * select reports the opposite — so `displayEmpty`, whose whole job is to draw
 * a placeholder for the empty value, prints that placeholder UNDER the
 * full-size label. Two lines of text on one line. The field still works, which
 * is why it survives review: it is only wrong to look at.
 *
 * Every fix in the tree says the same thing in a comment, which is the tell
 * that it is a class rather than an incident: `preset-choice`, `css-gradient`,
 * `css-border`, `form-contact-fields-card`, `lead-convert-dialog`,
 * `settings-section`, the plugin-review page and the form field. The one that
 * was missed — `campaign-picker`, the picker four console surfaces render —
 * is what this spec was written for.
 *
 * ## What it does NOT flag
 *
 * A select with no `label` of its own. Half the `displayEmpty` in the tree is
 * a besigner unit box or a filter with its caption drawn beside it, and those
 * have no floating label to collide with. The pairing this guards is
 * specifically `label` + `displayEmpty`.
 */
const ROOTS = [
  join(__dirname, '..', 'app'),
  join(__dirname, '..', 'components'),
  join(__dirname, '..', '..', '..', 'libs'),
]

function* tsxFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* tsxFiles(path)
    // Shipped components only. A spec that renders a deliberately unfixed
    // select to assert the symptom is not a defect in the console.
    else if (path.endsWith('.tsx') && !path.endsWith('.spec.tsx')) yield path
  }
}

/**
 * The element that owns a `displayEmpty`, as source text.
 *
 * Read by balancing `<`/`>` backwards from the keyword to the opening `<` of
 * its element and forwards to the end of that element's props, so a
 * `displayEmpty` written inside `slotProps={{ select: … }}` is attributed to
 * the `TextField` that carries it — which is also where its `label` and its
 * `inputLabel` slot are written. An element-shaped window is the only one that
 * can see all three.
 *
 * A file-wide search would pass a file that fixed one select and not the one
 * beside it, which is exactly the shape of the miss in `css-dimension` this
 * had to be able to tell apart.
 */
function elementsWithDisplayEmpty(source: string): string[] {
  const found: string[] = []
  for (
    let at = source.indexOf('displayEmpty');
    at >= 0;
    at = source.indexOf('displayEmpty', at + 1)
  ) {
    // Back to the `<` that opens the element this prop belongs to: the last
    // one before the keyword that is not a closing tag or a comparison.
    let start = -1
    for (let cursor = at; cursor >= 0; cursor -= 1) {
      if (source[cursor] !== '<') continue
      if (/[A-Za-z]/.test(source[cursor + 1] ?? '')) {
        start = cursor
        break
      }
    }
    if (start < 0) continue
    // Forward to the end of that element's props — the first `>` at brace
    // depth zero, so nested JSX in a slot does not end it early.
    let depth = 0
    let end = source.length
    for (let cursor = start; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (character === '{') depth += 1
      else if (character === '}') depth -= 1
      else if (character === '>' && depth === 0) {
        end = cursor + 1
        break
      }
    }
    found.push(source.slice(start, end))
  }
  return found
}

/**
 * Its own `label=…`, not one belonging to a nested element such as a Chip
 * rendered from a `renderValue`.
 *
 * Past its OWN opening `<Tag`, then stopping at the next one — a nested
 * element's props are not this element's, and `renderValue={… <Chip label=… />}`
 * is the common shape that would otherwise read as a labelled select.
 */
const hasOwnLabel = (element: string) => {
  const own = element.slice(1).split(/<[A-Za-z]/)[0]
  return /\slabel=/.test(own)
}

/**
 * Whether the label is shrunk for this select — written on it, or reachable
 * from it.
 *
 * Three spellings are the fix, and all three are in the tree:
 *
 * - `slotProps={{ inputLabel: { shrink: true } }}` on a `TextField`.
 * - `notched` on a bare `Select`, whose sibling `<InputLabel shrink>` carries
 *   the other half. `notched` is never written for any other reason — an
 *   outline gap with no shrunk label to fill it is the same defect pointing
 *   the other way — so it stands in for the pair.
 * - A slot object built above the element and spread in, which is how a field
 *   that only sometimes has a placeholder says so. The spread is followed to
 *   its `const`, rather than exempted: an unresolvable spread would be a hole
 *   exactly the size of the bug.
 */
const shrinksItsLabel = (element: string, source: string) => {
  if (/shrink|notched/.test(element)) return true
  const spread = element.match(/\.\.\.(\w+)/)
  if (!spread) return false
  return new RegExp(`${spread[1]}\\s*=[\\s\\S]{0,400}?shrink`).test(source)
}

describe('a labelled displayEmpty select shrinks its label', () => {
  it('has no label + displayEmpty without shrink, anywhere', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        const source = readFileSync(file, 'utf8')
        for (const element of elementsWithDisplayEmpty(source)) {
          if (hasOwnLabel(element) && !shrinksItsLabel(element, source)) {
            const cut = Math.max(file.indexOf('/apps/'), file.indexOf('/libs/'))
            offenders.push(cut >= 0 ? file.slice(cut + 1) : file)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /*
   * The positive control. This sweep is green when the repo is clean AND when
   * the reader returns nothing, and the reader is the part with the logic —
   * so it is pinned against the three shapes it has to tell apart.
   */
  it('reads the element that owns the prop', () => {
    const broken =
      '<TextField select label="Campaigns" slotProps={{ select: { displayEmpty: true } }}>'
    const fixed =
      '<TextField select label="Campaigns" slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>'
    const unlabelled = '<Select size="small" displayEmpty value={unit}>'

    expect(elementsWithDisplayEmpty(broken).filter(hasOwnLabel).length).toBe(1)
    expect(
      elementsWithDisplayEmpty(broken).some((tag) => shrinksItsLabel(tag, broken)),
    ).toBe(false)
    expect(
      elementsWithDisplayEmpty(fixed).every((tag) => shrinksItsLabel(tag, fixed)),
    ).toBe(true)
    expect(elementsWithDisplayEmpty(unlabelled).some(hasOwnLabel)).toBe(false)
  })

  it('reaches files under every root it sweeps', () => {
    for (const root of ROOTS) {
      expect([root, [...tsxFiles(root)].length > 0]).toEqual([root, true])
    }
  })
})
