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
  HIERARCHY_DEPTH_TINT_MAX_LEVELS,
  HIERARCHY_DEPTH_TINT_STEP,
  hierarchyDepthTintAlpha,
} from './node-tree-view'

/**
 * The hierarchy's depth tint, measured rather than eyeballed (AGL-2486).
 *
 * A screenshot cannot answer this: the tint is one alpha per nesting level
 * and the browser composites them, so what the deepest row's label actually
 * sits on is the PRODUCT of every ancestor's overlay. That composite is what
 * this file reconstructs, against the real console palette, in both schemes.
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

const BLACK: Rgb = [0, 0, 0]

/**
 * What the label at `depth` actually sits on: the panel background with one
 * overlay per ancestor level, exactly as the browser stacks them.
 */
function backgroundAtDepth(
  base: Rgb,
  depth: number,
  alphaAt: (depth: number) => number,
): Rgb {
  let color = base
  for (let level = 1; level <= depth; level += 1) {
    const alpha = alphaAt(level)
    if (alpha > 0) color = composite(BLACK, alpha, color)
  }
  return color
}

/** Text at `depth`, with a translucent ink resolved against its backdrop. */
function measure(
  scheme: { paper: string; text: string },
  depth: number,
  alphaAt: (depth: number) => number,
) {
  const paper = parseColor(scheme.paper)
  const ink = parseColor(scheme.text)
  const background = backgroundAtDepth(paper.rgb, depth, alphaAt)
  const text = composite(ink.rgb, ink.alpha, background)
  return { background, text, ratio: contrastRatio(background, text) }
}

const SCHEMES = {
  light: {
    paper: consoleThemeLight.palette.background.paper,
    text: consoleThemeLight.palette.text.primary,
  },
  dark: {
    paper: consoleThemeDark.palette.background.paper,
    text: consoleThemeDark.palette.text.primary,
  },
}

/** The ramp this replaced, kept so the regression can still be demonstrated. */
const previousAlphaAt = (depth: number) => Math.max(0.2 - 1 / (1 << depth), 0)

/** WCAG AA for body text. */
const AA = 4.5

const DEEPEST_TESTED = 24

describe('hierarchy depth tint contrast (AGL-2486)', () => {
  it.each(['light', 'dark'] as const)(
    'holds AA at every depth in %s mode',
    (mode) => {
      const scheme = SCHEMES[mode]
      for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
        const { ratio } = measure(scheme, depth, hierarchyDepthTintAlpha)
        expect({ mode, depth, ratio: Number(ratio.toFixed(2)) }).toEqual({
          mode,
          depth,
          ratio: expect.any(Number),
        })
        expect(ratio).toBeGreaterThanOrEqual(AA)
      }
    },
  )

  /**
   * The point of the cap. Without a bound on the number of levels the tint
   * is a function of tree depth, and a document can always be one level
   * deeper than whatever was measured.
   */
  it('stops deepening once the ramp is capped', () => {
    const capped = measure(
      SCHEMES.light,
      HIERARCHY_DEPTH_TINT_MAX_LEVELS,
      hierarchyDepthTintAlpha,
    )
    const deeper = measure(SCHEMES.light, 40, hierarchyDepthTintAlpha)
    expect(deeper.background).toEqual(capped.background)
    expect(hierarchyDepthTintAlpha(HIERARCHY_DEPTH_TINT_MAX_LEVELS)).toBe(
      HIERARCHY_DEPTH_TINT_STEP,
    )
    expect(hierarchyDepthTintAlpha(HIERARCHY_DEPTH_TINT_MAX_LEVELS + 1)).toBe(0)
    expect(hierarchyDepthTintAlpha(0)).toBe(0)
  })

  /** Still a usable depth cue — a cap that flattened to nothing would pass. */
  it('still separates one level from the next, up to the cap', () => {
    let previous = Number.POSITIVE_INFINITY
    for (let depth = 1; depth <= HIERARCHY_DEPTH_TINT_MAX_LEVELS; depth += 1) {
      const { background } = measure(
        SCHEMES.light,
        depth,
        hierarchyDepthTintAlpha,
      )
      expect(background[0]).toBeLessThan(previous)
      previous = background[0]
    }
  })

  /**
   * The red this replaced, asserted rather than described: the ramp that
   * shipped fails AA in light mode from the seventh level, and passing this
   * file with the old ramp restored is not possible.
   */
  it('demonstrates the ramp it replaced failing AA in light mode', () => {
    const failing: number[] = []
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      const { ratio } = measure(SCHEMES.light, depth, previousAlphaAt)
      if (ratio < AA) failing.push(depth)
    }
    expect(failing[0]).toBe(7)
    expect(measure(SCHEMES.light, 12, previousAlphaAt).ratio).toBeLessThan(1.5)
    // ...while dark mode was fine throughout, which is why the direction of
    // the tint is unchanged.
    for (let depth = 0; depth <= DEEPEST_TESTED; depth += 1) {
      expect(
        measure(SCHEMES.dark, depth, previousAlphaAt).ratio,
      ).toBeGreaterThanOrEqual(AA)
    }
  })

  /** The numbers quoted in the issue, so they can be re-derived, not trusted. */
  it('reports the measured ratios', () => {
    const rows = (['light', 'dark'] as const).map((mode) => ({
      mode,
      deepest: Number(
        measure(SCHEMES[mode], DEEPEST_TESTED, hierarchyDepthTintAlpha).ratio.toFixed(
          2,
        ),
      ),
      previousDeepest: Number(
        measure(SCHEMES[mode], DEEPEST_TESTED, previousAlphaAt).ratio.toFixed(2),
      ),
    }))
    expect(rows).toEqual([
      { mode: 'light', deepest: 10.15, previousDeepest: 1.01 },
      { mode: 'dark', deepest: 14.84, previousDeepest: 20.94 },
    ])
  })
})
