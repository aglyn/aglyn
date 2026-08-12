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

import * as Aglyn from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import Button, { schema } from './button'

/** The besigner canvas / preview: navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/**
 * AGL-1426. AGL-1347 split appearance from semantics on `muiScreenLink`, but
 * the 12 `a[role="button"]` chips on `aglyn.com/` are `muiButton` nodes —
 * Button's own link mode (AGL-139) routes through `AppLink`, and MUI's
 * `ButtonBase` stamps `role="button"` onto any non-`<button>` root, so the
 * button LOOK dragged the button ROLE onto twelve anchors that only navigate.
 */
describe('Button link mode announces as a link when asked (AGL-1426)', () => {
  it('premise: the link mode announces as a BUTTON with nothing selected', () => {
    // What ships today, and what every already-authored node must keep
    // doing. If this ever goes green on its own, the defect moved.
    render(<Button href="https://docs.aglyn.com">{'Documentation home'}</Button>)
    const chip = screen.getByRole('button', { name: 'Documentation home' })
    expect(chip.tagName).toBe('A')
    expect(chip.getAttribute('role')).toBe('button')
  })

  it('gives a navigating chip the LINK role, not the button role', () => {
    render(
      <Button renderAs="linkButton" href="https://docs.aglyn.com">
        {'Documentation home'}
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Documentation home' })
    expect(link.tagName).toBe('A')
    // `role="button"` is the accessibility defect itself: `ButtonBase` merges
    // the caller's props AFTER its own, so an explicit `undefined` clears it.
    expect(link.getAttribute('role')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the button styling it was asked for on that link', () => {
    // Identical pixels is the whole point — the chips are a deliberate pill
    // row, so fixing the role must not touch fill, border, padding or radius.
    const { container } = render(
      <Button
        renderAs="linkButton"
        href="https://linkedin.com/company/aglyn"
        variant="outlined"
        size="small"
      >
        {'LinkedIn'}
      </Button>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.className).toMatch(/MuiButton-outlined/)
    expect(link.className).toMatch(/MuiButton-sizeSmall/)
  })

  it('shows the same pill on the canvas, and still not as a button', () => {
    // Suppressed navigation must mirror the live shape or the besigner lies
    // about which element the page ships.
    renderEditor(
      <Button renderAs="linkButton" href="mailto:info@aglyn.com" variant="contained">
        {'info@aglyn.com'}
      </Button>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    const placeholder = screen.getByText('info@aglyn.com')
    expect(placeholder.tagName).toBe('SPAN')
    expect(placeholder.className).toMatch(/MuiButton-contained/)
  })
})

/**
 * `muiButton` is the most-used element on the site. Nothing already authored
 * may move, so the new value has to be strictly additive.
 */
describe('Button leaves every already-authored node alone (AGL-1426)', () => {
  const markup = (ui: React.ReactElement) =>
    (render(ui).container.firstElementChild as HTMLElement).outerHTML

  it('renders an unset link-mode node exactly as before', () => {
    const { container } = render(
      <Button href="https://docs.aglyn.com/building-sites" variant="outlined">
        {'Building sites'}
      </Button>,
    )
    const chip = container.querySelector('a') as HTMLElement
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.className).toMatch(/MuiButton-outlined/)
    expect(chip.getAttribute('href')).toBe(
      'https://docs.aglyn.com/building-sites',
    )
  })

  it('renders `""` and a CLEARED null byte-identically to unset', () => {
    // An `''` option value never persists — the attributes form strips it
    // (AGL-1191) and `dropClearedProps` strips whatever survives (AGL-1226).
    // Both must therefore land on the same markup as an absent key, which is
    // why Button is the option's value and `linkButton` is the real sentinel.
    const unset = markup(<Button href="/pricing">{'Start free'}</Button>)
    expect(
      markup(
        <Button renderAs={'' as any} href="/pricing">
          {'Start free'}
        </Button>,
      ),
    ).toBe(unset)
    expect(
      markup(
        <Button renderAs={null as any} href="/pricing">
          {'Start free'}
        </Button>,
      ),
    ).toBe(unset)
  })

  it('leaves a genuine button — no link target — a real <button>', () => {
    const { container } = render(<Button variant="contained">{'Submit'}</Button>)
    const button = screen.getByRole('button', { name: 'Submit' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('role')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

  it('leaves a genuine button alone even in the styled-link mode', () => {
    // There is no link branch to fix without an href, so the mode is inert
    // rather than turning a real button into a non-interactive span.
    render(
      <Button renderAs="linkButton" variant="contained">
        {'Submit'}
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Submit' }).tagName).toBe(
      'BUTTON',
    )
  })

  it('never leaks `renderAs` onto the DOM', () => {
    const { container } = render(
      <Button renderAs="linkButton" href="/pricing">
        {'Start free'}
      </Button>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.getAttribute('renderas')).toBeNull()
    expect(link.getAttribute('render-as')).toBeNull()
  })
})

describe('Button attributes panel offers the choice (AGL-1426)', () => {
  const by = (name: string) =>
    schema.attributes.find((a: any) => a.name === name) as any

  it('defaults to Button and offers the styled link as a real sentinel', () => {
    const field = by('renderAs')
    expect(field).toBeTruthy()
    expect(field.options?.[0]).toMatchObject({ value: '', label: 'Button' })
    // No third value: a plain Text link is `muiScreenLink`'s job, and adding
    // it here would drop the button-only props on a component whose entire
    // purpose is button styling.
    expect(field.options?.map((o: any) => o.value)).toEqual(['', 'linkButton'])
  })

  it('keeps the styling controls live in BOTH modes', () => {
    // Unlike Screen Link, Button has no text-link mode — both values wear the
    // button styling, so nothing here may be conditioned away.
    for (const name of ['size', 'fullWidth', 'variant']) {
      expect(by(name)).toBeTruthy()
      expect(by(name).condition).toBeUndefined()
    }
  })
})
