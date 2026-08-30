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
import { resolveExtensionEntitlement } from '../utils/extension-entitlement'
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
 * the slot, enabled for this org and site, and ENTITLED (AGL-2484).
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
  const widgets = slots.flatMap((slot) =>
    listConsoleWidgets(slot, enabledPluginIds)
      .filter(
        ({ extension }) =>
          resolveExtensionEntitlement(extension.featureFlag, org, orgReady) ===
          'entitled',
      )
      .map(({ extension, widget }) => ({
        slot,
        widgetId: widget.widgetId,
        title: widget.title ?? extension.displayName ?? widget.widgetId,
        Component: widget.Component,
      })),
  )
  return { widgets, ready: orgReady }
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
