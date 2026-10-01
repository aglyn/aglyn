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
  CONSOLE_SEARCH_LOAD_POINT,
  listConsoleSearchSources,
} from '@aglyn/aglyn'
import { useMemo } from 'react'
import { useEnabledPluginIds } from '../console-plugins-gate.component'
import { useConsoleSlotPlugins } from '../../hooks/use-console-plugins'
import { useOrgPermissions } from '../../hooks/use-org-permissions'
import {
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
} from '../../utils/extension-entitlement'
import {
  requiredExtensionPermissions,
  resolveExtensionPermission,
} from '../../utils/extension-permission'
import { type GlobalSearchEntityDef, searchSourceEntity } from './global-search-scope'

/**
 * The groups plugins contribute to the palette that the reader may open here
 * (AGL-3080).
 *
 * The palette offers a plugin's records only where its pages would open:
 * the plugin on for the workspace and the site (`useEnabledPluginIds`, which
 * also applies the release flags), the extension's plan flag and the
 * source's held, and the extension's permission and the source's granted —
 * the gates a widget of the same extension passes. A group the reader would
 * be refused at is never read, because a row linking there is a dead row.
 *
 * An unsettled answer withholds the group rather than guessing: the org and
 * the member read both land within the first second, and a group that
 * appears then is better than one read for a reader it turns out to refuse.
 *
 * The plugins declaring the palette's load point are loaded when it opens, so
 * a plugin that is not already drawn by the shell still contributes.
 */
export function useGlobalSearchSources(
  org: unknown,
  orgReady: boolean,
): readonly GlobalSearchEntityDef[] {
  const loaded = useConsoleSlotPlugins([CONSOLE_SEARCH_LOAD_POINT])
  const enabledPluginIds = useEnabledPluginIds()
  const { can, permissions, loaded: permissionsLoaded } = useOrgPermissions()
  return useMemo(() => {
    // Read so the list is taken again once the load point's plugins have
    // registered: the registry is a module global React cannot see change.
    void loaded
    const answers = { can, permissions, loaded: permissionsLoaded }
    return listConsoleSearchSources(enabledPluginIds)
      .filter(
        ({ extension, source }) =>
          composeExtensionEntitlements(
            resolveExtensionEntitlement(extension.featureFlag, org, orgReady),
            resolveExtensionEntitlement(source.featureFlag, org, orgReady),
          ) === 'entitled' &&
          resolveExtensionPermission(
            requiredExtensionPermissions(extension, source),
            answers,
          ) === 'granted',
      )
      .map(({ source }) => searchSourceEntity(source))
  }, [loaded, enabledPluginIds, org, orgReady, can, permissions, permissionsLoaded])
}

export default useGlobalSearchSources
