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
 * (AGL-1194), with the two stated carve-outs below for the states that say
 * what is being edited.
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

/**
 * The second deliberate exception (AGL-1221), stated here for the same
 * reason: the SELECTION outline — and nothing else on the canvas — carries
 * `secondary`.
 *
 * AGL-1194 moved it onto the slate along with the rest of the chrome, on the
 * grounds that selected (`secondary`) and hover (`primary`) were two accent
 * hues on one control. That holds for hover / drag / drop-over, which are
 * transient feedback. It does not hold for selection: selection is a
 * persistent statement about what the panels on the right are editing, it has
 * to read against an arbitrary subscriber palette, and pink is the one hue on
 * this canvas that never competes with the design being edited.
 *
 * So this is a CARVE-OUT, not a relaxation. Exactly one line of
 * `node-outline.tsx` may name `secondary`, it must be the declaration below,
 * and it may only be spent on the selection rule. `secondary` on hover, drag
 * or drop-over still fails, as does every `primary` reference outside the
 * hover carve-out stated next.
 */
const SELECTION_ACCENT_EXCEPTION = {
  file: 'node-outline.tsx',
  declaration: /^\s*const selectionAccent = tv\.palette\.secondary\.main$/,
}

/**
 * The third deliberate exception (AGL-2486): the HOVER outline and its wash
 * carry `primary`, and nothing else on the canvas does.
 *
 * AGL-1194's reasoning held for drag and drop-over, which are momentary. It
 * did not hold for hover, for the same reason it did not hold for selection:
 * hover is the pointer's half of "what am I about to edit", and it has to be
 * findable at a glance. The slate cannot do that job — it is a DESATURATED
 * BLUE roughly 17 degrees of hue from `primary`, so against the dark canvas
 * it reads as the disabled version of the affordance rather than a live one.
 *
 * So this is a second CARVE-OUT on the same terms as the selection one.
 * Exactly two lines of `node-outline.tsx` may name `primary`, they must be
 * the declarations below, and they may only be spent on the hover rule.
 * `secondary` on hover, `primary` on drag or drop-over, and any other member
 * of either slot still fail.
 */
const HOVER_ACCENT_EXCEPTION = {
  file: 'node-outline.tsx',
  declarations: [
    /^\s*const hoverAccent = tv\.palette\.primary\.main$/,
    /^\s*const hoverAccentChannel = tv\.palette\.primary\.mainChannel$/,
  ],
}

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8')

/** Source lines with a palette reference, minus comments. */
const paletteLines = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) =>
      /palette\.|bgcolor:|backgroundColor:|Color:|color:/.test(line),
    )

const ACCENT_REFERENCE =
  /\b(primary|secondary)\.(main|light|dark|contrastText)|palette\.(primary|secondary)\b/

/**
 * Accent references in one chrome module, with that module's stated
 * exception — and only its stated exception — removed.
 */
const accentOffenders = (file: string, source: string) =>
  paletteLines(source)
    .filter((line) => ACCENT_REFERENCE.test(line))
    .filter(
      (line) =>
        !(
          file === SELECTION_ACCENT_EXCEPTION.file &&
          SELECTION_ACCENT_EXCEPTION.declaration.test(line)
        ),
    )
    .filter(
      (line) =>
        !(
          file === HOVER_ACCENT_EXCEPTION.file &&
          HOVER_ACCENT_EXCEPTION.declarations.some((pattern) =>
            pattern.test(line),
          )
        ),
    )

