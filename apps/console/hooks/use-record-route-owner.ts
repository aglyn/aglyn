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

import { listConsoleExtensions } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { pluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { useEnabledPluginIds } from '../components/console-plugins-gate.component'
import {
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
} from '../utils/extension-entitlement'
import {
  composeExtensionPermissions,
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from '../utils/extension-permission'
import useCurrentOrg from './use-current-org'
import useOrgPermissions from './use-org-permissions'

/** The plugin a console link to a record kind lands in, as a reader sees it. */
export interface RecordRouteOwner {
  pluginId: string
  /** What the owner's console surfaces are called — "Open in …". */
  displayName: string
}

/**
 * Who a link to a record kind would land the reader with, or `null` when the
 * console should not offer the link at all.
 *
 * A console page that is not a record's own links to it through the record
 * route the owning plugin publishes (`pluginRecordHref` and its siblings),
 * and the registry knows nothing about the reader: a link is not access. But
 * a row action that lands on the shell's refusal is a link to a page that
 * says no, so a page offering one asks first whether the owner's surfaces
 * would let this reader in — the same gates the shell applies to that
 * plugin's pages and widgets:
 *
 * - a plugin publishes the kind, and that plugin is on for this workspace and
 *   site (the registry is a session-wide union, so a route registered while
 *   another workspace was open does not count);
 * - the workspace's plan carries what the owner's console extension requires;
 * - the reader holds the permission it declares.
 *
 * `null` while any of that is still loading, so the link appears once rather
 * than appearing and being taken away.
 */
export function useRecordRouteOwner(kind: string): RecordRouteOwner | null {
  const enabledPluginIds = useEnabledPluginIds()
  const { org, ready: orgReady } = useCurrentOrg()
  const { can, permissions, loaded } = useOrgPermissions()
  const answer = admittedOwner(
    pluginRecordRoute(kind)?.pluginId,
    enabledPluginIds,
    (featureFlag) => resolveExtensionEntitlement(featureFlag, org, orgReady),
    { can, permissions, loaded },
  )
  // One object for as long as the answer holds, so a table that builds its
  // columns from it does not rebuild them on every render.
  const pluginId = answer?.pluginId
  const displayName = answer?.displayName
  return useMemo(
    () => (pluginId && displayName ? { pluginId, displayName } : null),
    [pluginId, displayName],
  )
}

/** The owner of a kind, if this workspace runs it and its gates admit the reader. */
function admittedOwner(
  owner: string | undefined,
  enabledPluginIds: readonly string[],
  entitlementOf: (
    featureFlag: Parameters<typeof resolveExtensionEntitlement>[0],
  ) => ReturnType<typeof resolveExtensionEntitlement>,
  answers: Parameters<typeof resolveExtensionPermission>[1],
): RecordRouteOwner | null {
  if (!owner || !enabledPluginIds.includes(owner)) return null
  const extensions = listConsoleExtensions(enabledPluginIds).filter(
    (extension) => extension.pluginId === owner,
  )
  if (!extensions.length) return null
  const entitlement = composeExtensionEntitlements(
    ...extensions.map((extension) => entitlementOf(extension.featureFlag)),
  )
  const permission = composeExtensionPermissions(
    ...extensions.map((extension) =>
      resolveExtensionPermission(
        requiredExtensionPermissions(extension, undefined),
        answers,
      ),
    ),
  )
  if (entitlement !== 'entitled' || permission !== 'granted') return null
  return {
    pluginId: owner,
    displayName:
      extensions.find((extension) => extension.displayName)?.displayName ??
      owner,
  }
}

export default useRecordRouteOwner
