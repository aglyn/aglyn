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

import { fireEvent, render, screen } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import SearchBox from './search-box'

/**
 * Every CSS rule in the document that names one of `element`'s classes, as
 * text, with the `@media` block it sits in (if any) left on it. jsdom never
 * evaluates a media query in `getComputedStyle`, so a per-breakpoint value
 * is read off the stylesheet Emotion wrote instead.
 */
const rulesFor = (element: Element): string[] => {
  const classes = [...element.classList].map((c) => `.${c}`)
  const names = (selector: string) => classes.some((c) => selector.includes(c))
  const out: string[] = []
  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      if (rule instanceof CSSMediaRule) {
        for (const inner of [...rule.cssRules]) {
          if (inner instanceof CSSStyleRule && names(inner.selectorText)) {
            out.push(`@media ${rule.conditionText} { ${inner.cssText} }`)
          }
        }
      } else if (rule instanceof CSSStyleRule && names(rule.selectorText)) {
        out.push(rule.cssText)
      }
    }
  }
  return out
}

describe('Search box (AGL-88)', () => {
  it('is a GET search form to the site search page', () => {
    render(<SearchBox placeholder="Search" />)
    const form = screen.getByRole('search')
    expect(form.tagName).toBe('FORM')
    expect(form.getAttribute('action')).toBe('/search')
    expect(form.getAttribute('method')).toBe('get')
    const field = screen.getByPlaceholderText('Search')
    expect(field.getAttribute('name')).toBe('q')
    expect(screen.getByRole('button', { name: 'search' })).toHaveProperty(
      'type',
      'submit',
    )
  })

  it('applies the element’s style settings to the form (AGL-3917)', () => {
    // The starter header's own setting (default-site.ts `dl_search`): hidden
    // on phones, 220px from `md` up. Dropped, the field showed on a 375px
    // phone and pushed the header's button past the screen's edge.
    render(
      <SearchBox
        {...({ sx: { display: { xs: 'none', md: 'flex' }, width: 220 } } as {})}
      />,
    )
    const form = screen.getByRole('search', { hidden: true })

    expect(form.hasAttribute('sx')).toBe(false)
    expect(getComputedStyle(form).width).toBe('220px')
    const rules = rulesFor(form)
    const atBreakpoint = (minWidth: number, display: string) =>
      rules.some(
        (rule) =>
          new RegExp(`^@media \\(min-width: ?${minWidth}px\\)`).test(rule) &&
          new RegExp(`display: ?${display}`).test(rule),
      )
    expect(atBreakpoint(0, 'none')).toBe(true)
    expect(atBreakpoint(900, 'flex')).toBe(true)
  })

  it('keeps the other props the renderer hands it on the form', () => {
    render(
      <SearchBox
        {...({ className: 'node-class', 'data-node-id': 'dl_search' } as {})}
      />,
    )
    const form = screen.getByRole('search')
    expect(form.classList.contains('node-class')).toBe(true)
    expect(form.getAttribute('data-node-id')).toBe('dl_search')
  })

  it('submits through the client router once hydrated', () => {
    const push = jest.fn()
    render(
      <AppRouterContext.Provider value={{ push } as any}>
        <SearchBox defaultValue="tile" />
      </AppRouterContext.Provider>,
    )
    fireEvent.submit(screen.getByRole('search'))
    expect(push).toHaveBeenCalledWith('/search?q=tile')
  })
})
