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
