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
import { AglynText } from '@aglyn/shared-ui-jsx'
import { render, screen } from '@testing-library/react'
import AccordionElement, {
  AccordionDetailsElement,
  AccordionSummaryElement,
  accordionSummarySchema,
} from './accordion'
import Button, { schema as buttonSchema } from './button'
import ScreenLink, { schema as screenLinkSchema } from './screen-link'

/**
 * RICH TEXT ON THE ELEMENTS THAT RENDER A CONTROL (AGL-2557).
 *
 * Until this, `typography.tsx` was the only component in the repo that read
 * the `html` prop back. The inline editor's rich mode commits sanitized
 * markup there and keeps `children` as the plain-text fallback — so turning
 * the editor's flag on anywhere else, without the read side, would have
 * shipped a toolbar whose output was discarded: bold while typing, plain the
 * moment it committed.
 *
 * These are the three elements that got the read side. What they have in
 * common is the constraint: each renders a `<button>` or an `<a>`, whose
 * content model is phrasing content with no interactive descendant. So they
 * take EMPHASIS only, and the render path is what holds that line for markup
 * the toolbar did not write.
 */
describe('a control renders its formatted label (AGL-2557)', () => {
  /** Live site: the routing map resolves, nothing is suppressed. */
  const renderSite = (ui: React.ReactElement) =>
    render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ screens: { scr_product: 'product' } }}
      >
        {ui}
      </Aglyn.ScreenLinkContext.Provider>,
    )

  describe('Button', () => {
    it('draws the markup and ignores the plain fallback', () => {
      const { container } = render(
        <Button html={'Click <b>Me</b>'}>
          <AglynText>{'Click Me'}</AglynText>
        </Button>,
      )
      expect(container.querySelector('button b')?.textContent).toBe('Me')
      // ONE reading of the label, not the markup plus the fallback beside it.
      expect(screen.getByRole('button').textContent).toBe('Click Me')
    })

    it('keeps the formatting in link mode too', () => {
      renderSite(
        <Button html={'Read <em>more</em>'} screenId="scr_product">
          {'Read more'}
        </Button>,
      )
      const link = screen.getByRole('button', { name: 'Read more' })
      expect(link.querySelector('em')?.textContent).toBe('more')
      expect(link.getAttribute('href')).toBe('/product')
    })

    it('renders exactly what it always did with no html prop', () => {
      // The overwhelmingly common case: nothing is substituted, and the
      // element gets the children the renderer handed it.
      const { container } = render(<Button>{'Click Me'}</Button>)
      expect(container.querySelector('aglyn-text')).toBeNull()
      expect(screen.getByRole('button').textContent).toBe('Click Me')
    })
  })

  describe('Screen Link', () => {
    it('draws the markup in text-link mode', () => {
      renderSite(
        <ScreenLink html={'Our <b>pricing</b>'} renderAs="link" screenId="scr_product">
          {'Our pricing'}
        </ScreenLink>,
      )
      const link = screen.getByRole('link', { name: 'Our pricing' })
      expect(link.querySelector('b')?.textContent).toBe('pricing')
    })

    it('draws the markup on the inert canvas shape as well', () => {
      // The canvas must not lie about what the page will ship — an author
      // who bolds a word has to see it bolded where they typed it.
      render(
        <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
          <ScreenLink html={'Our <b>pricing</b>'}>{'Our pricing'}</ScreenLink>
        </Aglyn.ScreenLinkContext.Provider>,
      )
      expect(screen.getByRole('button').querySelector('b')).toBeTruthy()
    })
  })

  describe('Accordion Summary', () => {
    const panel = (props: Record<string, unknown>) => (
      <AccordionElement>
        <AccordionSummaryElement {...props}>
          <AglynText>{'How do I get started?'}</AglynText>
        </AccordionSummaryElement>
        <AccordionDetailsElement>{'Answer'}</AccordionDetailsElement>
      </AccordionElement>
    )

    it('draws the markup on the unsplit row', () => {
      // The row Zach was editing when this was reported: an FAQ question
      // whose toolbar offered `{}` and Done and nothing else.
      render(panel({ html: 'How do I <b>get started</b>?' }))
      const header = screen.getByRole('button')
      expect(header.querySelector('b')?.textContent).toBe('get started')
    })

    it('draws the markup on the LINKED row, in the anchor half', () => {
      renderSite(panel({ screenId: 'scr_product', html: 'Our <b>product</b>' }))
      const link = screen.getByRole('link')
      expect(link.querySelector('b')?.textContent).toBe('product')
      // Still two siblings, never a link inside the toggle (AGL-1232).
      expect(link.closest('button')).toBeNull()
    })

    it('still names the chevron from the plain children (AGL-2349)', () => {
      // The formatted label is markup handed to `dangerouslySetInnerHTML`,
      // so it has no React children for `childText` to walk. Reading the
      // name from it would have renamed every split summary "Toggle
      // section" the moment its label was bolded — the exact regression
      // AGL-2349 fixed.
      renderSite(panel({ screenId: 'scr_product', html: '<b>Product</b>' }))
      expect(
        screen.getByRole('button', { name: 'Toggle How do I get started?' }),
      ).toBeTruthy()
    })
  })

  describe('the label rides the leaf’s own text element', () => {
    it('renders into `aglyn-text`, which is what the canvas edits', () => {
      // In-place editing EMPTIES whatever element it is handed and looks for
      // the leaf's `aglyn-text` first, falling back to the leaf root
      // (AGL-2556). For a composite the root is the `<button>`, so a
      // formatted label rendered anywhere else would move the edit target
      // between plain and rich mode and take MUI's content wrapper — and its
      // `textAlign: 'start'` — with it for the length of the edit.
      const { container } = render(<Button html={'a <b>b</b>'}>{'a b'}</Button>)
      const text = container.querySelector('aglyn-text') as HTMLElement
      expect(text).toBeTruthy()
      expect(text.querySelector('b')?.textContent).toBe('b')
    })
  })
})

