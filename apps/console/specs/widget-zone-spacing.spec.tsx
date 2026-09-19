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

/**
 * AGL-3044: a widget zone spaces the cards it renders, and keeps the same gap
 * from the page's own cards.
 *
 * A zone of cards drawn as loose siblings takes whatever spacing its container
 * happens to give: none in a card grid's item (Billing → Usage, where the four
 * AI cards touched one another) and none in a plain container (the sites page,
 * where the AI card touched the site grid beneath it). The page's own cards are
 * spaced by the page's own `Stack`, which is why only the plugin cards looked
 * wrong.
 *
 * The slot is REAL here, over a registry answered by hand, so the widgets
 * reach the zone through the same gates a page applies.
 *
 * jsdom performs no layout and resolves no specificity (it applies matching
 * rules in document order), so this pins the CSS the zone EMITS and the values
 * jsdom computes where no two rules compete. The geometry was measured in
 * headless Chrome against these declarations, with the cards stood in by
 * fixed-height boxes, at 400, 700, 1000 and 1300px: 24px between the cards of
 * a zone in a card grid's item, 24px between a zone and the page's cards in a
 * plain container and inside a `Stack spacing={3}` (not 48px), and 24px, not
 * 48px, where a zone whose widgets all drew nothing sits between two cards.
 */

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import { ABSENT_WHEN_EMPTY_ATTRIBUTE } from '@aglyn/shared-ui-jsx/components/grid-items'
import { Stack, ThemeProvider, createTheme } from '@mui/material'
import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'

/** Widgets the registry answers, by slot. */
let mockRegistered: Record<string, Array<{ widgetId: string; Component: ComponentType<any> }>> = {}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  listConsoleWidgets: (slot: string) =>
    (mockRegistered[slot] ?? []).map((widget) => ({
      extension: { pluginId: 'demo', displayName: 'Demo' },
      widget: { slot, ...widget },
    })),
}))
/*
 * Every double answers ONE object for the life of the file. A hook that hands
 * back a fresh object per call feeds any effect keyed on it a new dependency
 * every render, which is a loop jest reports only as a hang.
 */
const mockFirestore = {}
const mockUser = { data: { uid: 'u1' } }
const mockOrg = { org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }
const mockPermissions = { permissions: {}, can: () => true, loaded: true }
const mockEnabledPluginIds = ['demo']

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => mockUser,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => mockOrg,
  useCurrentOrg: () => mockOrg,
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => mockPermissions,
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => mockEnabledPluginIds,
}))

import PluginWidgetSlot, {
  WIDGET_ZONE_LAYOUTS,
  WIDGET_ZONE_SPACING,
  widgetZoneLayout,
} from '../components/plugin-widget-slot.component'

const card = (name: string) => {
  function Card() {
    return <article data-card={name}>{name}</article>
  }
  Card.displayName = `Card(${name})`
  return { widgetId: name, Component: Card }
}

function Nothing() {
  return null
}

/** Every rule emotion emitted, as text. */
const stylesheet = () =>
  Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules).map((rule) => rule.cssText)
    } catch {
      return []
    }
  })

/** The rules whose selector starts with the element's generated class. */
const rulesOf = (element: Element) => {
  const generated = Array.from(element.classList).find((name) => name.startsWith('css-'))
  // Guard the guard: without a generated class the search runs over nothing.
  expect(generated).toBeTruthy()
  return stylesheet().filter((rule) => rule.startsWith(`.${generated}`))
}

const zoneOf = (slot: string) =>
  document.querySelector(`[data-widget-zone="${slot}"]`) as HTMLElement | null

/**
 * A computed margin. jsdom answers an empty string for a property no rule
 * sets rather than its initial value, and the initial value of a margin is 0.
 */
const margin = (value: string) => value || '0px'

beforeEach(() => {
  mockRegistered = {}
})