describe('canvas chrome stays on the slate (AGL-1194)', () => {
  for (const file of CANVAS_CHROME) {
    it(`${file} draws no accent`, () => {
      expect(accentOffenders(file, read(file))).toEqual([])
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

/** HSL hue in degrees for an #rrggbb colour. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  )
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min
  if (span === 0) return 0
  const degrees =
    max === r
      ? ((g - b) / span) % 6
      : max === g
        ? (b - r) / span + 2
        : (r - g) / span + 4
  return (degrees * 60 + 360) % 360
}

/** Shortest arc between two hues, 0–180 degrees. */
const hueDistance = (a: string, b: string) => {
  const delta = Math.abs(hue(a) - hue(b)) % 360
  return delta > 180 ? 360 - delta : delta
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

describe('the selection outline is pink, as a carve-out (AGL-1221)', () => {
  const outline = () => read(SELECTION_ACCENT_EXCEPTION.file)

  it('spends the exception on the selection rule and nothing else', () => {
    const source = outline()
    // Exactly one accent declaration, and it is the one named above.
    const declared = source
      .split('\n')
      .filter((line) => SELECTION_ACCENT_EXCEPTION.declaration.test(line))
    expect(declared).toHaveLength(1)
    // It reaches the canvas only through the selected-self rule. If someone
    // spends it on hover or a fill too, the accent stops meaning "selected"
    // and this fails.
    const uses = [...source.matchAll(/\bselectionAccent\b/g)]
    expect(uses).toHaveLength(2) // the declaration, and the one use
    expect(source).toMatch(
      /selectedSelf}`]: \{\s*outlineWidth: 2,\s*outlineStyle: 'solid',\s*outlineColor: selectionAccent,\s*\}/,
    )
  })

  it('leaves the momentary states on the slate', () => {
    const source = outline()
    for (const state of ['draggingSelf', 'draggingOver']) {
      const rule = source.slice(source.indexOf(`classKeys.${state}}\`]`))
      const body = rule.slice(0, rule.indexOf('},'))
      expect(body).toContain('slate')
      expect(body).not.toContain('Accent')
    }
  })

  it('still fails on any OTHER accent reference in the same file', () => {
    // The negative control. A carve-out that quietly whitelists the file is
    // the failure mode this guards against, so drive the real detector with
    // sources that must still be rejected.
    const source = outline()
    const rejected = [
      // `secondary` spent somewhere it is not allowed...
      source.replace(
        'outlineColor: slate,\n      backgroundColor',
        'outlineColor: tv.palette.secondary.dark,\n      backgroundColor',
      ),
      // ...a third accent declaration hiding behind the same shape...
      source.replace(
        '  const selectionAccent = tv.palette.secondary.main',
        '  const selectionAccent = tv.palette.secondary.main\n  const fillAccent = tv.palette.secondary.light',
      ),
      // ...`primary` on a state that has no exception...
      source.replace(
        'const slate = tv.palette.tertiary.main',
        'const slate = tv.palette.primary.main',
      ),
      // ...and the hover exception spent on a member it does not cover, so
      // the carve-out cannot widen into "any `primary` under that name".
      source.replace(
        'const hoverAccent = tv.palette.primary.main',
        'const hoverAccent = tv.palette.primary.light',
      ),
    ]
    for (const mutated of rejected) {
      expect(mutated).not.toEqual(source) // the mutation actually applied
      expect(
        accentOffenders(SELECTION_ACCENT_EXCEPTION.file, mutated),
      ).not.toEqual([])
    }
  })
})

/**
 * Stand-in class names, so a rule KEY taken out of the source can be
 * evaluated as a real CSS selector rather than matched as text. Which names
 * these are does not matter — `generateComponentClassKeys` picks the real
 * ones at runtime — only that each state gets a distinct one.
 */
const RULE_CLASSES: Record<string, string> = {
  root: 'root',
  hoveringSelf: 'hovering',
  selectedSelf: 'selected',
  draggingSelf: 'dragging',
  draggingOver: 'drop-target',
}

/** One `styled` rule key, rewritten into a selector jsdom can match. */
const asSelector = (template: string) =>
  template
    .slice(1, -1)
    .replace(/\$\{classKeys\.(\w+)}/g, (_, key) => RULE_CLASSES[key])
    .replace(/&/g, '')

/** An element carrying exactly the states named. */
const nodeIn = (...states: string[]) => {
  const element = document.createElement('div')
  element.className = states.map((state) => RULE_CLASSES[state]).join(' ')
  return element
}

describe('the hover outline is the blue primary, as a carve-out (AGL-2486)', () => {
  const outline = () => read(HOVER_ACCENT_EXCEPTION.file)

  /**
   * The three rules this file is about, each as its selector template and the
   * properties it declares. Hover is TWO rules on purpose — see the wash /
   * border split below — so they are picked out by their keys rather than by
   * position.
   */
  const rules = () => {
    const source = outline()
    const at = (key: string) => {
      const start = source.indexOf(key)
      if (start < 0) throw new Error('no rule keyed ' + key)
      const open = source.indexOf(']: {', start) + 3
      return {
        selector: source.slice(start, source.indexOf(']: {', start)),
        body: source.slice(open, source.indexOf('},', open)),
        start,
      }
    }
    return {
      selected: at('`&.${classKeys.selectedSelf}`'),
      wash: at('`&.${classKeys.hoveringSelf}`'),
      hoverBorder: at('`&.${classKeys.hoveringSelf}:not('),
    }
  }

  it('declares the accent once per member, from `primary`', () => {
    const lines = outline().split('\n')
    for (const pattern of HOVER_ACCENT_EXCEPTION.declarations) {
      expect(lines.filter((line) => pattern.test(line))).toHaveLength(1)
    }
  })

  it('spends it on the two hover rules and nothing else', () => {
    const { wash, hoverBorder } = rules()
    expect(hoverBorder.body).toContain('outlineColor: hoverAccent,')
    expect(wash.body).toContain('hoverAccentChannel')
    expect(wash.body).not.toContain('selectionAccent')
    expect(hoverBorder.body).not.toContain('selectionAccent')
    // Every use is the declaration plus its one rule; a third would mean the
    // blue had leaked onto a state it does not name.
    const source = outline()
    expect([...source.matchAll(/\bhoverAccent\b/g)]).toHaveLength(2)
    expect([...source.matchAll(/\bhoverAccentChannel\b/g)]).toHaveLength(2)
  })

  it('splits the wash from the border, and scopes only the border', () => {
    // The wash answers "where is the pointer" and the border answers "what
    // is selected". One rule cannot carry both questions: scoping them
    // together silences the pointer on the selected node.
    const { wash, hoverBorder } = rules()
    expect(wash.body).toContain('backgroundColor:')
    expect(wash.body).not.toContain('outlineColor')
    expect(hoverBorder.body).toContain('outlineColor:')
    expect(hoverBorder.body).not.toContain('backgroundColor')
  })

  it('gives a selected node the blue wash and keeps its pink border', () => {
    // The case that was silently wrong: hovering the selected element left
    // it with no pointer feedback at all. Read as real selectors rather than
    // as text, so the `:not()` is evaluated the way a browser evaluates it.
    const { selected, wash, hoverBorder } = rules()
    const selectedAndHovered = nodeIn('selectedSelf', 'hoveringSelf')
    expect(selectedAndHovered.matches(asSelector(wash.selector))).toBe(true)
    expect(selectedAndHovered.matches(asSelector(hoverBorder.selector))).toBe(
      false,
    )
    expect(selectedAndHovered.matches(asSelector(selected.selector))).toBe(true)
    // ...while an unselected node under the pointer still gets both.
    const hoveredOnly = nodeIn('hoveringSelf')
    expect(hoveredOnly.matches(asSelector(wash.selector))).toBe(true)
    expect(hoveredOnly.matches(asSelector(hoverBorder.selector))).toBe(true)
  })

  it('needs the guard, because the hover border is declared second', () => {
    // Equal specificity, so the later rule would win outright. That ordering
    // is what the `:not()` exists to survive, and asserting it here means the
    // guard cannot be dropped as redundant after someone reorders the block.
    const { selected, hoverBorder } = rules()
    expect(hoverBorder.start).toBeGreaterThan(selected.start)
    expect(hoverBorder.selector).toContain(':not(.${classKeys.selectedSelf})')
  })

  it('leaves the selection rule nothing that could cancel the wash', () => {
    // A fill on the selected rule would paint over the hover wash on exactly
    // the node the split above exists to serve.
    expect(rules().selected.body).not.toContain('backgroundColor')
  })

  it('stays subordinate to selection by weight and style', () => {
    // The root is 1px dashed and neither hover rule overrides that, so the
    // blue can only ever be the lighter of the two treatments against the
    // selection's 2px solid.
    const { wash, hoverBorder } = rules()
    for (const { body } of [wash, hoverBorder]) {
      expect(body).not.toContain('outlineWidth')
      expect(body).not.toContain('outlineStyle')
    }
    expect(outline()).toContain("outlineStyle: 'dashed',")
  })

  it('decides the wash and the border in one file', () => {
    // The overlay component measures geometry and renders this outline once
    // per line fragment; it declares no colour of its own. That is why the
    // translucent wash over a hovered node and the border around it are two
    // rules of one styled block, not two places to keep in sync.
    expect(paletteLines(read('node-overlay.tsx'))).toEqual([])
  })

  it('keeps the wash the faintest fill on the canvas', () => {
    // Hover 0.08 < node-in-flight 0.12 < drop target 0.16. Hover is the
    // state you are in most of the time, so it is the one that must not
    // tint the design being edited.
    const alphas = [...outline().matchAll(/rgba\(\$\{\w+} \/ (0\.\d+)\)/g)].map(
      (match) => Number(match[1]),
    )
    expect(Math.min(...alphas)).toBe(0.08)
    expect(rules().wash.body).toContain('/ 0.08)')
  })
})

/**
 * The two accent literals, resolved from the built console theme rather than
 * copied from the palette source — `primary` and `secondary` are each ONE
 * colour across both schemes, so one literal per accent is the whole truth.
 */
const BLUE = '#00B0FF' // palette.primary.main
const PINK = '#E040FB' // palette.secondary.main

describe('the selection outline reads against the canvas, in both schemes', () => {
  // `viewport-frame.component.tsx` paints the artboard `background.paper`
  // over a `background.default` page, and measuring in the running console
  // confirms both surfaces sit behind a selected node. The outline is a
  // non-text graphical indicator, so 3:1 (WCAG 1.4.11) is the bar, not
  // 4.5:1 — and `secondary` is ONE colour in both schemes, so the question
  // is whether the same pink clears it at both ends. The light paper is the
  // tight end; the dark scheme has room to spare.
  const CANVASES = [
    { name: 'light paper', bg: '#FFFFFF' }, //   3.34:1
    { name: 'light page', bg: '#F5F5F5' }, //    3.06:1 — the worst case
    { name: 'dark paper', bg: '#2A3440' }, //    3.78:1
    { name: 'dark page', bg: '#161C21' }, //     5.15:1
  ]

  for (const { name, bg } of CANVASES) {
    it(`${name}: selection clears the non-text bar against the canvas`, () => {
      expect(contrast(PINK, bg)).toBeGreaterThanOrEqual(3)
    })
  }

  it('is a different hue from the hover accent and from the slate', () => {
    // AGL-1194's actual worry was two accent hues on one control. There are
    // two by design now, so what matters is that they are not near
    // neighbours that read as the same state at a glance. Measured in HUE,
    // not luminance: pink and the dark-scheme slate are within 1.03:1 of
    // each other in luminance, which is precisely why a contrast ratio
    // cannot answer this question. Weight carries the rest — selection is
    // 2px solid where hover is 1px dashed, pinned by the rule tests above.
    for (const other of [BLUE, '#404C5C', '#7C8CA3']) {
      expect(hueDistance(PINK, other)).toBeGreaterThanOrEqual(60)
    }
  })
})

describe('the hover outline reads against the dark canvas', () => {
  // The affordance was reported illegible on the dark canvas, and that is
  // what these numbers answer. `primary` is ONE colour in both schemes, so
  // the slate it replaces is the honest comparison: on the dark artboard the
  // slate measures 3.69:1 and the blue 5.20:1, and the hue tells the rest of
  // the story — the slate is a DESATURATED BLUE, 17 degrees away, so it read
  // as the disabled version of the same indicator rather than a live one.
  const CANVASES = [
    { name: 'dark paper', bg: '#2A3440' }, //   5.20:1, was 3.69:1 on slate
    { name: 'dark page', bg: '#161C21' }, //    7.08:1, was 5.02:1 on slate
  ]

  for (const { name, bg } of CANVASES) {
    it(`${name}: hover clears the non-text bar against the canvas`, () => {
      expect(contrast(BLUE, bg)).toBeGreaterThanOrEqual(3)
    })
  }

  it('is a near neighbour of the slate it replaces, which is the bug', () => {
    // Stated as a measurement so the reasoning is not re-litigated from a
    // screenshot: these two are the same hue family, which is why raising
    // contrast alone would never have fixed the affordance.
    for (const slate of ['#404C5C', '#7C8CA3']) {
      expect(hueDistance(BLUE, slate)).toBeLessThan(30)
    }
  })

  it('trades contrast on the LIGHT canvas, recorded rather than hidden', () => {
    // The one place this is a step down: against white paper the blue
    // measures 2.43:1 where the slate measured 8.73:1, so it does NOT clear
    // the 3:1 non-text bar there. Hover is momentary pointer-tracking
    // feedback, it carries a second cue in the wash, and it sits under the
    // pointer itself, so it is held to the dark-canvas bar above. If the
    // light scheme has to clear 3:1 too, `primary.dark` is the scheme-aware
    // slot for it (#0077ad light, rgb(76, 199, 255) dark) — a different
    // blue, so that is a palette decision rather than something to fold in
    // silently here.
    expect(contrast(BLUE, '#FFFFFF')).toBeLessThan(3)
    expect(contrast('#0077ad', '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })
})
