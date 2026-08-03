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
import TabsElement, {
  labelSlug,
  labelsMatch,
  parseLabels,
  TabPanelElement,
  tabPanelSchema,
  tabsPresets,
  tabsSchema,
  TABS_ID,
  TAB_PANEL_ID,
} from './tabs'

/** Static besigner canvas: navigation suppressed AND interactions inert. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ suppressNavigation: true, editorInert: true }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/**
 * jest-dom is not set up in this project, so visibility is read from the
 * panel's own `hidden` attribute — which is also what assistive tech and
 * the browser act on.
 */
const panelHidden = (text: string): boolean =>
  (screen.getByText(text).closest('[role=tabpanel]') as HTMLElement).hidden

const threeTabs = (
  <TabsElement labels={'Overview\nDetails\nFAQ'}>
    <TabPanelElement label="Overview">{'Overview body'}</TabPanelElement>
    <TabPanelElement label="Details">{'Details body'}</TabPanelElement>
    <TabPanelElement label="FAQ">{'FAQ body'}</TabPanelElement>
  </TabsElement>
)

describe('parseLabels (AGL-1201)', () => {
  it('reads one label per line, and the comma form people type first', () => {
    expect(parseLabels('A\nB\nC')).toEqual(['A', 'B', 'C'])
    expect(parseLabels('A, B, C')).toEqual(['A', 'B', 'C'])
  })

  it('drops blank lines instead of rendering nameless tabs', () => {
    expect(parseLabels('A\n\n  \nB')).toEqual(['A', 'B'])
    expect(parseLabels('')).toEqual([])
    expect(parseLabels(undefined)).toEqual([])
  })
})

describe('labelsMatch / labelSlug', () => {
  it('matches labels the author did not retype exactly', () => {
    expect(labelsMatch('FAQ', 'faq')).toBe(true)
    expect(labelsMatch(' Overview ', 'Overview')).toBe(true)
    expect(labelsMatch('Overview', 'Details')).toBe(false)
  })

  it('produces a usable dom id even from punctuation-only labels', () => {
    expect(labelSlug('Getting started!')).toBe('getting-started')
    expect(labelSlug('!!!')).toBe('tab')
  })
})

describe('Tabs element', () => {
  it('renders the whole strip in the first paint', () => {
    // The strip comes from the author's own label list rather than from
    // panels registering on mount: a registration pass would ship an
    // empty strip in the SSR output and fill it in only after hydration.
    render(threeTabs)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('shows only the selected panel on the live site', () => {
    render(threeTabs)
    expect(panelHidden('Overview body')).toBe(false)
    expect(panelHidden('Details body')).toBe(true)
  })

  it('switches panels when a visitor picks a tab', () => {
    render(threeTabs)
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(panelHidden('Details body')).toBe(false)
    expect(panelHidden('Overview body')).toBe(true)
  })

  it('does not split its children by index', () => {
    // The node renderer hands a component ONE Branch fragment rather than
    // one element per child node, so an index-based split would put every
    // panel behind the first tab. Matching by label also survives
    // reordering panels in the hierarchy.
    render(
      <TabsElement labels={'One\nTwo'}>
        <>
          <TabPanelElement label="Two">{'Second body'}</TabPanelElement>
          <TabPanelElement label="One">{'First body'}</TabPanelElement>
        </>
      </TabsElement>,
    )
    expect(panelHidden('First body')).toBe(false)
    expect(panelHidden('Second body')).toBe(true)
  })

  it('wires each tab to its panel for assistive tech', () => {
    render(threeTabs)
    const tab = screen.getByRole('tab', { name: 'FAQ' })
    expect(tab.getAttribute('aria-controls')).toBe('tabpanel-faq')
    expect(screen.getByText('FAQ body').closest('[role=tabpanel]')?.id).toBe(
      'tabpanel-faq',
    )
  })

  it('shows every panel on the canvas, so each one can be edited', () => {
    // A hidden panel cannot be selected or styled — the same reason the
    // Accordion force-expands and the Drawer expands while selected.
    renderEditor(threeTabs)
    expect(panelHidden('Overview body')).toBe(false)
    expect(panelHidden('Details body')).toBe(false)
    expect(panelHidden('FAQ body')).toBe(false)
  })

  it('labels the stacked canvas panels so a typo is obvious', () => {
    renderEditor(threeTabs)
    expect(screen.getByText('Tab: Details')).toBeTruthy()
    // The active one needs no caption; the strip already marks it.
    expect(screen.queryByText('Tab: Overview')).toBeNull()
  })

  it('survives a label being deleted from the list', () => {
    // A selection past the end makes MUI warn and drop the indicator.
    const { rerender } = render(threeTabs)
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }))
    rerender(
      <TabsElement labels={'Overview'}>
        <TabPanelElement label="Overview">{'Overview body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(panelHidden('Overview body')).toBe(false)
  })

  it('renders a panel dragged out of its tabs rather than hiding it', () => {
    // Vanishing from the canvas with no explanation is not a repairable
    // state for an author.
    render(<TabPanelElement label="Orphan">{'Orphan body'}</TabPanelElement>)
    expect(panelHidden('Orphan body')).toBe(false)
  })
})

describe('Tabs schema and presets', () => {
  it('hides `centered`, which MUI ignores on a scrollable strip', () => {
    const field = tabsSchema.attributes.find((a: any) => a.name === 'centered')
    expect((field as any).condition).toEqual({
      when: 'variant',
      is: 'scrollable',
      notMatch: true,
    })
  })

  it('only accepts Tab Panels as children', () => {
    expect((tabsSchema as any).restrictChildren[1].components).toEqual([
      TAB_PANEL_ID,
    ])
  })

  it('ships labels and panels already matched', () => {
    // Label/panel matching is the one way this element can be
    // misconfigured; the common path must never hit it.
    const tabs = tabsPresets[0].data as any
    expect(tabs.componentId).toBe(TABS_ID)
    const labels = parseLabels(tabs.props.labels)
    expect(labels).toHaveLength(3)
    expect(tabs.nodes).toHaveLength(3)
    for (const [index, panel] of tabs.nodes.entries()) {
      expect(panel.componentId).toBe(TAB_PANEL_ID)
      expect(labelsMatch(panel.props.label, labels[index])).toBe(true)
    }
  })

  it('names the panel field after what it does', () => {
    const field = tabPanelSchema.attributes.find(
      (a: any) => a.name === 'label',
    ) as any
    expect(field.label).toBe('Shows under tab')
  })
})
