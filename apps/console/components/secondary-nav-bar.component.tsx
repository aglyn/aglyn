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

import { RELEASE_FLAGS, type ReleaseFlagKey } from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { Stack } from '@mui/material'
import { useMemo } from 'react'
import { useReleaseFlags } from '../hooks/use-release-flags'
import { useSecondaryNav } from '../hooks/use-secondary-nav'
import HostSwitcherNavComponent from './host-switcher-nav.component'
import SecondaryAppBarComponent from './secondary-app-bar.component'

// Nav tabs governed by a release flag (AGL-229), keyed by tab id.
const NAV_TAB_RELEASE_FLAGS = new Map(
  RELEASE_FLAGS.filter((definition) => definition.navTabId).map(
    (definition) => [definition.navTabId, definition],
  ),
)

const tabBarTitle = (
  <Stack
    direction="row"
    spacing={{ sm: 0.15, md: 0.5 }}
    sx={{
      alignItems: 'center',
      typography: 'subtitle2',
      lineHeight: 'normal',
      color: 'tertiary.main',
    }}
  >
    <HostSwitcherNavComponent />
  </Stack>
)

/**
 * The console's secondary app bar — the site switcher and the section's tab
 * strip.
 *
 * Mounted ONCE, by the `(app)` layout, and route-derived (AGL-755). It used
 * to be rendered by `DashboardLayout`, which every page mounts inside its own
 * body, so it unmounted and remounted on any navigation crossing a route
 * segment and the switcher blinked out for ~250ms each time (AGL-745). Its
 * mount point has to stay above the `[orgSlug]` / `[host]` / `admin` /
 * `manage` boundaries AND above `HostGuard`, which swaps its children for a
 * spinner while a subdomain resolves — mounting it per-subtree would just
 * move the remount to org↔site navigations.
 */
export function SecondaryNavBarComponent() {
  const { navTabItems, activeTab } = useSecondaryNav()
  const { flags, isStaff } = useReleaseFlags()

  // Release-flag gating (AGL-229): flagged-off tabs disappear for
  // customers; staff keep them with a flag badge so unreleased surfaces
  // are recognizably unlaunched.
  const gatedNavTabItems = useMemo(() => {
    return navTabItems.flatMap((item) => {
      const definition = item.id
        ? NAV_TAB_RELEASE_FLAGS.get(item.id)
        : undefined
      // Default to the flag's shipped state when the live flag map hasn't
      // resolved yet, so defaultEnabled surfaces (e.g. Events) don't blink
      // out on load and a missing entry can't crash the strip (AGL-387).
      const released =
        flags[definition?.key as ReleaseFlagKey]?.released ??
        definition?.defaultEnabled ??
        false
      if (!definition || released) return [item]
      if (!isStaff) return []
      return [
        {
          ...item,
          icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
          title: `${definition.label} is hidden from customers by release flag ${definition.key}`,
        },
      ]
    })
  }, [navTabItems, flags, isStaff])

  return (
    <SecondaryAppBarComponent
      tabBarTitle={tabBarTitle}
      activeTab={activeTab}
      navTabItems={gatedNavTabItems}
    />
  )
}
SecondaryNavBarComponent.displayName = 'SecondaryNavBarComponent'

export default SecondaryNavBarComponent
