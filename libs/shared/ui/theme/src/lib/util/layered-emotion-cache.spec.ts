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

import Box from '@mui/material/Box'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { CacheProvider, createEmotionCache } from '../../vendor/emotion'
import { MUI_CSS_LAYER_NAME } from './emotion-cache'
import { createLayeredEmotionCache } from './layered-emotion-cache'

/**
 * AGL-2486 — "what you see is not what you publish".
 *
 * The besigner canvas builds its own emotion cache for the shadow root; the
 * published tenant builds its through `AppRouterCacheProvider`, whose
 * `enableCssLayer` wraps every rule in `@layer mui`. While the canvas cache
 * was plain, the two surfaces resolved a Custom HTML `<style>` block against
 * component and `sx` rules under DIFFERENT cascade rules: unlayered author
 * CSS beats a layered document unconditionally, but only wins on specificity
 * against an unlayered one. Measured on both real surfaces before the fix —
 * a 0-0-1 selector beat a 0-1-0 emotion rule on the published tenant and lost
 * to it on the canvas.
 *
 * These specs read `document.styleSheets`, never rendered markup. Layering
 * changes only the rule TEXT — the emotion class names are byte-identical
 * either way — so a spec asserting on markup passes against the broken build.
 */

/**
 * Every rule in the sheet, tagged with the layer it sits in (null = none).
 *
 * Two traps, both of which produce a GREEN suite against a broken build:
 *
 *  1. A `CSSLayerBlockRule` is a GROUPING rule — its declarations live in
 *     `cssRules`. A walk that treats it as a leaf, or that returns as soon as
 *     it sees `cssRules`, reports an empty layer and finds nothing to fail on.
 *  2. The layer's name is read from `cssText`, NOT from `rule.name`. The jsdom
 *     that ships inside `jest-environment-jsdom` builds a real
 *     `CSSLayerBlockRule` whose `name` is `undefined` (the standalone jsdom at
 *     the repo root returns `'mui'` for the same input). Keying off `.name`
 *     therefore sends every layered rule down the "some other grouping rule"
 *     branch, which inherits the ENCLOSING layer — null — and the layered and
 *     unlayered builds become indistinguishable.
 */
function collectRules(sheet: CSSStyleSheet) {
  const found: { selector: string; layer: string | null; text: string }[] = []
  const layerNameOf = (rule: CSSRule) =>
    /^@layer\s+([^{]*)\{/.exec(rule.cssText)?.[1].trim() || '<anonymous>'
  const walk = (rules: CSSRuleList, layer: string | null) => {
    for (const rule of Array.from(rules)) {
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested && /^@layer[\s{]/.test(rule.cssText)) {
        walk(nested, layerNameOf(rule))
      } else if (nested && nested.length) {
        walk(nested, layer)
      } else {
        found.push({
          selector: (rule as CSSStyleRule).selectorText ?? '',
          layer,
          text: rule.cssText,
        })
      }
    }
  }
  walk(sheet.cssRules, null)
  return found
}

/** Renders a coloured Box under `cache` and reports how its rules landed. */
function renderUnder(cache: ReturnType<typeof createEmotionCache>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(
    createElement(
      CacheProvider,
      { value: cache },
      createElement(Box, { sx: { color: 'rgb(1, 2, 3)' } }, 'styled'),
    ),
    { container },
  )
  const rules = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return collectRules(sheet as CSSStyleSheet)
    } catch {
      return []
    }
  })
  const ours = rules.filter((rule) => rule.text.includes('rgb(1, 2, 3)'))
  return {
    ours,
    layered: ours.filter((rule) => rule.layer === MUI_CSS_LAYER_NAME),
    unlayered: ours.filter((rule) => rule.layer === null),
  }
}

describe('createLayeredEmotionCache (AGL-2486)', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((tag) => tag.remove())
    document.body.innerHTML = ''
  })

  it('puts every rule it inserts inside `@layer mui`, as the published page does', () => {
    const result = renderUnder(createLayeredEmotionCache({ key: 'agltest' }))
    expect(result.ours.length).toBeGreaterThan(0)
    expect(result.unlayered).toHaveLength(0)
    expect(result.layered).toHaveLength(result.ours.length)
  })

  it('leaves a plain cache unlayered — the canvas behaviour being corrected', () => {
    // The other half of the comparison, so the assertion above is measuring
    // the wrapper rather than something jsdom does to every stylesheet.
    const result = renderUnder(createEmotionCache({ key: 'aglplain' }))
    expect(result.ours.length).toBeGreaterThan(0)
    expect(result.layered).toHaveLength(0)
  })

  it('does not wrap a bare `@layer` ordering statement in a block', () => {
    // `@layer a, b;` DECLARES an order. Wrapped in `@layer mui { … }` it stops
    // doing that and silently declares an empty nested layer instead, so the
    // order it was there to establish is lost. MUI guards this and so must any
    // replica of MUI's patch.
    const cache = createLayeredEmotionCache({ key: 'aglorder' })
    const serialized = { name: 'ordering', styles: '@layer first, second;' }
    cache.sheet.insert = () => undefined
    cache.insert('', serialized as never, cache.sheet, false)
    expect(serialized.styles).toBe('@layer first, second;')
  })

  it('wraps the rules it does layer with the layer name MUI itself emits', () => {
    const cache = createLayeredEmotionCache({ key: 'aglname' })
    const serialized = { name: 'x', styles: '.probe{color:red}' }
    cache.sheet.insert = () => undefined
    cache.insert('', serialized as never, cache.sheet, false)
    expect(serialized.styles).toBe(
      `@layer ${MUI_CSS_LAYER_NAME} {.probe{color:red}}`,
    )
  })
})
