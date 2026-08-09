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
  atLeastLabels,
  labelSlug,
  labelsMatch,
  parseLabels,
  TabPanelElement,
  tabPanelSchema,
  tabsPresets,
  tabsSchema,
  TABS_ID,
  TAB_LINK_SLOTS,
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
 *
 * Coerced because the IDL property is `boolean | 'until-found'`, and every
 * one of those states is hidden as far as these cases are concerned.
 */
const panelHidden = (text: string): boolean =>
  Boolean((screen.getByText(text).closest('[role=tabpanel]') as HTMLElement).hidden)

/**
 * `ssrPanels` so every panel is in the tree: these cases are about the strip,
 * the label matching and the hide rule, not about mounting — which has its
 * own describe below (panels mount lazily BY DEFAULT since AGL-1283 opt. 3).
 */
const threeTabs = (
  <TabsElement labels={'Overview\nDetails\nFAQ'} ssrPanels>
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
      <TabsElement labels={'One\nTwo'} ssrPanels>
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
      <TabsElement labels={'Overview'} ssrPanels>
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

describe('authored sx survives (AGL-1284)', () => {
  /**
   * Both elements rendered `<Box {...rest} sx={{…}}>`, so the `sx` written
   * on the node was overwritten by the component's own. Every authored style
   * on every Tabs on every site was silently dropped, with nothing in the
   * editor to say so — the styles were saved, they just never rendered.
   */
  it('keeps the container sx the author set', () => {
    render(
      <TabsElement
        labels={'One\nTwo'}
        ssrPanels
        sx={{ backgroundColor: 'rgb(1, 2, 3)' }}
      >
        <TabPanelElement label="One">{'One body'}</TabPanelElement>
      </TabsElement>,
    )
    const box = screen.getByText('One body').closest('[role=tabpanel]')
      ?.parentElement as HTMLElement
    expect(getComputedStyle(box).backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it('keeps the panel sx the author set, overriding the default padding', () => {
    render(
      <TabsElement labels={'One'}>
        <TabPanelElement label="One" sx={{ padding: '0px' }}>
          {'One body'}
        </TabPanelElement>
      </TabsElement>,
    )
    const panel = screen.getByText('One body').closest(
      '[role=tabpanel]',
    ) as HTMLElement
    expect(getComputedStyle(panel).padding).toBe('0px')
  })

  /**
   * The merge must not hand authors a way to un-hide a deselected panel:
   * the hide rule is appended last precisely so it wins.
   */
  it('still hides a deselected panel even when the author sets display', () => {
    render(
      <TabsElement labels={'One\nTwo'} ssrPanels>
        <TabPanelElement label="One">{'One body'}</TabPanelElement>
        <TabPanelElement label="Two" sx={{ display: 'block' }}>
          {'Two body'}
        </TabPanelElement>
      </TabsElement>,
    )
    const two = screen.getByText('Two body').closest(
      '[role=tabpanel]',
    ) as HTMLElement
    expect(two.hidden).toBe(true)
    expect(getComputedStyle(two).display).toBe('none')
  })
})

describe('panel mounting (AGL-1283)', () => {
  const three = (props: { ssrPanels?: boolean; lazyPanels?: boolean } = {}) => (
    <TabsElement labels={'One\nTwo\nThree'} {...props}>
      <TabPanelElement label="One">{'One body'}</TabPanelElement>
      <TabPanelElement label="Two">{'Two body'}</TabPanelElement>
      <TabPanelElement label="Three">{'Three body'}</TabPanelElement>
    </TabsElement>
  )

  it('renders only the selected panel by default (option 3)', () => {
    render(three())
    expect(screen.getByText('One body')).toBeTruthy()
    expect(screen.queryByText('Two body')).toBeNull()
    expect(screen.queryByText('Three body')).toBeNull()
  })

  it('keeps the aria wiring for panels whose children are unmounted', () => {
    // The wrapper stays so `aria-controls` still resolves; only the panel's
    // children wait for the first selection.
    render(three())
    const tab = screen.getByRole('tab', { name: 'Two' })
    expect(tab.getAttribute('aria-controls')).toBe('tabpanel-two')
    expect(document.getElementById('tabpanel-two')).toBeTruthy()
  })

  it('ships every panel when ssrPanels is on — content stays in the markup', () => {
    render(three({ ssrPanels: true }))
    expect(screen.getByText('Two body')).toBeTruthy()
    expect(screen.getByText('Three body')).toBeTruthy()
  })

  it('treats the legacy lazyPanels opt-in as the (now default) lazy mode', () => {
    // Documents authored while lazy was opt-in still carry the prop; it must
    // not turn anything back on, and it must not reach the DOM element.
    render(three({ lazyPanels: true }))
    expect(screen.queryByText('Two body')).toBeNull()
    const panel = document.getElementById('tabpanel-one') as HTMLElement
    expect(panel.getAttribute('lazyPanels')).toBeNull()
  })

  it('mounts a panel when its tab is first opened, and only that one', () => {
    render(three())
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(screen.getByText('Two body')).toBeTruthy()
    // Still untouched — opening one tab must not mount the whole set.
    expect(screen.queryByText('Three body')).toBeNull()
  })

  /**
   * A visited panel stays mounted, so switching back and forth does not
   * rebuild it — and anything the reader scrolled or typed inside survives.
   */
  it('keeps a visited panel mounted after moving away', () => {
    render(three())
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Three' }))
    // Two is no longer selected but was visited, so it stays in the tree.
    expect(screen.getByText('Two body')).toBeTruthy()
    expect(screen.getByText('Three body')).toBeTruthy()
    // One was the initial selection, so it is mounted too — but nothing
    // that was never selected should have appeared.
    expect(screen.getByText('One body')).toBeTruthy()
  })

  /** The canvas must keep showing everything, or panels become unselectable. */
  it('mounts everything on the besigner canvas regardless', () => {
    renderEditor(three())
    expect(screen.getByText('Two body')).toBeTruthy()
    expect(screen.getByText('Three body')).toBeTruthy()
  })
})

describe('link mode (AGL-1312)', () => {
  /** Host routing map: screen id → routed path, exactly as the host doc. */
  const SCREENS = {
    'screen-changelog': 'changelog',
    'screen-newsroom': 'newsroom',
    'screen-home': '/',
  }

  const renderSite = (ui: React.ReactElement) =>
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ screens: SCREENS }}>
        {ui}
      </Aglyn.ScreenLinkContext.Provider>,
    )

  /**
   * The marketing content-tabs row: the tab for the page you are already on
   * carries no link (linking a page to itself is the classic navigation
   * mistake), the other two navigate. A mixed row is the COMMON case here,
   * not an edge case.
   */
  const contentTabs = (
    <TabsElement
      labels={'Blog\nChangelog\nNewsroom'}
      tabLink2="screen-changelog"
      tabLink3="screen-newsroom"
      ssrPanels
    >
      <TabPanelElement label="Blog">{'Blog body'}</TabPanelElement>
    </TabsElement>
  )

  it('renders a linked tab as an anchor pointing at the screen', () => {
    renderSite(contentTabs)
    const link = screen.getByRole('link', { name: 'Changelog' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/changelog')
  })

  it('resolves the href from the routing map, not from an authored path', () => {
    // A renamed slug must move the link; that is the whole reason tabs
    // persist a screen id.
    renderSite(
      <TabsElement labels={'One\nTwo'} tabLink2="screen-home">
        <TabPanelElement label="One">{'One body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(screen.getByRole('link', { name: 'Two' }).getAttribute('href')).toBe(
      '/',
    )
  })

  it('marks the row up as navigation, not as a tab list', () => {
    // An <a href> wearing role="tab" promises a panel and delivers a page
    // load. Once anything in the row navigates, the row is a nav.
    renderSite(contentTabs)
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeTruthy()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryAllByRole('tablist')).toHaveLength(0)
  })

  it('names the nav landmark when the author gives the row a name', () => {
    renderSite(
      <TabsElement
        labels={'Blog\nChangelog'}
        ariaLabel="Content"
        tabLink2="screen-changelog"
      />,
    )
    expect(screen.getByRole('navigation', { name: 'Content' })).toBeTruthy()
  })

  it('leaves every link its own tab stop instead of one roving one', () => {
    renderSite(contentTabs)
    expect(
      screen.getByRole('link', { name: 'Newsroom' }).getAttribute('tabindex'),
    ).not.toBe('-1')
  })

  it('marks the tab for the current screen, and only that one', () => {
    renderSite(contentTabs)
    expect(screen.getByText('Blog').closest('[aria-current]')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Changelog' }).getAttribute(
        'aria-current',
      ),
    ).toBeNull()
  })

  it('lands on the tab of the page this copy of the row is on', () => {
    // The same row goes on all three screens; on each one the tab for that
    // screen is the one left unlinked. Without this the indicator would sit
    // under the first tab on every page, which is right exactly once.
    renderSite(
      <TabsElement
        labels={'Blog\nChangelog\nNewsroom'}
        tabLink1="screen-home"
        tabLink3="screen-newsroom"
        ssrPanels
      >
        <TabPanelElement label="Changelog">{'Changelog body'}</TabPanelElement>
      </TabsElement>,
    )
    const current = document.getElementById('tab-changelog') as HTMLElement
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(
      (document.getElementById('tabpanel-changelog') as HTMLElement).hidden,
    ).toBe(false)
  })

  it('marks nothing current when every tab navigates away', () => {
    // Nothing here is the current page, so inventing a selection would
    // point at the wrong one.
    renderSite(
      <TabsElement
        labels={'Changelog\nNewsroom'}
        tabLink1="screen-changelog"
        tabLink2="screen-newsroom"
      />,
    )
    expect(document.querySelector('[aria-current]')).toBeNull()
  })

  it('keeps a panel-switching tab switching panels in a mixed row', () => {
    renderSite(
      <TabsElement
        labels={'Overview\nDetails\nChangelog'}
        tabLink3="screen-changelog"
        ssrPanels
      >
        <TabPanelElement label="Overview">{'Overview body'}</TabPanelElement>
        <TabPanelElement label="Details">{'Details body'}</TabPanelElement>
      </TabsElement>,
    )
    const details = document.getElementById('tab-details') as HTMLElement
    expect(details.tagName).toBe('BUTTON')
    fireEvent.click(details)
    expect((document.getElementById('tabpanel-details') as HTMLElement).hidden)
      .toBe(false)
    expect((document.getElementById('tabpanel-overview') as HTMLElement).hidden)
      .toBe(true)
  })

  it('does not move the selection when a navigating tab is clicked', () => {
    // The indicator would jump to a tab with an empty panel while the next
    // page is still loading.
    renderSite(contentTabs)
    fireEvent.click(screen.getByRole('link', { name: 'Changelog' }))
    expect((document.getElementById('tabpanel-blog') as HTMLElement).hidden)
      .toBe(false)
  })

  it('points aria-controls only at panels a tab actually reveals', () => {
    renderSite(contentTabs)
    expect(
      (document.getElementById('tab-blog') as HTMLElement).getAttribute(
        'aria-controls',
      ),
    ).toBe('tabpanel-blog')
    expect(
      screen
        .getByRole('link', { name: 'Newsroom' })
        .getAttribute('aria-controls'),
    ).toBeNull()
  })

  it('drops the tab-pattern ARIA from panels that have no tablist', () => {
    // Half-applied ARIA is the bug: a tabpanel with no tablist above it is
    // orphaned. The id stays, because aria-controls still points at it.
    renderSite(contentTabs)
    const panel = document.getElementById('tabpanel-blog') as HTMLElement
    expect(panel.getAttribute('role')).toBeNull()
    expect(panel.getAttribute('aria-labelledby')).toBeNull()
    expect(screen.getByText('Blog body')).toBeTruthy()
  })

  it('keeps ssrPanels shipping every panel in link mode', () => {
    renderSite(
      <TabsElement
        labels={'Blog\nChangelog'}
        tabLink2="screen-changelog"
        ssrPanels
      >
        <TabPanelElement label="Blog">{'Blog body'}</TabPanelElement>
        <TabPanelElement label="Changelog">{'Changelog body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(screen.getByText('Changelog body')).toBeTruthy()
  })

  it('still mounts panels lazily in link mode', () => {
    renderSite(
      <TabsElement labels={'Blog\nChangelog'} tabLink2="screen-changelog">
        <TabPanelElement label="Blog">{'Blog body'}</TabPanelElement>
        <TabPanelElement label="Changelog">{'Changelog body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(screen.getByText('Blog body')).toBeTruthy()
    expect(screen.queryByText('Changelog body')).toBeNull()
  })

  it('shows the shape the page will ship, without navigating, on the canvas', () => {
    // Suppressed navigation must not turn the row back into a tab list —
    // the besigner would then show a different element than production.
    render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ screens: SCREENS, suppressNavigation: true, editorInert: true }}
      >
        {contentTabs}
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByRole('navigation', { name: 'Tabs' })).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('leaves a row with no links exactly as it was', () => {
    render(
      <TabsElement labels={'One\nTwo'} ssrPanels>
        <TabPanelElement label="One">{'One body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(
      (document.getElementById('tabpanel-one') as HTMLElement).getAttribute(
        'role',
      ),
    ).toBe('tabpanel')
  })

  it('never leaks a link id onto the dom', () => {
    const { container } = renderSite(contentTabs)
    expect(container.querySelector('[tabLink2]')).toBeNull()
    expect(container.innerHTML).not.toContain('screen-changelog')
  })

  it('renders a plain tab when the target screen no longer resolves', () => {
    // Unpublished or deleted: a dead anchor is worse than a plain tab.
    renderSite(
      <TabsElement labels={'One\nTwo'} tabLink2="screen-deleted">
        <TabPanelElement label="One">{'One body'}</TabPanelElement>
      </TabsElement>,
    )
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Two')).toBeTruthy()
  })
})

describe('link authoring surface (AGL-1312)', () => {
  const linkFields = tabsSchema.attributes.filter((a: any) =>
    /^tabLink\d+$/.test(a.name),
  )

  it('offers one Screen picker per tab position, the Screen Link field', () => {
    expect(linkFields).toHaveLength(TAB_LINK_SLOTS)
    for (const field of linkFields as any[]) {
      expect(field.component).toBe(Aglyn.FieldComponentType.SCREEN_SELECT)
    }
  })

  it('sits with the label list it indexes into', () => {
    const names = tabsSchema.attributes.map((a: any) => a.name)
    expect(names.indexOf('tabLink1')).toBe(names.indexOf('labels') + 1)
  })

  it('reveals exactly as many pickers as the author has tabs', () => {
    // The condition travels with the schema, so it is a pattern rather than
    // a predicate function — this is the proof it counts what parseLabels
    // counts, blank lines and the comma form included.
    const shows = (count: number, labels: string) => {
      const condition = atLeastLabels(count) as any
      return condition.pattern
        ? new RegExp(condition.pattern).test(labels)
        : labels.trim().length > 0
    }
    for (const labels of ['', 'Blog', 'Blog\nChangelog', 'A, B, C', 'A\n \nB']) {
      const tabs = parseLabels(labels).length
      for (let slot = 1; slot <= TAB_LINK_SLOTS; slot += 1) {
        expect([labels, slot, shows(slot, labels)]).toEqual([
          labels,
          slot,
          slot <= tabs,
        ])
      }
    }
  })

  it('adds no mode switch whose default could not persist', () => {
    // An `''` option value is stripped before save (AGL-1191), so a
    // "panels vs links" select would silently revert. Carrying a link is
    // the mode instead — which is also what makes a mixed row expressible.
    const names = tabsSchema.attributes.map((a: any) => a.name)
    expect(names).not.toContain('linkMode')
    expect(names).not.toContain('renderAs')
  })
})
