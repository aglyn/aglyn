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

import type { DocsHelpAnchor } from './docs-links'
import { buildRoute, Route } from './route-links'

export interface NotificationSection {
  /** The section's key, which the rail and the specs match on. */
  id: 'feed' | 'settings'
  label: string
  href: string
  /**
   * The docs heading this section stands in front of.
   *
   * Typed against the console tour's REAL headings (AGL-602), so a section
   * whose anchor goes stale is a compile error rather than a help icon that
   * opens the top of the page.
   */
  anchor: DocsHelpAnchor<'consoleTour'>
}

/**
 * The Notifications area's sections, in rail order (AGL-3230).
 *
 * Two routes, one rail — the same shape `ACCOUNT_SECTIONS` has, and for the
 * same reason `HubSections` exists: a section is a route, so Next mounts one
 * page and code-splits per route, and the settings page's reads do not run
 * for somebody who only came to read their feed.
 *
 * It is a RAIL and not a second app-bar tab. The app bar's Manage strip names
 * the console's personal AREAS — Notifications, Manage Account — and a
 * settings page for one of them is not a third area; putting it there made
 * the strip list a thing and a sub-thing side by side, at the same rank.
 *
 * One list, read by everything that has to agree: the rail draws from it, the
 * breadcrumb resolves the active entry from it, and each section's docs
 * anchor rides along so the help icon points at the heading the reader is
 * actually standing in front of.
 */
export const NOTIFICATION_SECTIONS: readonly NotificationSection[] = [
  {
    id: 'feed',
    label: 'All notifications',
    href: buildRoute(Route.MANAGE_NOTIFICATIONS),
    anchor: '#the-notifications-feed',
  },
  {
    id: 'settings',
    label: 'Settings',
    href: buildRoute(Route.MANAGE_NOTIFICATION_SETTINGS),
    anchor: '#notification-settings',
  },
]
