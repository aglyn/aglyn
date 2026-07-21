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
 * The personal Manage area's tab strip (AGL-351): user-scoped surfaces —
 * notifications and profile — as their own console section in the
 * secondary app bar, mirroring orgNavTabItems/hostNavTabItems.
 */
export function manageNavTabItems() {
  return [
    {
      id: 'nav-tab-manage-notifications',
      label: 'Notifications',
      href: buildRoute(Route.MANAGE_NOTIFICATIONS),
    },
    {
      id: 'nav-tab-manage-user',
      label: 'Profile',
      href: buildRoute(Route.MANAGE_USER_SETTINGS),
    },
  ]
}

export default manageNavTabItems
