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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'

/**
 * Which cards a person keeps on their host dashboard, and in what order.
 *
 * ## Hiding is a PREFERENCE, never a limit
 *
 * Nothing in this module refuses, ejects or caps. A person may hide every
 * card and be left with an empty dashboard; the data behind each card is
 * untouched and one switch brings it back. Capacity in this repo is enforced
 * at the reduction, and there is no reduction here to enforce — a hidden card
 * costs nothing and frees nothing.
 *
 * ## The preference SUBTRACTS from an already-gated list
 *
 * `PluginWidgetSlot` resolves which widgets exist for a slot from the
 * workspace's enabled plugin set and then the org's entitlements (AGL-2484),
 * and only what survives both is offered here. Everything below can do is
 * remove entries from that list and reorder what remains, which is what makes
 * a stale preference harmless: an id naming a card the org has since lost is
 * matched against nothing, and no arrangement of stored values can put a card
 * on screen that the gate did not already pass.
 */

/**
 * The dashboard slots whose widgets a person may hide and reorder, in the
 * order the dashboard page renders them.
 *
 * Ordering is applied WITHIN a slot. Widgets from two different slots sit in
 * different containers on the page — the capability grid, the full-width
 * activity feed, the footer zone — so a rank spanning them would describe a
 * layout the dashboard cannot draw.
 */
export const DASHBOARD_WIDGET_SLOTS: readonly string[] = [
  CONSOLE_WIDGET_SLOTS.commerceGlance,
  CONSOLE_WIDGET_SLOTS.hostDashboard,
  CONSOLE_WIDGET_SLOTS.hostActivity,
  CONSOLE_WIDGET_SLOTS.dashboardFooter,
]

/**
 * A dashboard card the console itself renders rather than the widget
 * registry, and its permanent id.
 *
 * `Traffic` is here because no plugin owns site analytics and no entitlement
 * gates it, so registering it would mean inventing a plugin id and a vacuous
 * feature flag purely to make it hideable. Hiding is not entitlement, and it
 * does not need the registry to work: the page consults the same preference
 * for this card that the slot consults for the rest.
 */
export const CORE_DASHBOARD_WIDGETS: ReadonlyArray<{
  widgetId: string
  title: string
}> = [{ widgetId: 'core-host-analytics', title: 'Traffic' }]

/** The `Traffic` card's persisted id, for the page that renders it. */
export const HOST_ANALYTICS_WIDGET_ID = 'core-host-analytics'

/**
 * Widget ids that no longer name a card, and that may never be reused.
 *
 * A widget id in this file is a PERSISTED IDENTIFIER: it is written into a
 * person's stored preference and read back months later. Giving a retired id
 * to a different card therefore hands a returning reader someone else's
 * arrangement — a card they never hid, hidden. The same reasoning keeps
 * `BesignerPanelTabFlag.ELEMENT_INFO` reserved after its tab was withdrawn.
 *
 * Empty today because no dashboard card has been retired yet. Retiring one
 * means moving its id here, not deleting the id — and
 * `isRetiredDashboardWidgetId` is what a spec can then hold the next
 * registration against.
 *
 * First-party ids only. A third-party plugin owns its own id namespace and
 * this list cannot speak for it; what the console guarantees is that ITS ids
 * and the ids of the plugins it ships never change meaning.
 */
export const RETIRED_DASHBOARD_WIDGET_IDS: readonly string[] = []

/** Whether `widgetId` names a card that was withdrawn and stays reserved. */
export function isRetiredDashboardWidgetId(widgetId: string): boolean {
  return RETIRED_DASHBOARD_WIDGET_IDS.includes(widgetId)
}

