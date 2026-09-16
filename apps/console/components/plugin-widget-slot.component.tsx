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
'use client'

import {
  isConsoleStaffWidgetSlot,
  listConsoleWidgets,
  type ConsoleWidgetColumn,
  type ConsoleWidgetSlot,
} from '@aglyn/aglyn'
import { ABSENT_WHEN_EMPTY } from '@aglyn/shared-ui-jsx/components/grid-items'
import { Stack } from '@mui/material'
import type { ComponentType } from 'react'
import { STAFF_PLUGIN_IDS } from '../constants/staff-plugins'
import { useEnabledPluginIds } from './console-plugins-gate.component'
import { useDashboardWidgetPrefs } from './dashboard-widget-prefs.context'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgPermissions from '../hooks/use-org-permissions'
import {
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
} from '../utils/extension-entitlement'
import {
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from '../utils/extension-permission'
import {
  isDashboardWidgetHidden,
  orderDashboardWidgets,
} from '../utils/dashboard-widgets'

/**
 * The gap a console page puts between two of its cards, in theme spacing
 * units: every page's `Stack spacing={3}` and card grid `spacing={3}`.
 */
export const WIDGET_ZONE_SPACING = 3

/**
 * How a zone places the widgets it renders (AGL-3044).
 *
 * - `stack`: the zone is one block of the page. Its widgets are cards,
 *   stacked with {@link WIDGET_ZONE_SPACING} between them, and the zone keeps
 *   the same gap from the page's own cards beside it.
 * - `bare`: every widget is one item of a layout the PAGE draws: a tile of a
 *   dashboard grid, a control in a toolbar or a row of actions, a panel among
 *   a form's fields, the body of a page, a column of a table. The page spaces
 *   those items, so the zone adds no element of its own. A wrapper would put
 *   every tile of a grid into one track and every button of a row into one
 *   column.
 */
export type WidgetZoneLayout = 'stack' | 'bare'

/**
 * Every zone in the catalog, and how it places its widgets.
 *
 * Typed against the catalog, so a zone added to `CONSOLE_WIDGET_SLOTS` does
 * not compile until it is given a layout here. A zone outside the catalog
 * (`slot` is an open string) is a `stack`, the shape most zones have.
 */
export const WIDGET_ZONE_LAYOUTS: Readonly<
  Record<ConsoleWidgetSlot, WidgetZoneLayout>
> = {
  hostActivity: 'stack',
  // Tiles of the host dashboard's capability grid, which is also where the
  // commerce glance sits.
  hostDashboard: 'bare',
  commerceGlance: 'bare',
  // Tiles of the org dashboard row's grid on the sites page.
  orgDashboard: 'bare',
  // Page and section bodies: the widget IS the surface.
  orgData: 'bare',
  marketplaceListing: 'bare',
  orgMarketplace: 'bare',
  orgAddons: 'bare',
  // The body of the ƒx dialog, which spaces its own contents.
  besignerFunctions: 'bare',
  dashboardFooter: 'stack',
  orgSettings: 'stack',
  hostSettings: 'stack',
  hostTheme: 'stack',
  adminOrgDetail: 'stack',
  orgBillingUsage: 'stack',
  orgBillingOverview: 'stack',
  staffOrg: 'stack',
  staffUser: 'stack',
  // Columns of a table. The usage table's zone also draws a caption line
  // above the table, and a caption is part of the table, not a card.
  staffOrgsListColumn: 'bare',
  staffOrgUsageColumn: 'bare',
  orgMembersListColumn: 'bare',
  orgMember: 'stack',
  // The card beneath the collaborators table; its columns never render here.
  hostMembers: 'stack',
  // A floating dock, positioned by the widget itself.
  assistPanel: 'bare',
  // Controls in the besigner's Attributes panel and its toolbar.
  besignerInspector: 'bare',
  besignerToolbar: 'bare',
  // A panel among a search listing editor's own fields.
  seoFields: 'bare',
  hostSeo: 'stack',
  // A button in the screens page's row of header actions.
  hostScreens: 'bare',
  orgSites: 'stack',
}

/** The layout a zone renders its widgets in. */
export function widgetZoneLayout(slot: string): WidgetZoneLayout {
  return (
    (WIDGET_ZONE_LAYOUTS as Readonly<Record<string, WidgetZoneLayout>>)[slot] ??
    'stack'
  )
}

/**
 * How a zone that is a block of its page sits among the page's own content:
 * the gap it keeps from what is beside it, and no room at all when nothing
 * in it drew anything.
 *
 * Margins, because the page decides what a zone sits in and a zone lands in
 * pages built every way: a plain container holding one card after another,
 * a `Stack` that spaces its children, a card grid's item. A zone that owns
 * the gap in normal flow is the one place that fixes all of them, and the
 * two conditions keep it off the edges: no margin above a zone nothing
 * precedes, none below a zone nothing follows. Adjacent vertical margins
 * collapse, so a card before the zone that carries its own bottom margin
 * still leaves one gap, not two.
 *
 * `:where()` adds nothing to the selector's weight, so the rule is exactly
 * as specific as the zone's own class. A MUI `Stack` resets its children's
 * margins with `> :not(style):not(style)`, which weighs more, and then
 * spaces them itself: a zone inside a spacing parent takes that parent's
 * gap instead of adding a second one. A flex or grid container that spaces
 * its children with `gap` has no such reset, and a stack zone must not be a
 * direct child of one among siblings; the zones that sit in those are
 * `bare`.
 *
 * A block whose widgets all drew nothing is `:empty`, and hides: it takes no
 * room and carries no margin.
 */
export const WIDGET_ZONE_BLOCK = {
  '&:where(:not(:first-child))': { mt: WIDGET_ZONE_SPACING },
  '&:where(:not(:last-child))': { mb: WIDGET_ZONE_SPACING },
  '&:empty': { display: 'none' },
} as const

/** A widget that survived the enablement and entitlement gates. */
export interface EntitledSlotWidget {
  slot: string
  widgetId: string
  /**
   * What to call this card where it is listed rather than rendered — the
   * customize dialog. The widget's own `title`, else the name of the
   * extension that registered it; a card with neither is listed by its id,
   * which is ugly and still better than an unnamed switch.
   */
  title: string
  /** Present when the widget is a table column rather than a card (AGL-2940). */
  column?: ConsoleWidgetColumn
  Component: ComponentType<any>
}

/**
 * The widgets a slot may render for the current workspace: registered for
 * the slot, enabled for this org and site, ENTITLED (AGL-2484) and PERMITTED.
 *
 * ## The permission gate, and why it is here rather than in the widget
 *
 * This resolved entitlement and nothing else, so a plugin card appeared
 * wherever its slot was rendered no matter who was looking. Entitlement is a
 * fact about the ORGANIZATION; it says nothing about the person, and the two
 * surfaces that mount extension code have to answer both questions or the
 * answer is whichever one each extension remembered to ask itself — which is
 * exactly the position AGL-2484 found the entitlement half in.
 *
 * A card is the worst place to leave that to the extension. It is dropped
 * onto a page the reader opened for something else, so the widget has already
 * mounted and opened its listeners before any check it runs on itself could
 * fire, and there is nowhere in a card to put a refusal anyone would read. So
 * the gate is HERE, ahead of construction, and a card its reader may not have
 * is simply absent — the same treatment, in the same place, as an unentitled
 * one.
 *
 * `pending` is withheld like an unsettled entitlement is, and for the same
 * reason: `useOrgPermissions` answers the permissive admin map while the
 * member document is in flight, so "not yet known" and "granted" are one
 * value in it, and rendering from that is the leak this closes.
 *
 * Shared with the dashboard's customize dialog, which has to list exactly the
 * cards the slot would render and no others. Resolving that separately would
 * be a second gate answering the same question, and the dialog is the surface
 * where a mistake shows least: an entry for a card the org cannot have is a
 * switch that appears to do nothing.
 *
 * `pending` is withheld rather than rendered. A widget appearing a beat late
 * costs a paint; a paid widget rendering during the window before the plan is
 * known is the leak this exists to close.
 */
export function useSlotWidgets(slots: readonly string[]): {
  widgets: EntitledSlotWidget[]
  ready: boolean
} {
  // Scoped to this workspace's plugins (AGL-758) — the registry is a
  // session-wide union across every org visited.
  const enabledPluginIds = useEnabledPluginIds()
  const { org, ready: orgReady } = useCurrentOrg()
  /**
   * ONE resolution for every slot on the page, from `OrgPermissionsProvider`
   * in `firebase-app.layout.tsx`.
   *
   * An unshared `useOrgPermissions` costs two `getDoc`s per call, and this
   * hook runs once per mounted slot: the host dashboard mounts four of them
   * plus the customize dialog, so gating them without sharing the resolution
   * makes a page that reads the member document twice read it ten times.
   * Under the provider this call reads context and issues nothing.
   */
  const { can, permissions, loaded: permissionsLoaded } = useOrgPermissions()
  const answers = { can, permissions, loaded: permissionsLoaded }
  const resolved = slots.flatMap((slot) => {
    /*
     * A staff zone (AGL-2939) names no workspace: its widgets come from the
     * plugins the staff area loaded, and neither gate below applies, because
     * both answer for the workspace the reader happens to have open rather
     * than for the org or account the staff page is about. The staff area's
     * guard is what admits the reader.
     */
    const staff = isConsoleStaffWidgetSlot(slot)
    return listConsoleWidgets(slot, staff ? STAFF_PLUGIN_IDS : enabledPluginIds).map(
      ({ extension, widget }) => ({
        staff,
        // The extension's flag AND the widget's own (AGL-2611), exactly as
        // the permission below composes: a card gated narrower than its
        // extension, on a plan that has the extension and not the card's
        // entitlement, is absent, without an upsell.
        entitlement: staff
          ? ('entitled' as const)
          : composeExtensionEntitlements(
              resolveExtensionEntitlement(extension.featureFlag, org, orgReady),
              resolveExtensionEntitlement(widget.featureFlag, org, orgReady),
            ),
        // The extension's requirement AND the widget's own, exactly as a nav
        // item composes with its extension's: a card cannot escape its
        // extension's gate by declaring a key its reader happens to hold.
        permission: staff
          ? ('granted' as const)
          : resolveExtensionPermission(
              requiredExtensionPermissions(extension, widget),
              answers,
            ),
        widget: {
          slot,
          widgetId: widget.widgetId,
          title: widget.title ?? extension.displayName ?? widget.widgetId,
          column: widget.column,
          Component: widget.Component,
        },
      }),
    )
  })
  return {
    widgets: resolved
      .filter(
        (entry) =>
          entry.entitlement === 'entitled' && entry.permission === 'granted',
      )
      .map((entry) => entry.widget),
    /**
     * Both gates have settled, not just the org read.
     *
     * The customize dialog lists what the slot WOULD render, so answering
     * `ready` while a card is still `pending` on the member document tells it
     * the list is final and then grows it — a switch appearing under the
     * reader's cursor. A slot whose widgets declare no permission never waits:
     * `resolveExtensionPermission` returns `granted` for an empty requirement
     * without consulting `loaded` at all. Staff zones wait on neither: the
     * org read is not theirs, and the staff area loaded their plugins before
     * the page rendered.
     */
    ready:
      (orgReady ||
        (slots.length > 0 && slots.every((slot) => isConsoleStaffWidgetSlot(slot)))) &&
      resolved.every((entry) => entry.staff || entry.permission !== 'pending'),
  }
}

/**
 * Renders every plugin widget registered for a named slot (AGL-419) —
 * the shell owns placement, the plugins own the UI, and the app never
 * imports a plugin. Extra props pass straight through to each widget.
 *
 * ENTITLED widgets only (AGL-2484). This used to render every registered
 * widget for the slot, which made the shell's "extensions cannot bypass
 * entitlements" contract a matter of each widget policing itself. A widget
 * is a card dropped into someone else's page, so there is nowhere here to
 * put an upsell: an unentitled surface is simply absent, and the upgrade
 * path stays where it has always been, on the feature's own page and in
 * Billing.
 *
 * Inside a `DashboardWidgetPrefsProvider` the reader's own arrangement is
 * applied on top: hidden cards are dropped and the rest are ranked. It is
 * applied STRICTLY AFTER the gates above and can only ever subtract, so no
 * stored value reaches the entitlement decision — the preference chooses
 * among the cards the gate already passed. Off the dashboard there is no
 * provider and the hook answers inert, which is why every other surface
 * rendering this slot neither filters nor reads anything.
 *
 * ## Spacing (AGL-3044)
 *
 * The zone spaces what it renders, in the layout {@link WIDGET_ZONE_LAYOUTS}
 * names for it, so no page has to. A `stack` zone draws its cards in one
 * `Stack` with the gap a page puts between its own cards, and sits among the
 * page's cards as {@link WIDGET_ZONE_BLOCK} describes. Loose siblings would
 * take whatever spacing the page's container happens to give: none in a card
 * grid's item or a plain container, which draws the cards edge to edge. A
 * widget renders no outer margin of its own; the zone's `Stack` resets one if
 * it does.
 *
 * Nothing is drawn when no widget survives the gates, so a page that hides
 * an empty item (`GridItems masonry`, `CardColumns`) still sees an empty
 * item. A stack whose widgets all rendered nothing is `:empty` and hides, and
 * it carries the {@link ABSENT_WHEN_EMPTY} mark, so the item holding it hides
 * as well.
 */
export default function PluginWidgetSlot({
  slot,
  ...props
}: { slot: string } & Record<string, unknown>) {
  // A widget that declares a `column` is a table cell, drawn once per row by
  // the table that reads the zone through `usePluginListColumns`. Rendered
  // here it would be a cell with no row, loose beneath the table.
  const { widgets: registered } = useSlotWidgets([slot])
  const widgets = registered.filter((widget) => widget.column === undefined)
  const { prefs, ready: prefsReady, customizable } = useDashboardWidgetPrefs()
  const arranged = customizable
    ? orderDashboardWidgets(
        widgets.filter(
          (widget) => !isDashboardWidgetHidden(prefs, widget.widgetId),
        ),
        prefs.order,
      )
    : widgets
  // Holding a customizable slot until the arrangement arrives is what keeps a
  // hidden card from being drawn and then taken away again.
  if (customizable && !prefsReady) return null
  if (arranged.length === 0) return null
  const rendered = arranged.map((widget) => (
    <widget.Component key={widget.widgetId} {...props} />
  ))
  if (widgetZoneLayout(slot) === 'bare') return <>{rendered}</>
  return (
    <Stack
      spacing={WIDGET_ZONE_SPACING}
      data-widget-zone={slot}
      {...ABSENT_WHEN_EMPTY}
      sx={WIDGET_ZONE_BLOCK}
    >
      {rendered}
    </Stack>
  )
}
