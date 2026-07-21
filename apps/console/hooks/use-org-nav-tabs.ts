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

import type { OrgPermission } from '@aglyn/aglyn'
import { useMemo } from 'react'
import orgNavTabItems from '../constants/org-nav-tabs'
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
 */
export function useOrgNavTabItems() {
  const { can, loaded } = useOrgPermissions()
  const orgSlug = useOrgSlug()
  return useMemo(
    () =>
      orgNavTabItems(orgSlug).filter((item) => {
        if (!loaded) return true
        const permission = TAB_PERMISSIONS[item.id]
        return !permission || can(permission)
      }),
    // `can` is stable per granted-map; loaded flips once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, can, orgSlug],
  )
}

export default useOrgNavTabItems
