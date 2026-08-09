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
import { fireEvent, render, screen } from '@testing-library/react'
import AccordionElement, {
  ACCORDION_DETAILS_ID,
  ACCORDION_ID,
  ACCORDION_SUMMARY_ID,
  AccordionDetailsElement,
  AccordionSummaryElement,
  accordionPresets,
  accordionSchema,
  accordionSummarySchema,
} from './accordion'

/** Static besigner canvas: navigation suppressed AND interactions inert. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ suppressNavigation: true, editorInert: true }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/** Preview surface (AGL-830): navigation suppressed, interactions live. */
const renderPreview = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

const panel = (props: Record<string, unknown> = {}) => (
  <AccordionElement {...props}>
    <AccordionSummaryElement>{'Header'}</AccordionSummaryElement>
    <AccordionDetailsElement>{'Hidden details'}</AccordionDetailsElement>
  </AccordionElement>
)

/** MUI keeps collapsed details mounted; the region carries the state. */
const detailsExpanded = (): boolean =>
  !!document
    .querySelector('.MuiAccordion-root')
    ?.querySelector('[aria-expanded=true], .MuiCollapse-entered')

describe('Accordion element (AGL-1201)', () => {
  it('starts collapsed on the live site', () => {
    render(panel())
    expect(screen.getByRole('button', { name: /Header/ }).getAttribute(
      'aria-expanded',
    )).toBe('false')
  })

  it('honours "start expanded" on the live site', () => {
    render(panel({ defaultExpanded: true }))
    expect(
      screen.getByRole('button', { name: /Header/ }).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true')
  })

  it('toggles when a visitor clicks the header', () => {
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: /Header/ }))
    expect(detailsExpanded()).toBe(true)
  })

  it('still toggles in Preview, which is not the canvas', () => {
    // Preview renders the draft the way the published site will; a panel
    // frozen open there would misrepresent what ships.
    renderPreview(panel())
    const header = screen.getByRole('button', { name: /Header/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(header)
    expect(detailsExpanded()).toBe(true)
  })

  it('is expanded on the canvas even when it ships collapsed', () => {
    // Collapsed details cannot be selected or styled, so the canvas
    // shows them regardless of the author's setting (as the Drawer does
    // for its contents, AGL-571).
    renderEditor(panel({ defaultExpanded: false }))
    expect(
      screen.getByRole('button', { name: /Header/ }).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true')
  })

  it('gives the header an expand affordance', () => {
    // MUI leaves `expandIcon` to the caller; without it the control
    // looks like inert text and nothing suggests it opens.
    const { container } = render(panel())
    expect(
      container.querySelector('.MuiAccordionSummary-expandIconWrapper svg'),
    ).toBeTruthy()
  })
})

describe('Accordion summary with a linked header (AGL-1232)', () => {
  /** Live site: the routing map resolves, nothing is suppressed. */
  const renderSite = (ui: React.ReactElement) =>
    render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ screens: { scr_product: 'product' } }}
      >
        {ui}
      </Aglyn.ScreenLinkContext.Provider>,
    )

  const linkedPanel = (screenId = 'scr_product') => (
    <AccordionElement>
      <AccordionSummaryElement screenId={screenId}>
        {'Product'}
      </AccordionSummaryElement>
      <AccordionDetailsElement>{'Hidden details'}</AccordionDetailsElement>
    </AccordionElement>
  )

  it('renders the header as a real anchor pointing at the screen', () => {
    // The whole bug: in the mobile drawer this row could only toggle, so
    // /product and /solutions had no mobile entry point at all.
    renderSite(linkedPanel())
    const link = screen.getByRole('link', { name: 'Product' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/product')
  })

  it('never nests the anchor inside the toggle button', () => {
    // Invalid markup that browsers unnest, and nested interactive content
    // is unreachable with a keyboard or a screen reader — which is why the
    // row is split rather than wrapped.
    const { container } = renderSite(linkedPanel())
    const link = container.querySelector('a') as HTMLElement
    expect(link.closest('button')).toBeNull()
    expect(container.querySelector('button a')).toBeNull()
    expect(container.querySelector('a button')).toBeNull()
  })

  it('still toggles the panel from the chevron', () => {
    renderSite(linkedPanel())
    const toggle = screen.getByRole('button', { name: /Toggle Product/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(detailsExpanded()).toBe(true)
  })

  it('leaves the label and the toggle each reachable by keyboard', () => {
    const { container } = renderSite(linkedPanel())
    const link = container.querySelector('a') as HTMLElement
    const toggle = screen.getByRole('button', { name: /Toggle Product/ })
    // A native anchor with an href and a native button are both in the tab
    // order unless something removes them.
    expect(link.getAttribute('href')).toBeTruthy()
    expect(link.getAttribute('tabindex')).not.toBe('-1')
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('tabindex')).not.toBe('-1')
  })

  it('keeps the split shape where navigation is suppressed', () => {
    // The canvas and Preview must not show a row that behaves differently
    // from the one that ships — but neither may navigate.
    renderEditor(linkedPanel())
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Product')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Toggle Product/ })).toBeTruthy()
  })

  it('degrades to plain text when the screen no longer resolves', () => {
    // Unpublished or deleted target: no dead link, and the panel still opens.
    renderSite(linkedPanel('scr_deleted'))
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Toggle Product/ }))
    expect(detailsExpanded()).toBe(true)
  })

  it('keeps the same element whether or not the screen resolves (AGL-1268)', () => {
    // `href` comes from the screens map, so it can differ between the render
    // that produced a cached page and the render that hydrates it. If the
    // label were an `<a>` in one and a `<span>` in the other, that is an
    // element-type change at hydration, not a class mismatch — React remounts
    // the subtree. Link Container shipped this exact bug (AGL-1268).
    const resolved = renderSite(linkedPanel()).container
    const unresolved = renderSite(linkedPanel('scr_deleted')).container
    const suppressed = renderEditor(linkedPanel()).container

    const labelTag = (root: HTMLElement) =>
      root.querySelector('.MuiLink-root')?.tagName

    expect(labelTag(resolved)).toBe('A')
    expect(labelTag(unresolved)).toBe('A')
    expect(labelTag(suppressed)).toBe('A')
    // Still not a link: an anchor with no href has no link role and is not
    // in the tab order, so neither surface offers a dead destination.
    expect(
      unresolved.querySelector('.MuiLink-root')?.getAttribute('href'),
    ).toBeNull()
  })

  it('composes the author sx after its own layout, never before', () => {
    const { container } = renderSite(
      <AccordionElement>
        <AccordionSummaryElement screenId="scr_product" sx={{ display: 'grid' }}>
          {'Product'}
        </AccordionSummaryElement>
        <AccordionDetailsElement>{'Hidden details'}</AccordionDetailsElement>
      </AccordionElement>,
    )
    const row = container.querySelector('a')?.parentElement as HTMLElement
    expect(getComputedStyle(row).display).toBe('grid')
  })

  it('leaves an unlinked summary exactly as it was', () => {
    // One control, whole row toggles, no anchor anywhere — the shape every
    // accordion authored before this has.
    const { container } = renderSite(panel())
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('.MuiAccordionSummary-root')).toHaveLength(
      1,
    )
    const header = screen.getByRole('button', { name: /Header/ })
    expect(header.tagName).toBe('BUTTON')
    fireEvent.click(header)
    expect(detailsExpanded()).toBe(true)
  })

  it('offers the destination in the attributes panel', () => {
    const field = accordionSummarySchema.attributes.find(
      (a: any) => a.name === 'screenId',
    )
    expect(field).toBeTruthy()
    expect((field as any).component).toBe(Aglyn.FieldComponentType.SCREEN_SELECT)
  })
})

