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
import { useEnabledPluginIds } from './console-plugins-gate.component'
import useCurrentOrg from '../hooks/use-current-org'
import { resolveExtensionEntitlement } from '../utils/extension-entitlement'

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
 * `pending` is withheld rather than rendered. A widget appearing a beat late
 * costs a paint; a paid widget rendering during the window before the plan
 * is known is the leak this exists to close.
 */
export default function PluginWidgetSlot({
  slot,
  ...props
}: { slot: string } & Record<string, unknown>) {
  // Scoped to this workspace's plugins (AGL-758) — the registry is a
  // session-wide union across every org visited.
  const enabledPluginIds = useEnabledPluginIds()
  const { org, ready: orgReady } = useCurrentOrg()
  return (
    <>
      {listConsoleWidgets(slot, enabledPluginIds)
        .filter(
          ({ extension }) =>
            resolveExtensionEntitlement(
              extension.featureFlag,
              org,
              orgReady,
            ) === 'entitled',
        )
        .map(({ widget }) => (
          <widget.Component key={widget.widgetId} {...props} />
        ))}
    </>
  )
}
