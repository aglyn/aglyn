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

import { listConsoleOrgNavItems, type OrgPermission } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { useEnabledPluginIds } from '../components/console-plugins-gate.component'
import orgNavTabItems from '../constants/org-nav-tabs'
import { orgPluginNavTabItems } from '../utils/org-plugin-surfaces'
import useCurrentOrg from './use-current-org'
import useOrgPermissions from './use-org-permissions'
import { useOrgSlug } from './use-org-scope'

/** Org tabs a permission gates (AGL-243); ungated tabs show for members. */
const TAB_PERMISSIONS: Record<string, OrgPermission> = {
  'nav-tab-org-billing': 'billing.view',
  'nav-tab-org-settings': 'org.settings',
}

/**
 * Permission-filtered org tab strip (AGL-243): members without billing or
 * settings permissions don't see those tabs (the pages themselves guard
 * against direct URLs). Everything shows until permissions load so the
 * strip doesn't flash narrower for admins.
 *
 * Plugin-declared org surfaces (AGL-2974) join from the registry, scoped to
 * this workspace's enabled plugins and narrowed by `orgPluginNavTabItems`,
 * which holds each one back until its own verdicts settle.
 */
export function useOrgNavTabItems() {
  const { can, permissions, loaded } = useOrgPermissions()
  const orgSlug = useOrgSlug()
  const enabledPluginIds = useEnabledPluginIds()
  const { org, ready: orgReady } = useCurrentOrg()
  return useMemo(
    () =>
      orgNavTabItems(
        orgSlug,
        orgPluginNavTabItems(orgSlug, listConsoleOrgNavItems(enabledPluginIds), {
          can,
          permissions,
          permissionsLoaded: loaded,
          org,
          orgReady,
        }),
      ).filter((item) => {
        if (!loaded) return true
        const permission = TAB_PERMISSIONS[item.id]
        return !permission || can(permission)
      }),
    [loaded, can, permissions, orgSlug, enabledPluginIds, org, orgReady],
  )
}

export default useOrgNavTabItems
