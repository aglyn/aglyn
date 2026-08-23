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

import { consoleThemeDark, consoleThemeLight } from '@aglyn/shared-ui-theme'

import {
  HIERARCHY_GUIDE_ALPHA,
  HIERARCHY_INDENT_STEP,
  hierarchyDepthStyles,
  hierarchyGuideCount,
  hierarchyGutterWidth,
} from './node-tree-view'

/**
 * The hierarchy's depth cue, measured rather than eyeballed (AGL-2486).
 *
 * A screenshot cannot answer the question the issue asks. The complaint was
 * that each nesting level darkened the row until the label met its
 * background, and whether that happens is a property of how the overlays
 * COMPOSITE over N levels — arithmetic a person cannot do by looking, and
 * which only shows itself on trees deeper than the one on screen.
 *
 * So this file reconstructs the composite against the real console palette
 * in both schemes, and the first thing it asserts is that there is no
 * composite left to do.
 */

type Rgb = [number, number, number]

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` — everything the palette uses. */
function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const input = String(value).trim()
  if (input.startsWith('#')) {
    const hex = input.slice(1)
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    const rgb: Rgb = [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
    const alpha = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1
    return { rgb, alpha }
  }
  const parts = input
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(/[,/\s]+/)
    .filter(Boolean)
    .map(Number)
  return {
    rgb: [parts[0], parts[1], parts[2]],
    alpha: parts.length > 3 ? parts[3] : 1,
  }
}

/** `source` at `alpha` painted over `backdrop`. */
function composite(source: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return [0, 1, 2].map(
    (i) => source[i] * alpha + backdrop[i] * (1 - alpha),
  ) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const round = (n: number) => Number(n.toFixed(2))

const BLACK: Rgb = [0, 0, 0]

interface Scheme {
  /** The panel the tree is drawn on. */
  surfaces: { paper: Rgb; panel: Rgb }
  /** The label's ink, alpha included. */
  ink: { rgb: Rgb; alpha: number }
  /** Ink the guides are drawn from — same colour, low alpha. */
  guide: Rgb
  /** The active-branch guide. */
  activeGuide: Rgb
}

function schemeOf(theme: any): Scheme {
  const ink = parseColor(theme.palette.text.primary)
  return {
    surfaces: {
      paper: parseColor(theme.palette.background.paper).rgb,
      panel: parseColor(theme.palette.surface.main).rgb,
    },
    ink,
    guide: ink.rgb,
    activeGuide: parseColor(theme.palette.secondary.main).rgb,
  }
}

const SCHEMES = {
  light: schemeOf(consoleThemeLight),
  dark: schemeOf(consoleThemeDark),
}

/**
 * Every background overlay `hierarchyDepthStyles` paints on the row at
 * `depth`, as alphas — read out of the style object the component actually
 * uses, not out of a description of it.
 *
 * A depth cue that darkens the row shows up here as a non-empty list, and
 * the composite of that list is precisely what made deep rows unreadable.
 */
function rowBackgroundOverlays(depth: number): number[] {
  const styles: any = hierarchyDepthStyles(depth, {
    guide: 'rgba(0 0 0 / 0.45)',
    activeGuide: '#e040fb',
  })
  const alphas: number[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        walk(value)
        continue
      }
      // `backgroundImage` is the gutter gradient and paints beside the
      // label, in the row's indent; `backgroundColor`/`background` paint
      // BEHIND it, and those are the ones that stack toward the ink.
      if (key === 'backgroundColor' || key === 'background') {
        alphas.push(parseColor(String(value)).alpha)
      }
    }
  }
  walk(styles)
  return alphas
}

/**
 * Every gutter paint `hierarchyDepthStyles` emits at `depth`, by property
 * name. The depth cue lives entirely in these.
 */
function gutterPaint(depth: number) {
  const styles: any = hierarchyDepthStyles(depth, {
    guide: 'rgba(0 0 0 / 0.45)',
    activeGuide: '#e040fb',
  })
  const painted: any[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.backgroundImage === 'string') painted.push(node)
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value)
    }
  }
  walk(styles)
  return painted
}

/**
 * What the label at `depth` actually sits on, and how it reads against it.
 * `overlays` is applied once per nesting level, exactly as a stacking cue
 * would be.
 */
function measure(scheme: Scheme, surface: Rgb, depth: number, overlays: number[]) {
  let background = surface
  for (let level = 1; level <= depth; level += 1) {
    for (const alpha of overlays) {
      if (alpha > 0) background = composite(BLACK, alpha, background)
    }
  }
  const text = composite(scheme.ink.rgb, scheme.ink.alpha, background)
  return { background, text, ratio: contrastRatio(background, text) }
}

/** WCAG AA for body text. */
const AA = 4.5
/** WCAG 1.4.11 for a non-text cue. */
const AA_NON_TEXT = 3

/**
 * Deeper than any real document, on purpose. The point of the fix is that
 * depth is no longer a variable the contrast depends on, and a bound chosen
 * to match the deepest tree anyone has built would be testing the documents
 * rather than the rule.
 */
const DEEPEST_TESTED = 40

/** The ramps this replaced, kept so the regression stays demonstrable. */
const originalRamp = (depth: number) => Math.max(0.2 - 1 / (1 << depth), 0)
const cappedRamp = (depth: number) => (depth >= 1 && depth <= 5 ? 0.05 : 0)

function measureRamp(scheme: Scheme, depth: number, rampAt: (d: number) => number) {
  let background = scheme.surfaces.paper
  for (let level = 1; level <= depth; level += 1) {
    const alpha = rampAt(level)
    if (alpha > 0) background = composite(BLACK, alpha, background)
  }
  const text = composite(scheme.ink.rgb, scheme.ink.alpha, background)
  return { background, ratio: contrastRatio(background, text) }
}

const MODES = ['light', 'dark'] as const

describe('hierarchy depth cue contrast (AGL-2486)', () => {
  /**
   * The whole fix in one assertion. Everything below measures a consequence
   * of this; if a background colour ever comes back the ratios go with it.
   */
  it('paints nothing behind the label at any depth', () => {
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      expect({ depth, overlays: rowBackgroundOverlays(depth) }).toEqual({
        depth,
        overlays: [],
      })
    }
    // ...and the cue is not simply absent, which would satisfy every
    // assertion above by drawing nothing at all. Read by PROPERTY NAME, not
    // by searching the serialised object: a gradient parked under a
    // misspelled key is still a string containing the word.
    for (const depth of [2, 8, 40]) {
      const painted = gutterPaint(depth)
      expect({ depth, gradients: painted.length }).toEqual({
        depth,
        // The row's own guides, and the accent set for the branch holding
        // the selection.
        gradients: 2,
      })
      for (const paint of painted) {
        expect(paint.backgroundImage).toMatch(/^repeating-linear-gradient\(/)
        expect(paint.backgroundSize).toBe(`${hierarchyGutterWidth(depth)}px 100%`)
        expect(paint.backgroundRepeat).toBe('no-repeat')
      }
    }
    // A root-level row has no ancestors to mark, so it paints nothing.
    expect(gutterPaint(1)).toEqual([])
  })

  it.each(MODES)('holds the SAME ratio at every depth in %s mode', (mode) => {
    const scheme = SCHEMES[mode]
    for (const [name, surface] of Object.entries(scheme.surfaces)) {
      const ratios = new Set<number>()
      for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
        const { ratio } = measure(
          scheme,
          surface,
          depth,
          rowBackgroundOverlays(depth),
        )
        expect({ mode, name, depth, aa: ratio >= AA }).toEqual({
          mode,
          name,
          depth,
          aa: true,
        })
        ratios.add(round(ratio))
      }
      // One value across 41 levels: depth is no longer an input. This is the
      // claim a cap could never make — past a cap the ratio is constant too,
      // but only because the CUE has stopped, and `readsAsClearlyAtDepth`
      // below is the half that a cap fails.
      expect({ mode, name, distinctRatios: ratios.size }).toEqual({
        mode,
        name,
        distinctRatios: 1,
      })
    }
  })

  it.each(MODES)('reads as clearly at depth 8 as at depth 1 in %s mode', (mode) => {
    // The cue is the COUNT of guides, so every level is distinguishable from
    // every other one, with no ceiling. A capped tint fails exactly here:
    // its levels stop differing once the cap is reached.
    const counts = []
    for (let depth = 1; depth <= DEEPEST_TESTED; depth += 1) {
      counts.push(hierarchyGuideCount(depth))
      expect(hierarchyGutterWidth(depth)).toBe(
        hierarchyGuideCount(depth) * HIERARCHY_INDENT_STEP,
      )
    }
    expect(new Set(counts).size).toBe(counts.length)
    expect(hierarchyGuideCount(8) - hierarchyGuideCount(7)).toBe(
      hierarchyGuideCount(2) - hierarchyGuideCount(1),
    )

    // And a guide is legible against the surface it is drawn on — a cue you
    // cannot see is not a cue, however evenly it is spaced.
    const scheme = SCHEMES[mode]
    for (const [name, surface] of Object.entries(scheme.surfaces)) {
      const guide = composite(scheme.guide, HIERARCHY_GUIDE_ALPHA, surface)
      const active = composite(scheme.activeGuide, 1, surface)
      expect({
        mode,
        name,
        guide: guide && contrastRatio(guide, surface) >= AA_NON_TEXT,
        active: contrastRatio(active, surface) >= AA_NON_TEXT,
      }).toEqual({ mode, name, guide: true, active: true })
    }
  })

  /**
   * The reds this replaced, asserted rather than described. Both previous
   * shapes are reconstructed here, so neither can be reintroduced as an
   * improvement without this file objecting.
   */
  it('demonstrates both previous ramps failing what the fix now holds', () => {
    // 1. The ramp that shipped: unbounded, so light mode walked into the ink.
    const failing: number[] = []
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      if (measureRamp(SCHEMES.light, depth, originalRamp).ratio < AA) {
        failing.push(depth)
      }
    }
    expect(failing[0]).toBe(7)
    expect(round(measureRamp(SCHEMES.light, 12, originalRamp).ratio)).toBe(1.33)

    // Dark mode was fine throughout, which is the asymmetry that makes a
    // single tint direction unfixable rather than mistuned.
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      expect(
        measureRamp(SCHEMES.dark, depth, originalRamp).ratio,
      ).toBeGreaterThanOrEqual(AA)
    }

    // 2. The capped ramp: readable at every depth, and blind past level 5.
    // It passes the contrast bar and fails the cue bar, which is why the
    // two are separate tests.
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      expect(
        measureRamp(SCHEMES.light, depth, cappedRamp).ratio,
      ).toBeGreaterThanOrEqual(AA)
    }
    const cappedBackgrounds = new Set(
      [5, 6, 7, 8, 16, 40].map((depth) =>
        measureRamp(SCHEMES.light, depth, cappedRamp).background.join(),
      ),
    )
    expect(cappedBackgrounds.size).toBe(1)
  })

  /** The numbers quoted on the issue, so they can be re-derived, not trusted. */
  it('reports the measured ratios', () => {
    const rows = MODES.flatMap((mode) => {
      const scheme = SCHEMES[mode]
      return Object.entries(scheme.surfaces).map(([surface, rgb]) => ({
        mode,
        surface,
        // Identical at depth 1 and depth 40 — that is the report.
        depth1: round(measure(scheme, rgb, 1, rowBackgroundOverlays(1)).ratio),
        depth40: round(
          measure(scheme, rgb, 40, rowBackgroundOverlays(40)).ratio,
        ),
        guide: round(
          contrastRatio(
            composite(scheme.guide, HIERARCHY_GUIDE_ALPHA, rgb),
            rgb,
          ),
        ),
        activeGuide: round(contrastRatio(scheme.activeGuide, rgb)),
        wasDepth12: round(measureRamp(scheme, 12, originalRamp).ratio),
      }))
    })
    expect(rows).toEqual([
      {
        mode: 'light',
        surface: 'paper',
        depth1: 16.07,
        depth40: 16.07,
        guide: 3.35,
        activeGuide: 3.34,
        wasDepth12: 1.33,
      },
      {
        mode: 'light',
        surface: 'panel',
        depth1: 15.39,
        depth40: 15.39,
        guide: 3.32,
        activeGuide: 3.16,
        wasDepth12: 1.33,
      },
      {
        mode: 'dark',
        surface: 'paper',
        depth1: 12.62,
        depth40: 12.62,
        guide: 3.89,
        activeGuide: 3.78,
        wasDepth12: 20.1,
      },
      {
        mode: 'dark',
        surface: 'panel',
        depth1: 14.7,
        depth40: 14.7,
        guide: 4.19,
        activeGuide: 4.41,
        wasDepth12: 20.1,
      },
    ])
  })
})