describe('Accordion schema and presets', () => {
  it('only accepts the summary/details pair MUI requires', () => {
    expect((accordionSchema as any).restrictChildren[1].components).toEqual([
      ACCORDION_SUMMARY_ID,
      ACCORDION_DETAILS_ID,
    ])
  })

  it('exposes the props the current docs list, and no removed ones', () => {
    const names = accordionSchema.attributes.map((a: any) => a.name)
    expect(names).toEqual(
      expect.arrayContaining(['defaultExpanded', 'disableGutters', 'disabled']),
    )
    // `expanded` is the controlled prop — an author setting it would
    // freeze the panel open with nothing to toggle it.
    expect(names).not.toContain('expanded')
  })

  it('ships presets with a summary and details already filled in', () => {
    const [single, faq] = accordionPresets
    expect((single.data as any).componentId).toBe(ACCORDION_ID)
    expect(
      (single.data as any).nodes.map((node: any) => node.componentId),
    ).toEqual([ACCORDION_SUMMARY_ID, ACCORDION_DETAILS_ID])
    expect((single.data as any).nodes[0].props.children).toBeTruthy()
    // The FAQ preset is a stack of three complete panels.
    expect((faq.data as any).nodes).toHaveLength(3)
    for (const item of (faq.data as any).nodes) {
      expect(item.componentId).toBe(ACCORDION_ID)
      expect(item.nodes).toHaveLength(2)
    }
  })
})
