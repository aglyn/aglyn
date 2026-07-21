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
export function hostNavTabItems(orgSlug: string, host: string) {
  const staticTabs = [
    {
      id: 'nav-tab-dashboard',
      label: 'Dashboard',
      href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
    },
    {
      id: 'nav-tab-screens',
      label: 'Screens',
      href: buildRoute(Route.SCREEN_LIST, { orgSlug, host }),
    },
    {
      id: 'nav-tab-layouts',
      label: 'Layouts',
      href: buildRoute(Route.LAYOUT_LIST, { orgSlug, host }),
    },
    // Dedicated pages for former dashboard cards (AGL-250).
    {
      id: 'nav-tab-components',
      label: 'Components',
      href: buildRoute(Route.HOST_COMPONENTS, { orgSlug, host }),
    },
    // Theme lives under Setup → Theme (AGL-114); the /theme route redirects.
    {
      id: 'nav-tab-media',
      label: 'Media',
      href: buildRoute(Route.HOST_MEDIA, { orgSlug, host }),
    },
    {
      id: 'nav-tab-content',
      label: 'Content',
      href: buildRoute(Route.HOST_CONTENT, { orgSlug, host }),
    },
    // Inbox (nav + page) now comes from the inbox plugin's ConsoleExtension,
    // served by the generic route (AGL-395).
    // Contacts (nav + page) now comes from the contacts plugin's
    // ConsoleExtension, served by the generic route (AGL-395).
    // Site users left the dashboard for their own section (AGL-350).
    {
      id: 'nav-tab-users',
      label: 'Users',
      href: buildRoute(Route.HOST_USERS, { orgSlug, host }),
    },
    // Analytics deep dive (AGL-352); the dashboard keeps the glance card.
    {
      id: 'nav-tab-analytics',
      label: 'Analytics',
      href: buildRoute(Route.HOST_ANALYTICS, { orgSlug, host }),
    },
    // Bookings, Data (nav + page) now come from their plugins'
    // ConsoleExtensions, served by the generic route (AGL-395).
    // Products, Redirects (nav + page) now come from their plugins'
    // ConsoleExtensions, served by the generic [hostId]/[pluginSlug] route
    // (AGL-395).
    // Marketing (nav + page) now comes from the marketing plugin's
    // ConsoleExtension, served by the generic route (AGL-395).
    // Logic, Workflows (nav + page) now come from their plugins'
    // ConsoleExtensions, served by the generic route (AGL-395).
    // Community (nav + hub page) now comes from the community plugin's
    // ConsoleExtension, served by the generic route (AGL-395); the listing
    // + publisher detail pages remain app routes.
    {
      id: 'nav-tab-setup',
      label: 'Setup',
      href: buildRoute(Route.HOST_SETUP, { orgSlug, host }),
    },
  ]

  // Plugin-contributed tabs from the ConsoleExtension registry. The href
  // is host-relative ('/events'); mount it under the active host. Ids fall
  // back to the navTabId so DashboardLayout's release-flag gating applies.
  const hostBase = buildRoute(Route.HOST_DASHBOARD, { orgSlug, host })
  const pluginTabs = listConsoleNavItems().map((item) => ({
    id: item.navTabId ?? `nav-plugin-${item.href.replace(/[^\w]+/g, '-')}`,
    label: item.label,
    href: `${hostBase}${item.href}`,
  }))
  if (!pluginTabs.length) return staticTabs

  // Splice plugin tabs in where Bookings/Events/Products used to sit,
  // right after Analytics.
  const anchor = staticTabs.findIndex((tab) => tab.id === 'nav-tab-analytics')
  if (anchor === -1) return [...staticTabs, ...pluginTabs]
  return [
    ...staticTabs.slice(0, anchor + 1),
    ...pluginTabs,
    ...staticTabs.slice(anchor + 1),
  ]
}

export default hostNavTabItems
