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

import { listConsoleWidgets } from '@aglyn/aglyn'
import type { ComponentType } from 'react'
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
  const resolved = slots.flatMap((slot) =>
    listConsoleWidgets(slot, enabledPluginIds).map(({ extension, widget }) => ({
      // The extension's flag AND the widget's own (AGL-2611), exactly as
      // the permission below composes: a card gated narrower than its
      // extension — the CRM's dashboard cards, on a plan that has the
      // contacts list and not the suite — is absent, without an upsell.
      entitlement: composeExtensionEntitlements(
        resolveExtensionEntitlement(extension.featureFlag, org, orgReady),
        resolveExtensionEntitlement(widget.featureFlag, org, orgReady),
      ),
      // The extension's requirement AND the widget's own, exactly as a nav
      // item composes with its extension's: a card cannot escape its
      // extension's gate by declaring a key its reader happens to hold.
      permission: resolveExtensionPermission(
        requiredExtensionPermissions(extension, widget),
        answers,
      ),
      widget: {
        slot,
        widgetId: widget.widgetId,
        title: widget.title ?? extension.displayName ?? widget.widgetId,
        Component: widget.Component,
      },
    })),
  )
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
     * without consulting `loaded` at all.
     */
    ready: orgReady && resolved.every((entry) => entry.permission !== 'pending'),
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
 */
export default function PluginWidgetSlot({
  slot,
  ...props
}: { slot: string } & Record<string, unknown>) {
  const { widgets } = useSlotWidgets([slot])
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
  return (
    <>
      {arranged.map((widget) => (
        <widget.Component key={widget.widgetId} {...props} />
      ))}
    </>
  )
}
