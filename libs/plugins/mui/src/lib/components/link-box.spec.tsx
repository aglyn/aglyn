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

  it('keeps the box but drops the anchor when navigation is suppressed', () => {
    renderEditor(<LinkBox href="/product/besigner">{tile}</LinkBox>)
    expect(screen.queryByRole('link')).toBeNull()
    // The canvas must not lie about what ships — the content is still there.
    expect(screen.getByText('Besigner')).toBeTruthy()
  })

  it('renders no anchor when the screen id does not resolve', () => {
    render(<LinkBox screenId="deleted-screen">{tile}</LinkBox>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Besigner')).toBeTruthy()
  })

  it('refuses a javascript: href', () => {
    render(
      <LinkBox href={'javascript:alert(1)' as string}>{tile}</LinkBox>,
    )
    // A stored href is rendered verbatim into every visitor's page, so an
    // unsafe protocol must produce no anchor at all rather than a live one.
    expect(screen.queryByRole('link')).toBeNull()
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
