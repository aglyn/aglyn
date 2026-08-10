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

import { render } from '@testing-library/react'

/**
 * Every sink Screen Link can render into, replaced by a capture so the
 * assertions are about WHAT IS PASSED rather than about whether the render
 * happened to survive. A `null` that MUI tolerates today is still the bug —
 * MUI's tolerance varies by prop (`color` throws, `fullWidth` does not), so
 * "it didn't crash" is not the property under test.
 */
const mockCaptured: Array<{ el: string; props: Record<string, any> }> = []

// A function DECLARATION, not a const: `jest.mock` factories are hoisted
// above the module body, so an arrow assigned to a const is still in its
// temporal dead zone when the factories run.
function mockSink(el: string) {
  const React = require('react')
  return React.forwardRef((props: Record<string, any>, _ref: unknown) => {
    mockCaptured.push({ el, props })
    return null
  })
}

jest.mock('@mui/material/Button', () => ({
  __esModule: true,
  default: mockSink('Button'),
}))
jest.mock('@mui/material/Link', () => ({
  __esModule: true,
  default: mockSink('Link'),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: mockSink('AppLink'),
}))

import ScreenLink from './screen-link'

/** Props handed to whichever element the last render resolved to. */
const passed = () => {
  expect(mockCaptured.length).toBe(1)
  return mockCaptured[0].props
}

beforeEach(() => {
  mockCaptured.length = 0
})

/**
 * Screen Link is the site's most-used element (70–77 nodes per page) and it
 * spreads author props straight into MUI. A CLEARED attribute persists as
 * `null`, React substitutes a default only for `undefined`, so the null
 * travels into MUI and `capitalize(null)` throws DURING SSR — the whole page
 * 500s. That is the AGL-1226 shape, which `button.tsx` already guards
 * against and this component did not.
 */
describe('ScreenLink drops cleared props before MUI sees them', () => {
  describe.each([
    ['button mode, unresolved href', {}, 'Button'],
    ['button mode, resolved href', { href: '/pricing' }, 'AppLink'],
    ['link mode, unresolved href', { renderAs: 'link' }, 'Link'],
    ['link mode, resolved href', { renderAs: 'link', href: '/pricing' }, 'AppLink'],
  ])('%s', (_name, base: Record<string, any>, expectedEl) => {
    it(`renders ${expectedEl} without the cleared color`, () => {
      render(
        <ScreenLink {...base} color={null as any}>
          {'Go'}
        </ScreenLink>,
      )
      expect(mockCaptured[0].el).toBe(expectedEl)
      // Not `toBeUndefined()` — the key must be ABSENT, because an explicit
      // `color: undefined` in the spread still overrides a default that a
      // parent or MUI itself would otherwise supply.
      expect('color' in passed()).toBe(false)
    })
  })

  it('drops every cleared prop, including the ones forwarded explicitly', () => {
    // `variant`, `size` and `fullWidth` are destructured out and passed as
    // named attributes rather than riding in the spread, so a guard applied
    // only to the rest bag would leave exactly these three exposed.
    render(
      <ScreenLink
        color={null as any}
        variant={null as any}
        size={null as any}
        fullWidth={null as any}
      >
        {'Go'}
      </ScreenLink>,
    )
    const props = passed()
    // Asserted on the VALUE, because these three are forwarded as named JSX
    // attributes: the key survives as `undefined` even once the guard runs,
    // and MUI's `resolveProps` swaps an undefined for the component default.
    // What must never survive is the null itself, which is what throws.
    for (const key of ['color', 'variant', 'size', 'fullWidth']) {
      expect(`${key}=${String(props[key])}`).toBe(`${key}=undefined`)
    }
    // `color` rides in the spread instead, so there the key is gone outright.
    expect('color' in props).toBe(false)
  })

  it('treats an empty string as cleared too', () => {
    // Every SELECT in the schema offers `{ value: '', label: 'Default' }`, so
    // choosing "Default" persists `''`. `capitalize('')` does not throw, but
    // it yields a junk `colorundefined`-shaped class instead of MUI's own
    // default, so `''` means cleared here exactly as `null` does.
    render(<ScreenLink color={'' as any}>{'Go'}</ScreenLink>)
    expect('color' in passed()).toBe(false)
  })

  // ---- positive controls: the guard must not become a prop shredder ----

  it('passes ordinary author values through untouched', () => {
    render(
      <ScreenLink
        color="secondary"
        variant="contained"
        size="large"
        id="cta"
        className="hero-cta"
      >
        {'Go'}
      </ScreenLink>,
    )
    expect(passed()).toMatchObject({
      color: 'secondary',
      variant: 'contained',
      size: 'large',
      id: 'cta',
      className: 'hero-cta',
    })
  })

  it('does not mistake an explicitly-set falsy value for a cleared one', () => {
    // The whole risk of this kind of guard: `0` and `false` are real author
    // choices, not absences. `fullWidth={false}` is a named attribute and
    // `tabIndex={0}` rides in the spread, so both paths are covered.
    render(
      <ScreenLink fullWidth={false} tabIndex={0} disabled={false}>
        {'Go'}
      </ScreenLink>,
    )
    const props = passed()
    expect(props.fullWidth).toBe(false)
    expect(props.tabIndex).toBe(0)
    expect(props.disabled).toBe(false)
  })
})
