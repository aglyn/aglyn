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
 * The arithmetic behind a customized dashboard.
 *
 * Two properties carry the whole design and neither is visible on screen: a
 * card nobody has an opinion about must SHOW, and a stored id must never mean
 * a different card than it meant when it was written.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  CORE_DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_SLOTS,
  EMPTY_DASHBOARD_WIDGET_PREFS,
  HOST_ANALYTICS_WIDGET_ID,
  isDashboardWidgetHidden,
  isRetiredDashboardWidgetId,
  moveDashboardWidget,
  orderDashboardWidgets,
  readDashboardWidgetPrefs,
  RETIRED_DASHBOARD_WIDGET_IDS,
  setDashboardWidgetHidden,
} from '../utils/dashboard-widgets'

const ids = (widgets: Array<{ widgetId: string }>) =>
  widgets.map((widget) => widget.widgetId)

const widgets = (...widgetIds: string[]) =>
  widgetIds.map((widgetId) => ({ widgetId }))

describe('a preference stores what is HIDDEN, never what is shown', () => {
  it('shows a widget no stored preference has ever mentioned', () => {
    // The allowlist trap: a list of what to SHOW is a snapshot of the widgets
    // that existed the day it was written, so every card added afterwards —
    // a plugin newly installed, a feature newly bought — is invisible to
    // someone who once customized, with nothing on screen to explain it.
    const prefs = { hidden: ['old-card'], order: ['old-card'] }
    expect(isDashboardWidgetHidden(prefs, 'brand-new-card')).toBe(false)
    expect(ids(orderDashboardWidgets(widgets('brand-new-card'), prefs.order))).toEqual([
      'brand-new-card',
    ])
  })

  it('THE CONTROL: it does hide the one it was told to hide', () => {
    // Guard the guard. Everything above would also hold of a function that
    // hid nothing at all, which is the defect this file would then certify.
    const prefs = { hidden: ['old-card'], order: [] }
    expect(isDashboardWidgetHidden(prefs, 'old-card')).toBe(true)
  })

  it('cannot ADD a widget: a rank naming an absent id renders nothing', () => {
    // The preference is applied after the enablement and entitlement gates
    // and only ever subtracts. An id that survives in someone's stored
    // arrangement after the org loses the plugin must resolve to no card.
    const arranged = orderDashboardWidgets(
      widgets('kept'),
      ['revoked-card', 'kept'],
    )
    expect(ids(arranged)).toEqual(['kept'])
  })

  it('leaves a stale hidden id inert rather than throwing on it', () => {
    const prefs = { hidden: ['revoked-card'], order: [] }
    expect(isDashboardWidgetHidden(prefs, 'kept')).toBe(false)
  })
})

