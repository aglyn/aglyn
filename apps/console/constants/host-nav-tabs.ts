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

import { buildRoute, Route } from './route-links'

/**
 * The host dashboard's tab strip, previously copy-pasted into every
 * host-scoped page (extracted with the Community tab, AGL-44). Ids are
 * stable — DashboardLayout keys the active tab on them.
 */
export function hostNavTabItems(hostId: string) {
  return [
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
      id: 'nav-tab-data',
      label: 'Data',
      href: buildRoute(Route.HOST_DATA, { hostId }),
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
}

export default hostNavTabItems
