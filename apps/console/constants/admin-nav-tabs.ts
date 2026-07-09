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
 * The staff admin area's tab strip, previously copy-pasted into every
 * admin page (extracted with the Feature flags tab, AGL-230), mirroring
 * `hostNavTabItems`.
 */
export function adminNavTabItems() {
  return [
    {
      id: 'nav-tab-admin-overview',
      label: 'Overview',
      href: buildRoute(Route.ADMIN_OVERVIEW),
    },
    {
      id: 'nav-tab-admin-tenants',
      label: 'Tenants',
      href: buildRoute(Route.ADMIN_TENANTS),
    },
    {
      id: 'nav-tab-admin-users',
      label: 'Users',
      href: buildRoute(Route.ADMIN_USERS),
    },
    {
      id: 'nav-tab-admin-flags',
      label: 'Feature flags',
      href: buildRoute(Route.ADMIN_FLAGS),
    },
    {
      id: 'nav-tab-admin-audit',
      label: 'Audit log',
      href: buildRoute(Route.ADMIN_AUDIT),
    },
  ]
}

export default adminNavTabItems