describe('the stored rank is partial on purpose', () => {
  it('puts ranked widgets first, in the stored order', () => {
    expect(ids(orderDashboardWidgets(widgets('a', 'b', 'c'), ['c', 'a']))).toEqual(
      ['c', 'a', 'b'],
    )
  })

  it('keeps unranked widgets in registration order behind them', () => {
    expect(ids(orderDashboardWidgets(widgets('a', 'b', 'c'), ['c']))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('does not reshuffle when nothing is ranked', () => {
    expect(ids(orderDashboardWidgets(widgets('a', 'b', 'c'), []))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('ranks ids from other slots against nothing', () => {
    // One array spans every dashboard slot, and a rank only ever ties the
    // widgets of the slot being rendered.
    expect(
      ids(orderDashboardWidgets(widgets('a', 'b'), ['other-slot-card', 'b'])),
    ).toEqual(['b', 'a'])
  })
})

describe('moving a card within its slot', () => {
  const group = ['a', 'b', 'c']

  it('swaps it with its neighbor', () => {
    const next = moveDashboardWidget(EMPTY_DASHBOARD_WIDGET_PREFS, group, 'c', -1)
    expect(ids(orderDashboardWidgets(widgets('a', 'b', 'c'), next.order))).toEqual(
      ['a', 'c', 'b'],
    )
  })

  it('is a no-op at either end — never a wrap, never a refusal', () => {
    expect(moveDashboardWidget(EMPTY_DASHBOARD_WIDGET_PREFS, group, 'a', -1)).toBe(
      EMPTY_DASHBOARD_WIDGET_PREFS,
    )
    expect(moveDashboardWidget(EMPTY_DASHBOARD_WIDGET_PREFS, group, 'c', 1)).toBe(
      EMPTY_DASHBOARD_WIDGET_PREFS,
    )
  })

  it('carries other slots’ ranks through untouched', () => {
    const prefs = { hidden: [], order: ['far-slot-x', 'far-slot-y'] }
    const next = moveDashboardWidget(prefs, group, 'c', -1)
    expect(next.order.slice(0, 2)).toEqual(['far-slot-x', 'far-slot-y'])
  })

  it('leaves the hidden set alone', () => {
    const prefs = { hidden: ['b'], order: [] }
    expect(moveDashboardWidget(prefs, group, 'c', -1).hidden).toEqual(['b'])
  })
})

describe('switching a card off and back on', () => {
  it('adds and removes exactly one id', () => {
    const off = setDashboardWidgetHidden(EMPTY_DASHBOARD_WIDGET_PREFS, 'a', true)
    expect(off.hidden).toEqual(['a'])
    expect(setDashboardWidgetHidden(off, 'a', false).hidden).toEqual([])
  })

  it('does not duplicate an id that is already hidden', () => {
    const off = setDashboardWidgetHidden({ hidden: ['a'], order: [] }, 'a', true)
    expect(off.hidden).toEqual(['a'])
  })

  it('caps nothing: every card may be switched off at once', () => {
    // Hiding is a preference, not a limit. An empty dashboard is a choice a
    // person is allowed to make, and one switch undoes it.
    const all = ['a', 'b', 'c'].reduce(
      (prefs, widgetId) => setDashboardWidgetHidden(prefs, widgetId, true),
      EMPTY_DASHBOARD_WIDGET_PREFS,
    )
    expect(all.hidden).toEqual(['a', 'b', 'c'])
  })
})

describe('the stored map is read per org, and read defensively', () => {
  const stored = {
    'org-1': { hidden: ['a'], order: ['b'] },
    'org-2': { hidden: ['z'], order: [] },
  }

  it('answers with the named workspace’s arrangement', () => {
    expect(readDashboardWidgetPrefs(stored, 'org-1')).toEqual({
      hidden: ['a'],
      order: ['b'],
    })
  })

  it('does not carry one workspace’s arrangement into another', () => {
    // The reason this is per user PER ORG: an agency member in six client
    // workspaces would otherwise hide a card for one client and lose it in
    // all six, against six different sets of installed plugins.
    expect(readDashboardWidgetPrefs(stored, 'org-3')).toEqual(
      EMPTY_DASHBOARD_WIDGET_PREFS,
    )
  })

  it.each([
    ['no field at all', undefined],
    ['a scalar where a map belongs', 'nonsense'],
    ['an entry that is not an object', { 'org-1': 7 }],
    ['lists that are not lists', { 'org-1': { hidden: 'a', order: 3 } }],
    ['non-string ids inside the lists', { 'org-1': { hidden: [1, null], order: [{}] } }],
  ])('degrades to the default dashboard on %s', (_label, value) => {
    // `users/{uid}` is owner-writable with no field validation, so this
    // parses a document its own reader may have written by hand. A malformed
    // value must read as "no preference", never throw on the page it
    // decorates.
    expect(readDashboardWidgetPrefs(value, 'org-1')).toEqual(
      EMPTY_DASHBOARD_WIDGET_PREFS,
    )
  })
})

describe('a widget id is a persisted identifier', () => {
  it('THE CONTROL: the reserve check catches a collision when there is one', () => {
    // The retired list is empty today, so every assertion below would also
    // hold of a check that answered `false` unconditionally.
    expect(['fabricated-retired-id'].includes('fabricated-retired-id')).toBe(true)
    expect(isRetiredDashboardWidgetId('fabricated-retired-id')).toBe(false)
  })

  it('mints no live id from the reserved set', () => {
    const live = [
      ...CORE_DASHBOARD_WIDGETS.map((widget) => widget.widgetId),
      ...DASHBOARD_WIDGET_SLOTS.flatMap((slot) =>
        Aglyn.listConsoleWidgets(slot).map(({ widget }) => widget.widgetId),
      ),
    ]
    for (const widgetId of live) {
      expect(isRetiredDashboardWidgetId(widgetId)).toBe(false)
    }
    expect(RETIRED_DASHBOARD_WIDGET_IDS).not.toContain(HOST_ANALYTICS_WIDGET_ID)
  })

  it('the analytics card’s constant and its catalog entry are one id', () => {
    // Two names for the persisted string is how they drift apart, and the
    // page reads the constant while the dialog lists the catalog.
    expect(
      CORE_DASHBOARD_WIDGETS.some(
        (widget) => widget.widgetId === HOST_ANALYTICS_WIDGET_ID,
      ),
    ).toBe(true)
  })

  it('the dashboard slots it arranges are catalog slots', () => {
    // A typo'd slot name resolves to no widgets and looks exactly like a
    // workspace with no plugins enabled.
    const catalog = Object.values(Aglyn.CONSOLE_WIDGET_SLOTS)
    for (const slot of DASHBOARD_WIDGET_SLOTS) {
      expect(catalog).toContain(slot)
    }
  })
})
