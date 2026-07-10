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
 * The organization area's tab strip (AGL-236): org-scoped surfaces that
 * need no host context, mirroring hostNavTabItems/adminNavTabItems.
 */
export function orgNavTabItems() {
  return [
    {
      id: 'nav-tab-org-sites',
      label: 'Sites',
      href: buildRoute(Route.HOST_LIST),
    },
    {
      id: 'nav-tab-org-team',
      label: 'Team',
      href: buildRoute(Route.MANAGE_TEAM),
    },
    {
      id: 'nav-tab-org-media',
      label: 'Media',
      href: buildRoute(Route.ORG_MEDIA),
    },
    {
      id: 'nav-tab-org-billing',
      label: 'Billing',
      href: buildRoute(Route.MANAGE_BILLING),
    },
    {
      id: 'nav-tab-org-community',
      label: 'Community',
      href: buildRoute(Route.MANAGE_COMMUNITY_PROFILE),
    },
    {
      id: 'nav-tab-org-support',
      label: 'Support',
      href: buildRoute(Route.MANAGE_SUPPORT),
    },
    {
      id: 'nav-tab-org-settings',
      label: 'Settings',
      href: buildRoute(Route.ORG_SETTINGS),
    },
  ]
}

export default orgNavTabItems
