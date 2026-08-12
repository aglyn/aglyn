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
import ScreenLink, { schema } from './screen-link'

/** The besigner canvas / preview: navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

describe('ScreenLink renderAs (AGL-1195)', () => {
  it('is a button by default, on the live site and on the canvas', () => {
    render(<ScreenLink href="/pricing">{'Pricing'}</ScreenLink>)
    expect(screen.getByRole('button', { name: 'Pricing' })).toBeTruthy()

    renderEditor(<ScreenLink>{'Docs'}</ScreenLink>)
    expect(screen.getByRole('button', { name: 'Docs' })).toBeTruthy()
  })

  it('renders navigation as a real link when asked, not a button', () => {
    render(
      <ScreenLink renderAs="link" href="/pricing">
        {'Pricing'}
      </ScreenLink>,
    )
    const link = screen.getByRole('link', { name: 'Pricing' })
    expect(link.tagName).toBe('A')
    // A footer link that still reads as a button to assistive tech is the
    // whole bug — there must be no button in the tree.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not forward button-only props onto the link', () => {
    // `variant` means the TYPOGRAPHY variant on MUI's Link, so forwarding
    // "contained" would silently produce an unstyled element.
    const { container } = render(
      <ScreenLink
        renderAs="link"
        href="/pricing"
        variant="contained"
        size="large"
        fullWidth
      >
        {'Pricing'}
      </ScreenLink>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.className).not.toMatch(/MuiButton/)
    expect(link.className).toMatch(/MuiLink/)
  })

  it('keeps the canvas honest about which element will ship', () => {
    // Suppressed navigation must mirror the live shape, or the besigner
    // shows a button for something that renders as a link in production.
    renderEditor(<ScreenLink renderAs="link">{'Careers'}</ScreenLink>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Careers').className).toMatch(/MuiLink/)
  })

  it('offers all three modes as real, persistable values', () => {
    const field = schema.attributes.find((a: any) => a.name === 'renderAs')
    expect(field).toBeTruthy()
    // `'button'`, not `''` (AGL-1453). Button is a real choice, and it was
    // the one an author could not make: `''` is stripped before the write
    // (AGL-1191), so a link switched to Text link reverted on save and
    // stayed a text link. 213 of the 326 Screen Links in the corpus are in
    // that mode, and the dropdown offered them no way back.
    expect((field as any).options?.[0]).toMatchObject({
      value: 'button',
      label: 'Button',
    })
    expect((field as any).options?.map((o: any) => o.value)).toEqual([
      'button',
      'link',
      'linkButton',
    ])
  })

  it('renders the `button` sentinel exactly as an unset value does', () => {
    // The positive control for the swap. `renderAs` never reaches MUI — it
    // is destructured out and read only as `=== 'link'` / `=== 'linkButton'`
    // — so a node that now STORES `'button'` must paint what a node storing
    // nothing painted. `''` and `null` stay covered because both remain
    // reachable by paste and by the field's ✕.
    const markup = (ui: React.ReactElement) => {
      const { container, unmount } = render(ui)
      const html = container.innerHTML
      unmount()
      return html
    }
    const unset = markup(<ScreenLink href="/pricing">{'Pricing'}</ScreenLink>)
    for (const value of ['button', '', null]) {
      expect(
        markup(
          <ScreenLink renderAs={value as any} href="/pricing">
            {'Pricing'}
          </ScreenLink>,
        ),
      ).toBe(unset)
    }
  })

  it('keeps the button-styling controls visible for the stored sentinel', () => {
    // `BUTTON_STYLED` inverts `is: 'link'`, so a stored `'button'` has to
    // satisfy it the same way an absent value does — otherwise persisting
    // the pick would hide Size, Full width and Variant on every link that
    // took it.
    const condition = (schema.attributes as any[]).find(
      (a) => a.name === 'variant',
    ).condition
    const matches = (renderAs: unknown) =>
      condition.notMatch
        ? renderAs !== condition.is
        : renderAs === condition.is
    expect(matches('button')).toBe(true)
    expect(matches(undefined)).toBe(true)
    expect(matches('link')).toBe(false)
  })

  it('hides the controls it drops in link mode, and only those', () => {
    const by = (name: string) =>
      schema.attributes.find((a: any) => a.name === name) as any
    // Exactly the props the renderer destructures away above. Offering
    // them in link mode would be three controls that silently do nothing.
    for (const name of ['size', 'fullWidth', 'variant']) {
      expect(by(name).condition).toEqual({
        when: 'renderAs',
        is: 'link',
        notMatch: true,
      })
    }
    // `color` rides through in `rest` and MUI's Link takes it, so it must
    // stay visible in both shapes.
    expect(by('color').condition).toBeUndefined()
    for (const name of ['screenId', 'href', 'renderAs']) {
      expect(by(name).condition).toBeUndefined()
    }
  })

  it('resolves a prop-fed screen reference wherever it lands', () => {
    // What a `Link`-typed component prop substitutes into whichever field
    // the author bound it to (AGL-1335). Both slots must resolve, or the
    // prop is rename-safe on one field and silently dead on the other.
    const site = (ui: React.ReactElement, screens: Record<string, string>) =>
      render(
        <Aglyn.ScreenLinkContext.Provider value={{ screens }}>
          {ui}
        </Aglyn.ScreenLinkContext.Provider>,
      )
    const screens = { s1: 'pricing' }
    const { container, unmount } = site(
      <ScreenLink renderAs="link" href="screen:s1">
        {'Plans'}
      </ScreenLink>,
      screens,
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/pricing')
    unmount()

    // The point of the id: rename the screen and the link follows.
    const renamed = site(
      <ScreenLink renderAs="link" href="screen:s1">
        {'Plans'}
      </ScreenLink>,
      { s1: 'plans-and-pricing' },
    )
    expect(renamed.container.querySelector('a')?.getAttribute('href')).toBe(
      '/plans-and-pricing',
    )
  })

  it('keeps a legacy raw-string value rendering exactly as it did', () => {
    // The nine live `/product/*` CTAs hold a literal path in a `Link` prop.
    // Backwards compatibility is the whole constraint: no routing map is
    // consulted, the string IS the href.
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ screens: { s1: 'pricing' } }}>
        <ScreenLink renderAs="link" href="/pricing">
          {'Plans'}
        </ScreenLink>
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/pricing')
  })

  it('still refuses a script URL after the resolution moved (AGL-1335)', () => {
    render(
      <ScreenLink renderAs="link" href="javascript:alert(1)">
        {'Nope'}
      </ScreenLink>,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('survives a cleared colour against real MUI, not a stand-in', () => {
    // The SSR-500 itself (AGL-1226), reproduced through the component rather
    // than asserted: MUI builds `color${capitalize(color)}` and capitalize
    // throws on a non-string, which is a SERVER-SIDE throw — the page 500s.
    expect(() =>
      render(<ScreenLink color={null as any}>{'Go'}</ScreenLink>),
    ).not.toThrow()
    expect(() =>
      render(<ScreenLink size={null as any}>{'Go'}</ScreenLink>),
    ).not.toThrow()
  })

  it("falls back to MUI's own default when the colour is cleared", () => {
    // Clearing means "use the default", so the proof is the default class
    // being present — not merely the absence of a crash.
    const { container } = render(
      <ScreenLink color={null as any}>{'Go'}</ScreenLink>,
    )
    expect(container.querySelector('.MuiButton-colorPrimary')).not.toBeNull()
  })

  it('leaves the shared field presets unmutated', () => {
    // The schema spreads FIELD_SIZE/FIELD_FULL_WIDTH rather than editing
    // them; mutating would put a `renderAs` condition on every Button,
    // Icon Button and Menu Button in the plugin.
    const {
      FIELD_SIZE,
      FIELD_FULL_WIDTH,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../constants/field-presets')
    expect(FIELD_SIZE.condition).toBeUndefined()
    expect(FIELD_FULL_WIDTH.condition).toBeUndefined()
  })
})

describe('ScreenLink appearance is not semantics (AGL-1347)', () => {
  /** How the attributes panel decides, i.e. data-driven-forms' own rule. */
  const isVisible = (condition: any, renderAs: string) => {
    if (!condition) return true
    const value = renderAs
    const matched = Array.isArray(condition.is)
      ? condition.is.includes(value)
      : value === condition.is
    return condition.notMatch ? !matched : matched
  }
  const by = (name: string) =>
    schema.attributes.find((a: any) => a.name === name) as any

  it('gives a pill that navigates the LINK role, not the button role', () => {
    // The 12 chips in "Dig in, or just say hello" on aglyn.com: every one
    // navigates, none performs an action, and all 12 announced as buttons.
    render(
      <ScreenLink renderAs="linkButton" href="/docs" variant="outlined">
        {'Documentation home'}
      </ScreenLink>,
    )
    const link = screen.getByRole('link', { name: 'Documentation home' })
    expect(link.tagName).toBe('A')
    // `role="button"` is the accessibility defect itself — MUI's ButtonBase
    // stamps it on any non-<button> root unless the caller clears it.
    expect(link.getAttribute('role')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the button styling it was asked for on that link', () => {
    // Semantics fixed AND the pill intact is the whole point: converting to
    // Text link would have deleted the fill, border, padding and radius.
    const { container } = render(
      <ScreenLink
        renderAs="linkButton"
        href="https://linkedin.com/company/aglyn"
        variant="outlined"
        size="small"
      >
        {'LinkedIn'}
      </ScreenLink>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.className).toMatch(/MuiButton-outlined/)
    expect(link.className).toMatch(/MuiButton-sizeSmall/)
  })

  it('leaves the plain Button mode announcing as a button', () => {
    // Unset and `''` both mean Button, and Button keeps the role it had —
    // nothing already authored changes shape.
    render(<ScreenLink href="/pricing">{'Start free'}</ScreenLink>)
    expect(screen.getByRole('button', { name: 'Start free' })).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not repaint a Text link that still carries an authored variant', () => {
    // The trap this mode exists to avoid. The shipped preset is
    // `variant: 'outlined'`, and switching Render as to Text link leaves that
    // value in the document — so honouring `variant` in `"link"` mode would
    // have turned the site nav and footer into outlined pills.
    const { container } = render(
      <ScreenLink renderAs="link" href="/careers" variant="outlined" fullWidth>
        {'Careers'}
      </ScreenLink>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.className).toMatch(/MuiLink/)
    expect(link.className).not.toMatch(/MuiButton/)
  })

  it('shows the same pill on the canvas, and still not as a button', () => {
    // Suppressed navigation must mirror the live shape: the look without a
    // <button> and without the role, or the besigner lies about both.
    renderEditor(
      <ScreenLink renderAs="linkButton" variant="contained">
        {'Security'}
      </ScreenLink>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    const placeholder = screen.getByText('Security')
    expect(placeholder.tagName).toBe('SPAN')
    expect(placeholder.className).toMatch(/MuiButton-contained/)
  })

  it('offers Variant and Size in the styled-link mode, and only hides them for Text link', () => {
    for (const name of ['size', 'fullWidth', 'variant']) {
      expect(isVisible(by(name).condition, '')).toBe(true)
      expect(isVisible(by(name).condition, 'linkButton')).toBe(true)
      expect(isVisible(by(name).condition, 'link')).toBe(false)
    }
  })
})