/**
 * THE PROP IS RE-SANITIZED ON EVERY RENDER (AGL-497).
 *
 * The editor sanitizes at commit, and that is not where the guarantee comes
 * from. Screen node props are written straight through the Firebase client
 * SDK, so a host editor can plant arbitrary `html` on a node without the
 * editor ever seeing it — and it would then run on the published site AND on
 * the besigner canvas at app.aglyn.com.
 */
describe('a planted html prop cannot execute or break the control (AGL-2557)', () => {
  it('drops a script and an event handler', () => {
    const { container } = render(
      <Button html={'<script>alert(1)</script><b onclick="x()">hi</b>'}>
        {'hi'}
      </Button>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')?.getAttribute('onclick')).toBeNull()
  })

  it('unwraps block markup rather than serving a control the parser will break', () => {
    // Not a tidiness rule. A `<ul>` start tag CLOSES an open `<button>`, so
    // the served string holds an emptied control with the list promoted to a
    // sibling — a tree React did not describe, which is a hydration mismatch
    // on a published page (the AGL-1926 shape).
    const { container } = render(
      <Button html={'<ul><li>one</li><li>two</li></ul>'}>{'one two'}</Button>,
    )
    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('li')).toBeNull()
    expect(screen.getByRole('button').textContent).toBe('onetwo')
  })

  it('unwraps a nested anchor, which no control may contain', () => {
    const { container } = render(
      <Button html={'go <a href="https://evil.test">there</a>'}>{'go there'}</Button>,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByRole('button').textContent).toBe('go there')
  })
})

/**
 * The three parts have to travel together: a schema may only turn the
 * editor's flag on where the component reads `html` back, and may only offer
 * a command whose output the element can hold.
 */
describe('the control schemas declare emphasis-only rich text (AGL-2557)', () => {
  const controls = [
    ['Accordion Summary', accordionSummarySchema],
    ['Button', buttonSchema],
    ['Screen Link', screenLinkSchema],
  ] as const

  it.each(controls)('%s is rich-text editable', (_name, schema) => {
    expect(
      (schema.flags?.richTextEditable ?? 0) & Aglyn.FEATURE_FLAG.ENABLED,
    ).not.toBe(0)
    // Still plain-text editable: the rich flag is an upgrade to the same
    // double-click, not a replacement for it.
    expect(
      (schema.flags?.textEditable ?? 0) & Aglyn.FEATURE_FLAG.ENABLED,
    ).not.toBe(0)
  })

  it.each(controls)('%s offers emphasis and nothing else', (_name, schema) => {
    expect(schema.richTextCommands).toEqual([
      Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
    ])
  })
})
