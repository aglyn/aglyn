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
 * The screens empty state takes the page's surface, in either scheme
 * (AGL-3147).
 *
 * The console is served through a CSS-variables theme, where `theme.palette`
 * is bound to the DEFAULT color scheme and only the `--mui-palette-*`
 * variables follow a switch to dark. The empty cell composed its wash from
 * `theme.palette.background.default`, so it painted the LIGHT scheme's
 * `#F5F5F5` at 38% inside the dark console — a pale block under a dark card,
 * which is what a reader sees as "this table belongs to another page".
 *
 * Asserted on the rule text emotion emits rather than on computed style:
 * jsdom performs no cascade over CSS variables, so the value that matters —
 * whether the declaration stays BOUND to the variable or froze a literal — is
 * only visible in the declaration itself.
 */

import { consoleThemeCssVar, createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render } from '@testing-library/react'
import { ScreensHierarchyTableComponent } from '../components/screens-hierarchy-table.component'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

const renderEmpty = (theme: Parameters<typeof ThemeProvider>[0]['theme']) =>
  render(
    <ThemeProvider theme={theme}>
      <ScreensHierarchyTableComponent
        screens={[]}
        onMoveScreen={() => undefined}
        renderRowActions={() => null}
      />
    </ThemeProvider>,
  )

/** Every style rule in the document, with grouping rules (layers, media) flattened. */
function allStyleRules(): CSSStyleRule[] {
  const flatten = (rules: CSSRule[]): CSSStyleRule[] =>
    rules.flatMap((rule) => {
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested) return flatten(Array.from(nested))
      return (rule as CSSStyleRule).selectorText ? [rule as CSSStyleRule] : []
    })
  return flatten(
    Array.from(document.head.querySelectorAll('style')).flatMap((tag) =>
      Array.from(tag.sheet?.cssRules ?? []),
    ),
  )
}

/** The `background-color` emotion emitted for the cell the empty state sits in. */
function emptyCellBackground(container: HTMLElement): string {
  const cell = container.querySelector(
    'td[colspan]',
  ) as HTMLTableCellElement | null
  expect(cell).toBeTruthy()
  const own = Array.from(cell?.classList ?? []).filter((name) =>
    name.startsWith('css-'),
  )
  expect(own.length).toBeGreaterThan(0)
  const rules = allStyleRules().filter((rule) =>
    own.some((name) => rule.selectorText === `.${name}`),
  )
  const declared = rules
    .map((rule) => rule.style.getPropertyValue('background-color'))
    .filter(Boolean)
  expect(declared.length).toBeGreaterThan(0)
  return declared[declared.length - 1]
}

describe('the screens empty state paints the page surface (AGL-3147)', () => {
  it('stays bound to the scheme variable under the console theme', () => {
    const { container } = renderEmpty(consoleThemeCssVar)
    const background = emptyCellBackground(container)

    // The channel variable is what follows a switch to dark; a literal cannot.
    expect(background).toContain('var(--mui-palette-background-defaultChannel')
    expect(background).not.toMatch(/\b245,\s*245,\s*245\b/)
  })

  it('composes a literal wash under a theme without CSS variables', () => {
    const { container } = renderEmpty(
      createTheme({
        palette: { mode: 'dark', background: { default: '#161c21' } },
      }),
    )
    const background = emptyCellBackground(container)

    expect(background).not.toContain('undefined')
    expect(background).toBe('rgba(22, 28, 33, 0.38)')
  })
})