describe('a stacked zone spaces its cards', () => {
  it('draws Billing → Usage\'s four AI cards in one stack, 24px apart', () => {
    mockRegistered.orgBillingUsage = [
      card('ai-credits'),
      card('ai-credits-overage'),
      card('ai-usage-by-member'),
      card('ai-allotments'),
    ]
    render(<PluginWidgetSlot slot="orgBillingUsage" orgId="org-1" />)
    const zone = zoneOf('orgBillingUsage')
    expect(zone).not.toBeNull()
    // The cards are the zone's own children, not loose siblings of the page.
    expect(Array.from(zone!.children).map((child) => child.getAttribute('data-card'))).toEqual([
      'ai-credits',
      'ai-credits-overage',
      'ai-usage-by-member',
      'ai-allotments',
    ])
    expect(rulesOf(zone!)).toContain(
      `.${Array.from(zone!.classList).find((name) => name.startsWith('css-'))}>:not(style)~:not(style) {margin-top: 24px;}`,
    )
    const margins = Array.from(zone!.children).map((child) => margin(getComputedStyle(child).marginTop))
    expect(margins).toEqual(['0px', '24px', '24px', '24px'])
  })

  it('takes the gap from the theme, not from a pixel count', () => {
    mockRegistered.orgBillingUsage = [card('a'), card('b')]
    render(
      <ThemeProvider theme={createTheme({ spacing: 5 })}>
        <PluginWidgetSlot slot="orgBillingUsage" />
      </ThemeProvider>,
    )
    const second = document.querySelector('[data-card="b"]') as HTMLElement
    expect(getComputedStyle(second).marginTop).toBe(`${5 * WIDGET_ZONE_SPACING}px`)
  })
})

describe('a stacked zone keeps the same gap from the page\'s own cards', () => {
  const page = (before: boolean, after: boolean) => {
    mockRegistered.orgSites = [card('ai-site-batch')]
    render(
      <main>
        {before ? <section data-testid="before">{'page card'}</section> : null}
        <PluginWidgetSlot slot="orgSites" hostId={null} />
        {after ? <section data-testid="after">{'site grid'}</section> : null}
      </main>,
    )
    const zone = zoneOf('orgSites') as HTMLElement
    return {
      top: margin(getComputedStyle(zone).marginTop),
      bottom: margin(getComputedStyle(zone).marginBottom),
    }
  }

  it('sets the sites page\'s AI card 24px above the site grid', () => {
    expect(page(false, true)).toEqual({ top: '0px', bottom: '24px' })
  })

  it('sets a zone between two page cards 24px from each', () => {
    expect(page(true, true)).toEqual({ top: '24px', bottom: '24px' })
  })

  it('adds nothing at the edges: no gap above a zone that leads, none below one that ends', () => {
    expect(page(true, false)).toEqual({ top: '24px', bottom: '0px' })
  })

  it('CONTROL: a zone alone in its container carries no margin at all', () => {
    expect(page(false, false)).toEqual({ top: '0px', bottom: '0px' })
  })

  it('weighs no more than its own class, so a parent Stack\'s reset wins and its own gap is the only one', () => {
    // A MUI Stack zeroes its children's margins with
    // `>:not(style):not(style)`, one class and two type selectors, and then
    // spaces them itself. The zone's rules must weigh less than that, which
    // means nothing outside `:where()` but the zone's single class. jsdom
    // cannot resolve the contest, so the selectors are pinned exactly.
    mockRegistered.hostActivity = [card('activity')]
    render(
      <Stack spacing={3}>
        <section>{'page card'}</section>
        <PluginWidgetSlot slot="hostActivity" hostId="host-1" />
        <section>{'page card'}</section>
      </Stack>,
    )
    const zone = zoneOf('hostActivity') as HTMLElement
    const generated = Array.from(zone.classList).find((name) => name.startsWith('css-'))
    const rules = rulesOf(zone)
    expect(rules).toContain(`.${generated}:where(:not(:first-child)) {margin-top: 24px;}`)
    expect(rules).toContain(`.${generated}:where(:not(:last-child)) {margin-bottom: 24px;}`)
    const parent = zone.parentElement as HTMLElement
    const parentClass = Array.from(parent.classList).find((name) => name.startsWith('css-'))
    expect(stylesheet()).toContain(`.${parentClass}>:not(style):not(style) {margin: 0;}`)
  })
})

