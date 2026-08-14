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
import {
  type NavTabItem,
  useSecondaryNav,
  useUrlNamesOrg,
} from '../hooks/use-secondary-nav'
import HostSwitcherNavComponent from './host-switcher-nav.component'
import SecondaryAppBarComponent from './secondary-app-bar.component'

// Nav tabs governed by a release flag (AGL-229), keyed by tab id.
const NAV_TAB_RELEASE_FLAGS = new Map(
  RELEASE_FLAGS.filter((definition) => definition.navTabId).map(
    (definition) => [definition.navTabId, definition],
  ),
)

/**
 * Marks a nav tab that ONLY a staff account can see — a release-flagged-off
 * surface kept for staff with the ⚑ badge below.
 *
 * The app owns this contract because something outside the app depends on
 * it: the docs screenshot harness signs in as the seeded STAFF account (the
 * staff-console pages it captures need the claim), so every capture rendered
 * these tabs and two published images ended up advertising an unlaunched
 * Contacts CRM to every reader (AGL-1600). `tools/e2e/lib/staff-only-chrome.mjs`
 * scrubs and then asserts on this attribute, and refuses to capture anything
 * when it matches nothing where a flagged-off tab is known to exist — a
 * title-string match would have gone quietly no-op the first time this
 * wording changed.
 */
export const STAFF_ONLY_ATTRIBUTE = 'data-staff-only'

export interface GatedNavTabItem extends NavTabItem {
  icon?: { path: string }
  title?: string
  [STAFF_ONLY_ATTRIBUTE]?: string
}

/**
 * Release-flag gating (AGL-229): flagged-off tabs disappear for customers;
 * staff keep them with a flag badge so unreleased surfaces are recognizably
 * unlaunched.
 *
 * Pure so the marker can be asserted where it is DECLARED — rendering the
 * bar takes the whole provider stack, and a test that needs that much setup
 * is a test nobody keeps green.
 */
export function gateNavTabItems(
  navTabItems: NavTabItem[],
  flags: Partial<Record<ReleaseFlagKey, { released?: boolean }>>,
  isStaff: boolean,
): GatedNavTabItem[] {
  return navTabItems.flatMap((item) => {
    const definition = item.id ? NAV_TAB_RELEASE_FLAGS.get(item.id) : undefined
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
        [STAFF_ONLY_ATTRIBUTE]: definition.key,
      },
    ]
  })
}

const tabBarTitle = (
  <Stack
    direction="row"
    spacing={{ sm: 0.15, md: 0.5 }}
    sx={{
      alignItems: 'center',
      typography: 'subtitle2',
      lineHeight: 'normal',
      color: 'secondary.main',
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
  const namesOrg = useUrlNamesOrg()
  const { flags, isStaff } = useReleaseFlags()

  const gatedNavTabItems = useMemo(
    () => gateNavTabItems(navTabItems, flags, isStaff),
    [navTabItems, flags, isStaff],
  )

  return (
    <SecondaryAppBarComponent
      // A site switcher needs an org to switch WITHIN, and the sites it
      // offers come from whichever org the scope fell back to. On a route the
      // URL doesn't scope to a workspace — the staff console (AGL-1119), the
      // personal Manage area and the org jump page (AGL-1130) — that made
      // "All sites" read as though the page were scoped to every site of an
      // org it has nothing to do with. Omit it rather than label it wrong.
      tabBarTitle={namesOrg ? tabBarTitle : undefined}
      activeTab={activeTab}
      navTabItems={gatedNavTabItems}
    />
  )
}
SecondaryNavBarComponent.displayName = 'SecondaryNavBarComponent'

export default SecondaryNavBarComponent
