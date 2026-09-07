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
 * AGL-2643 — the overlay's tints survive a theme WITHOUT CSS variables.
 *
 * A published site renders under a plain `createTheme()`, which carries no
 * `*Channel` triplets; the console renders under one with
 * `cssVariables: true`, which does. Reading the channel from
 * `(theme.vars || theme)` and interpolating it into `rgba(… / 0.48)` spells
 * `rgba(undefined / 0.48)` on the tenant — an invalid declaration the browser
 * drops, so every published page lost its backdrop tint while the console
 * kept it. The 2026-09-07 marketing-site audit found that string in the
 * emitted CSS of all 105 fetched pages.
 *
 * This asserts on the RULE TEXT emotion emits, not on computed style: a
 * cascade reports an empty `backgroundColor` for the invalid value, and a
 * markup assertion cannot see the declaration at all.
 */

import { createTheme, ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import LoadingModal from './loading-modal'

/**
 * A color CSS accepts: the literal `rgb(a)(N, N, N[, A])` a plain theme
 * composes, or the channel form `rgba(var(--…[, N N N]) / A)` a CSS-variables
 * theme keeps bound to its variable.
 */
const VALID_RGB =
  /^rgba?\((?:\d{1,3}(?:,\s*\d{1,3}){2}(?:,\s*[\d.]+)?|var\(--[\w-]+(?:,\s*\d{1,3}(?:\s+\d{1,3}){2})?\)\s*\/\s*[\d.]+)\)$/

/**
 * The `background-color` emotion emitted for `selector` nested under the
 * overlay's own class. Emotion inserts through `insertRule` here, so the
 * style tags carry no text and the rule is read back from the sheet; jsdom's
 * CSSOM stores a declaration verbatim, unvalidated, which is what lets an
 * invalid value be seen at all.
 */
function emittedBackground(selector: string): string {
  const root = document.querySelector('.MuiModal-root')
  const own = Array.from(root?.classList ?? []).find((name) =>
    name.startsWith('css-'),
  )
  expect(own).toBeDefined()
  const rule = Array.from(document.head.querySelectorAll('style'))
    .flatMap((tag) => Array.from(tag.sheet?.cssRules ?? []))
    .find(
      (candidate): candidate is CSSStyleRule =>
        (candidate as CSSStyleRule).selectorText === `.${own} ${selector}`,
    )
  expect(rule).toBeDefined()
  return (rule as CSSStyleRule).style.getPropertyValue('background-color')
}

const SURFACES = ['.MuiBackdrop-root', '.progress-bar-top'] as const

describe('LoadingModal backdrop tint', () => {
  it('composes a literal rgba under a theme without CSS variables', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <LoadingModal open />
      </ThemeProvider>,
    )
    for (const selector of SURFACES) {
      const value = emittedBackground(selector)
      expect(value).not.toContain('undefined')
      expect(value).toMatch(VALID_RGB)
    }
    expect(emittedBackground('.MuiBackdrop-root')).toBe(
      'rgba(255, 255, 255, 0.48)',
    )
  })

  it('keeps the channel variable under a theme with CSS variables', () => {
    render(
      <ThemeProvider theme={createTheme({ cssVariables: true })}>
        <LoadingModal open />
      </ThemeProvider>,
    )
    for (const selector of SURFACES) {
      const value = emittedBackground(selector)
      expect(value).not.toContain('undefined')
      expect(value).toMatch(VALID_RGB)
    }
    expect(emittedBackground('.MuiBackdrop-root')).toContain(
      'var(--mui-palette-background-paperChannel',
    )
  })
})
