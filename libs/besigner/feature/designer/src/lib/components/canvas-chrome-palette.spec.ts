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

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Canvas chrome is the SLATE; the accent belongs to the user's content
 * (AGL-1194).
 *
 * Three separate chrome surfaces needed the same correction one at a time
 * after the AGL-1186 rotation, because each was found by looking at a
 * screenshot. This is the enumeration instead: every module that draws
 * editor furniture ON TOP OF the design, checked at the declaration end so
 * a new accent reference fails here rather than at the next screenshot.
 *
 * Panel chrome is deliberately NOT in this list — the hierarchy tree, the
 * breadcrumbs, the aside panel and the pickers are console UI beside the
 * canvas, not furniture drawn over the design, and the accent is right for
 * them.
 */
const CANVAS_CHROME = [
  'node-outline.tsx',
  'node-quick-actions.tsx',
  'node-pinned-actions.tsx',
  'token-pill.component.tsx',
  'inline-text-editor.component.tsx',
  'dnd/drop-indicator.tsx',
]

/**
 * The one deliberate exception, kept here so it is a stated decision and
 * not an oversight: the Layout Slot marker holds a literal accent rather
 * than a theme token, because the canvas renders under the SUBSCRIBER's
 * palette — a token would repaint the editor's own furniture whenever
 * someone restyles their site. It is also the one marker that has to stay
 * unmistakable against an arbitrary host background, and it marks the one
 * region the layout does not own rather than decorating something the
 * author drew.
 */
const ACCENT_LITERAL_EXCEPTION = {
  file: 'node-leaf.tsx',
  constant: 'SLOT_ACCENT',
}

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8')

/** Source lines with a palette reference, minus comments. */
const paletteLines = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => /palette\.|bgcolor:|backgroundColor:|Color:|color:/.test(line))

describe('canvas chrome stays on the slate (AGL-1194)', () => {
  for (const file of CANVAS_CHROME) {
    it(`${file} draws no accent`, () => {
      const offending = paletteLines(read(file)).filter((line) =>
        /\b(primary|secondary)\.(main|light|dark|contrastText)|palette\.(primary|secondary)\b/.test(
          line,
        ),
      )
      expect(offending).toEqual([])
    })

    it(`${file} hardcodes no brand hex`, () => {
      // A literal survives a palette rotation untouched, which is how the
      // slot marker ended up pink once already.
      const hexes = paletteLines(read(file)).filter((line) =>
        /#(00[bB]0[fF][fF]|[eE]040[fF][bB])/.test(line),
      )
      expect(hexes).toEqual([])
    })
  }

  it('pairs the quick-actions ink with the background it actually sits on', () => {
    // The reported symptom was buttons that nearly disappeared: the strip
    // had moved but the ink had been picked against the old background.
    // contrastText OF THIS background is a pairing, so it holds in both
    // schemes without measuring a screenshot.
    const source = read('node-quick-actions.tsx')
    expect(source).toContain("backgroundColor: 'tertiary.main'")
    expect(source).toContain("color: 'tertiary.contrastText'")
    // ...and the buttons on it must not be contained in the same colour,
    // which would make them invisible against their own strip.
    expect(source).not.toMatch(/variant=\{'contained'\}\s+color=\{'tertiary'\}/)
  })

  it('keeps the slot marker as a stated exception, not an oversight', () => {
    const source = read(ACCENT_LITERAL_EXCEPTION.file)
    expect(source).toContain(ACCENT_LITERAL_EXCEPTION.constant)
    // If someone converts it to a token, this fails and the reason above
    // gets re-read before the change lands.
    expect(source).toMatch(/const SLOT_ACCENT = '#00B0FF'/)
  })
})

/** WCAG 2.1 relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the chrome ink is paired with the chrome surface, in both schemes', () => {
  // The reported bug was ink picked once, against a background that then
  // moved. Reading both from the SAME palette entry is what makes this a
  // pairing; these numbers just confirm the pairing is legible.
  const SCHEMES = [
    { name: 'light', bg: '#404C5C', ink: '#FFFFFF' },
    // contrastText is #000000DE — the alpha rides over the slate, so the
    // worst case for contrast is the opaque black underneath it.
    { name: 'dark', bg: '#7C8CA3', ink: '#000000' },
  ]

  for (const { name, bg, ink } of SCHEMES) {
    it(`${name}: slate chrome carries its ink at AA or better`, () => {
      expect(contrast(bg, ink)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('reads both halves of the pair from one palette entry', () => {
    // This is the actual fix. The old arrangement was not a contrast
    // failure on paper — slate ink on the light-cyan strip measures about
    // 4.9:1 — it was two palette entries on one control, with the ink
    // chosen against a background it no longer sat on. Sourcing both from
    // `tertiary` is what stops that recurring at the next rotation.
    const source = read('node-quick-actions.tsx')
    const entries = new Set(
      [...source.matchAll(/'(primary|secondary|tertiary)\.[a-zA-Z]+'/g)].map(
        (match) => match[1],
      ),
    )
    expect([...entries]).toEqual(['tertiary'])
  })
})