describe('a zone with nothing to draw', () => {
  it('draws no element when no widget survives the gates, so a page can hide the empty item', () => {
    const { container } = render(<PluginWidgetSlot slot="orgBillingOverview" orgId="org-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('hides a stack whose widgets all rendered nothing', () => {
    mockRegistered.orgBillingOverview = [
      { widgetId: 'released-later', Component: Nothing },
      { widgetId: 'also-later', Component: Nothing },
    ]
    render(<PluginWidgetSlot slot="orgBillingOverview" orgId="org-1" />)
    const zone = zoneOf('orgBillingOverview') as HTMLElement
    expect(zone.childNodes).toHaveLength(0)
    expect(getComputedStyle(zone).display).toBe('none')
    // No room and no margin: the margins are the zone's own class's rules, and
    // `display: none` takes the box and its margins with it.
    const generated = Array.from(zone.classList).find((name) => name.startsWith('css-'))
    expect(rulesOf(zone)).toContain(`.${generated}:empty {display: none;}`)
  })

  it('marks the stack as a frame, so a card grid hides the item holding it (AGL-3050)', () => {
    // `GridItems masonry` and `CardColumns` hide an item whose one element is
    // a marked frame that drew nothing. Unmarked, an empty zone would leave its
    // item behind with a gap on both sides.
    mockRegistered.orgBillingOverview = [{ widgetId: 'released-later', Component: Nothing }]
    render(<PluginWidgetSlot slot="orgBillingOverview" orgId="org-1" />)
    expect(zoneOf('orgBillingOverview')?.hasAttribute(ABSENT_WHEN_EMPTY_ATTRIBUTE)).toBe(true)
  })

  it('CONTROL: a stack with a card to draw is laid out', () => {
    mockRegistered.orgBillingOverview = [
      { widgetId: 'released-later', Component: Nothing },
      card('drawn'),
    ]
    render(<PluginWidgetSlot slot="orgBillingOverview" orgId="org-1" />)
    expect(getComputedStyle(zoneOf('orgBillingOverview') as HTMLElement).display).toBe('flex')
  })
})

describe('a bare zone hands each widget to the page\'s own layout', () => {
  it('leaves the host dashboard\'s tiles as items of its grid', () => {
    mockRegistered.hostDashboard = [card('crm'), card('inbox'), card('marketing')]
    render(
      <div data-testid="capability-grid">
        <PluginWidgetSlot slot={CONSOLE_WIDGET_SLOTS.hostDashboard} hostId="host-1" />
      </div>,
    )
    const grid = screen.getByTestId('capability-grid')
    expect(Array.from(grid.children).map((child) => child.getAttribute('data-card'))).toEqual([
      'crm',
      'inbox',
      'marketing',
    ])
    expect(zoneOf('hostDashboard')).toBeNull()
  })

  it('leaves a header action beside the page\'s own buttons', () => {
    function DescribeButton() {
      return <button type="button">{'Describe a page'}</button>
    }
    mockRegistered.hostScreens = [{ widgetId: 'describe', Component: DescribeButton }]
    render(
      <Stack direction="row" spacing={1} data-testid="actions">
        <PluginWidgetSlot slot="hostScreens" hostId="host-1" />
        <button type="button">{'Templates'}</button>
      </Stack>,
    )
    expect(
      Array.from(screen.getByTestId('actions').children).map((child) => child.textContent),
    ).toEqual(['Describe a page', 'Templates'])
  })
})

describe('every zone says how it places its widgets', () => {
  it('names a layout for every zone in the catalog, and for nothing else', () => {
    const catalog = Object.values(CONSOLE_WIDGET_SLOTS).sort()
    expect(Object.keys(WIDGET_ZONE_LAYOUTS).sort()).toEqual(catalog)
    for (const zone of catalog) {
      expect(['stack', 'bare']).toContain(WIDGET_ZONE_LAYOUTS[zone])
    }
  })

  it('stacks the zones the owner saw flush, and every card zone beside them', () => {
    for (const zone of [
      'orgBillingUsage',
      'orgBillingOverview',
      'orgSites',
      'hostSeo',
      'hostTheme',
      'orgMember',
      'staffOrg',
      'staffUser',
      'hostActivity',
      'recordInsights',
    ]) {
      expect(`${zone}: ${widgetZoneLayout(zone)}`).toBe(`${zone}: stack`)
    }
  })

  it('leaves the zones whose page lays out each widget bare', () => {
    for (const zone of [
      'hostDashboard',
      'commerceGlance',
      'orgDashboard',
      'hostScreens',
      'hostTemplates',
      'hostLayouts',
      'hostForms',
      'hostComponents',
      'hostAutomations',
      'automationEditor',
      'automationRun',
      'productEditor',
      'productsHub',
      'productImport',
      'recordEmail',
      'importMapping',
      'besignerToolbar',
      'besignerInspector',
      'seoFields',
      'assistPanel',
    ]) {
      expect(`${zone}: ${widgetZoneLayout(zone)}`).toBe(`${zone}: bare`)
    }
  })

  it('stacks a zone outside the catalog', () => {
    expect(widgetZoneLayout('pluginSiteSet')).toBe('stack')
  })
})
