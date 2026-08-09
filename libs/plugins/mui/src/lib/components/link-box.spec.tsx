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
import LinkBox, { ID, schema } from './link-box'

/** The besigner canvas / preview: navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/** A published site whose routing map knows about `about`, and nothing else. */
const renderSite = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: { about: 'company/about' } }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/** The single rendered element, whatever tag it turned out to be. */
const root = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement

const tile = (
  <>
    <span data-testid="icon" />
    <span>{'Besigner'}</span>
    <span>{'Visual builder on a live canvas'}</span>
  </>
)

describe('LinkBox (AGL-1231)', () => {
  it('puts the whole tile inside one anchor', () => {
    render(<LinkBox href="/product/besigner">{tile}</LinkBox>)
    const link = screen.getByRole('link')
    expect(link.tagName).toBe('A')
    // The bug this exists to fix: the icon and the description sitting
    // OUTSIDE the anchor, so only the title line is clickable.
    expect(link.contains(screen.getByTestId('icon'))).toBe(true)
    expect(
      link.contains(screen.getByText('Visual builder on a live canvas')),
    ).toBe(true)
  })

  it('accepts children — it must not be a leaf like every other link element', () => {
    // `nodeAcceptsChildren` treats `selfClosing`/`textEditable` as leaf
    // markers; either one here would make the canvas refuse a drop and put
    // us back where we started.
    expect(schema.flags?.selfClosing).toBeUndefined()
    expect(schema.flags?.textEditable).toBeUndefined()
  })

  it('keeps the element but drops navigation when navigation is suppressed', () => {
    const { container } = renderEditor(
      <LinkBox href="/product/besigner">{tile}</LinkBox>,
    )
    // Same tag the live page ships (AGL-1268) — the canvas must not lie
    // about the box the page will ship...
    expect(root(container).tagName).toBe('A')
    // ...but the besigner must not navigate when you click a tile, and an
    // anchor with no `href` is inert by spec: not focusable, not a link.
    expect(root(container).hasAttribute('href')).toBe(false)
    expect(screen.queryByRole('link')).toBeNull()
    // The content is still there.
    expect(screen.getByText('Besigner')).toBeTruthy()
  })

  describe('element type does not depend on the screens map (AGL-1268)', () => {
    it('navigates when the screen resolves', () => {
      const { container } = renderSite(<LinkBox screenId="about">{tile}</LinkBox>)
      expect(root(container).tagName).toBe('A')
      expect(root(container).getAttribute('href')).toBe('/company/about')
      expect(screen.getByRole('link')).toBe(root(container))
    })

    it('renders the SAME element, dead, when the screen does not resolve', () => {
      // A screen unpublished or deleted after the ISR page was cached: the
      // routing map has no entry, so `useScreenLink` returns no href. If
      // that flipped the tag to `<div class="MuiBox-root">`, the cached HTML
      // and the hydrating render would disagree on the element type and
      // React would throw the whole subtree away.
      const { container } = renderSite(
        <LinkBox screenId="unpublished">{tile}</LinkBox>,
      )
      expect(root(container).tagName).toBe('A')
      // Dead, not navigating: no href means the browser does nothing on
      // click and assistive tech does not announce a link.
      expect(root(container).hasAttribute('href')).toBe(false)
      expect(screen.queryByRole('link')).toBeNull()
      expect(screen.getByText('Besigner')).toBeTruthy()
    })

    it('is the same tag on every surface', () => {
      // Stated as one assertion so the three branches cannot drift apart
      // again: resolved, unresolved, and suppressed must agree.
      const tags = [
        renderSite(<LinkBox screenId="about">{tile}</LinkBox>),
        renderSite(<LinkBox screenId="unpublished">{tile}</LinkBox>),
        renderEditor(<LinkBox screenId="about">{tile}</LinkBox>),
      ].map(({ container }) => root(container).tagName)
      expect(tags).toEqual(['A', 'A', 'A'])
    })

    it('keeps the anchor chrome off the dead box too', () => {
      // The dead branch is a bare `<a>`, which a browser styles as underlined
      // and blue. It carries the same style floor as the live branch, and
      // node styles still win over it — otherwise a tile whose screen went
      // missing would suddenly render as a default anchor.
      const { container } = renderSite(
        <LinkBox screenId="unpublished" sx={{ display: 'flex' }}>
          {tile}
        </LinkBox>,
      )
      const style = getComputedStyle(root(container))
      expect(style.textDecoration).toContain('none')
      expect(style.display).toBe('flex')
    })
  })

  it('refuses a javascript: href', () => {
    const { container } = render(
      <LinkBox href={'javascript:alert(1)' as string}>{tile}</LinkBox>,
    )
    // A stored href is rendered verbatim into every visitor's page, so an
    // unsafe protocol must never reach the DOM. The element stays the same
    // anchor (AGL-1268); what it must not have is the href.
    expect(screen.queryByRole('link')).toBeNull()
    expect(root(container).hasAttribute('href')).toBe(false)
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('opens a new tab only for external destinations', () => {
    const { rerender } = render(
      <LinkBox href="https://github.com/aglyn/aglyn" newTab>
        {tile}
      </LinkBox>,
    )
    const external = screen.getByRole('link')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toContain('noopener')

    // A site-relative destination stays in the tab even with `newTab` on:
    // "external" has to mean "leaves the site", not "was typed into the URL
    // field", or every hand-written internal link throws away the
    // visitor's history.
    rerender(
      <LinkBox href="/pricing" newTab>
        {tile}
      </LinkBox>,
    )
    expect(screen.getByRole('link').getAttribute('target')).toBeNull()
  })

  it('merges node styles over the baseline instead of replacing it', () => {
    // The renderer passes the node's `sx` through, so spreading it after the
    // baseline would REPLACE it — every styled tile would silently lose
    // `textDecoration: none` and render as an underlined blue anchor.
    render(
      <LinkBox href="/product/besigner" sx={{ display: 'flex', gap: '12px' }}>
        {tile}
      </LinkBox>,
    )
    const style = getComputedStyle(screen.getByRole('link'))
    expect(style.display).toBe('flex')
    expect(style.gap).toBe('12px')
    expect(style.textDecoration).toContain('none')
  })

  it('keeps its persisted component id', () => {
    // Ids are stored in screen documents; renaming orphans every instance.
    expect(ID).toBe('muiLinkBox')
    expect(schema.$id).toBe('muiLinkBox')
  })
})