export interface DashboardWidgetPrefs {
  /**
   * The ids this person switched OFF — what is HIDDEN, never what is shown.
   *
   * An allowlist would be the same data structure and a different bug. A
   * stored list of what to show is a snapshot of the widgets that existed the
   * day it was written, so every card added afterwards — a plugin newly
   * installed, a feature newly bought — arrives absent from the list and is
   * silently invisible, on a dashboard whose owner has no reason to suspect a
   * preference is involved. A deny-list has the opposite failure mode, and it
   * is the harmless one: a new card appears, and hiding it is one click.
   *
   * The empty case is also the common one. Most people never customize, and a
   * deny-list stores nothing for them.
   */
  hidden: readonly string[]
  /**
   * Ranked widget ids. Ids present here render first, in this order; anything
   * unlisted follows in registration order.
   *
   * Partial on purpose, for the same reason `hidden` is a deny-list: a total
   * order would have to name every widget, and a new card missing from it
   * would have no position. Unlisted cards land after the arranged ones,
   * which keeps an explicit arrangement intact and still shows the arrival.
   *
   * Ids from every dashboard slot share one array. A rank only ever ties
   * widgets within the slot being rendered, so ids belonging to other slots
   * simply match nothing there.
   */
  order: readonly string[]
}

export const EMPTY_DASHBOARD_WIDGET_PREFS: DashboardWidgetPrefs = {
  hidden: [],
  order: [],
}

/** Every string in `value`, or `[]` for anything else. */
function readIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * One org's preference out of the map stored on the user document.
 *
 * Tolerant by construction. This parses a document its owner may write
 * directly (`users/{uid}` is owner-writable with no field validation), and a
 * malformed value must degrade to "no preference" — the dashboard everyone
 * else sees — rather than throw on the page it decorates.
 */
export function readDashboardWidgetPrefs(
  stored: unknown,
  orgId: string | undefined,
): DashboardWidgetPrefs {
  if (!orgId || !stored || typeof stored !== 'object') {
    return EMPTY_DASHBOARD_WIDGET_PREFS
  }
  const entry = (stored as Record<string, unknown>)[orgId]
  if (!entry || typeof entry !== 'object') return EMPTY_DASHBOARD_WIDGET_PREFS
  const record = entry as Record<string, unknown>
  return { hidden: readIdList(record.hidden), order: readIdList(record.order) }
}

/** Whether this person switched `widgetId` off. */
export function isDashboardWidgetHidden(
  prefs: DashboardWidgetPrefs,
  widgetId: string,
): boolean {
  return prefs.hidden.includes(widgetId)
}

/**
 * `widgets` arranged by the stored rank: ranked ids first in stored order,
 * then everything unlisted in the order it was registered.
 *
 * The comparison keeps the registration index as a tiebreak rather than
 * relying on sort stability, so two unranked widgets cannot swap places
 * between renders and redraw the dashboard under someone mid-read.
 */
export function orderDashboardWidgets<T extends { widgetId: string }>(
  widgets: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((widgetId, index) => [widgetId, index]))
  return widgets
    .map((widget, index) => ({
      widget,
      index,
      rank: rank.has(widget.widgetId)
        ? (rank.get(widget.widgetId) as number)
        : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.widget)
}

/** The prefs with `widgetId` switched off (or back on). */
export function setDashboardWidgetHidden(
  prefs: DashboardWidgetPrefs,
  widgetId: string,
  hidden: boolean,
): DashboardWidgetPrefs {
  const without = prefs.hidden.filter((entry) => entry !== widgetId)
  return {
    ...prefs,
    hidden: hidden ? [...without, widgetId] : without,
  }
}

/**
 * The prefs with `widgetId` moved one place within its own slot group.
 *
 * `groupIds` is that slot's ids as they currently render, so the caller —
 * which is the only thing that knows what a slot resolved to — decides what
 * "one place" means. A move at either end of the group is a no-op rather than
 * a wrap or a refusal: the arrangement is already what was asked for.
 *
 * The rewritten rank names the whole group. A move only reaches ids the
 * person can see, so the ranks of other slots are carried through untouched.
 */
export function moveDashboardWidget(
  prefs: DashboardWidgetPrefs,
  groupIds: readonly string[],
  widgetId: string,
  delta: number,
): DashboardWidgetPrefs {
  const from = groupIds.indexOf(widgetId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= groupIds.length) return prefs
  const moved = [...groupIds]
  moved.splice(from, 1)
  moved.splice(to, 0, widgetId)
  const group = new Set(groupIds)
  return {
    ...prefs,
    order: [...prefs.order.filter((entry) => !group.has(entry)), ...moved],
  }
}
