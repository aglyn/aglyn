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

import { listConsoleNavItems } from '@aglyn/aglyn'
import { buildRoute, Route } from './route-links'

/**
 * The host dashboard's tab strip, previously copy-pasted into every
 * host-scoped page (extracted with the Community tab, AGL-44). Ids are
 * stable — DashboardLayout keys the active tab on them.
 *
 * Plugin-contributed tabs (AGL-394) are spliced in from the
 * ConsoleExtension registry, so a feature plugin adds a menu item without
 * editing this file. They inherit the release-flag gating in
 * DashboardLayout via their `navTabId`. The Events tab now arrives this
 * way from the events-calendar plugin.
 */
export function hostNavTabItems(hostId: string) {
  const staticTabs = [
    {
      id: 'nav-tab-dashboard',
      label: 'Dashboard',
      href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
    },
    {
      id: 'nav-tab-screens',
      label: 'Screens',
      href: buildRoute(Route.SCREEN_LIST, { hostId }),
    },
    {
      id: 'nav-tab-layouts',
      label: 'Layouts',
      href: buildRoute(Route.LAYOUT_LIST, { hostId }),
    },
    // Dedicated pages for former dashboard cards (AGL-250).
    {
      id: 'nav-tab-components',
      label: 'Components',
      href: buildRoute(Route.HOST_COMPONENTS, { hostId }),
    },
    // Theme lives under Setup → Theme (AGL-114); the /theme route redirects.
    {
      id: 'nav-tab-media',
      label: 'Media',
      href: buildRoute(Route.HOST_MEDIA, { hostId }),
    },
    {
      id: 'nav-tab-content',
      label: 'Content',
      href: buildRoute(Route.HOST_CONTENT, { hostId }),
    },
    {
      id: 'nav-tab-inbox',
      label: 'Inbox',
      href: buildRoute(Route.HOST_INBOX, { hostId }),
    },
    {
      id: 'nav-tab-contacts',
      label: 'Contacts',
      href: buildRoute(Route.HOST_CONTACTS, { hostId }),
    },
    // Site users left the dashboard for their own section (AGL-350).
    {
      id: 'nav-tab-users',
      label: 'Users',
      href: buildRoute(Route.HOST_USERS, { hostId }),
    },
    // Analytics deep dive (AGL-352); the dashboard keeps the glance card.
    {
      id: 'nav-tab-analytics',
      label: 'Analytics',
      href: buildRoute(Route.HOST_ANALYTICS, { hostId }),
    },
    {
      id: 'nav-tab-bookings',
      label: 'Bookings',
      href: buildRoute(Route.HOST_BOOKINGS, { hostId }),
    },
    {
      id: 'nav-tab-data',
      label: 'Data',
      href: buildRoute(Route.HOST_DATA, { hostId }),
    },
    {
      id: 'nav-tab-products',
      label: 'Products',
      href: buildRoute(Route.HOST_PRODUCTS, { hostId }),
    },
    {
      id: 'nav-tab-redirects',
      label: 'Redirects',
      href: buildRoute(Route.HOST_REDIRECTS, { hostId }),
    },
    {
      id: 'nav-tab-marketing',
      label: 'Marketing',
      href: buildRoute(Route.HOST_MARKETING, { hostId }),
    },
    {
      id: 'nav-tab-logic',
      label: 'Logic',
      href: buildRoute(Route.HOST_LOGIC, { hostId }),
    },
    {
      id: 'nav-tab-workflows',
      label: 'Workflows',
      href: buildRoute(Route.HOST_WORKFLOWS, { hostId }),
    },
    {
      id: 'nav-tab-community',
      label: 'Community',
      href: buildRoute(Route.HOST_COMMUNITY, { hostId }),
    },
    {
      id: 'nav-tab-setup',
      label: 'Setup',
      href: buildRoute(Route.HOST_SETUP, { hostId }),
    },
  ]

  // Plugin-contributed tabs from the ConsoleExtension registry. The href
  // is host-relative ('/events'); mount it under the active host. Ids fall
  // back to the navTabId so DashboardLayout's release-flag gating applies.
  const pluginTabs = listConsoleNavItems().map((item) => ({
    id: item.navTabId ?? `nav-plugin-${item.href.replace(/[^\w]+/g, '-')}`,
    label: item.label,
    href: `/${hostId}${item.href}`,
  }))
  if (!pluginTabs.length) return staticTabs

  // Splice plugin tabs into the Events tab's former slot, after Bookings.
  const anchor = staticTabs.findIndex((tab) => tab.id === 'nav-tab-bookings')
  if (anchor === -1) return [...staticTabs, ...pluginTabs]
  return [
    ...staticTabs.slice(0, anchor + 1),
    ...pluginTabs,
    ...staticTabs.slice(anchor + 1),
  ]
}

export default hostNavTabItems
