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
 * The Manage section's tab strip, previously copy-pasted per page — which
 * drifted (user/account pages were missing Billing). One source of truth,
 * mirroring `hostNavTabItems`.
 */
export function settingsNavTabItems() {
  return [
    {
      id: 'nav-tab-settings-user',
      label: 'User',
      href: buildRoute(Route.MANAGE_USER_SETTINGS),
    },
    {
      id: 'nav-tab-settings-account',
      label: 'Account',
      href: buildRoute(Route.MANAGE_ACCOUNT_SETTINGS),
    },
    {
      id: 'nav-tab-settings-billing',
      label: 'Billing',
      href: buildRoute(Route.MANAGE_BILLING),
    },
    {
      id: 'nav-tab-settings-team',
      label: 'Team',
      href: buildRoute(Route.MANAGE_TEAM),
    },
    {
      id: 'nav-tab-settings-community',
      label: 'Community',
      href: buildRoute(Route.MANAGE_COMMUNITY_PROFILE),
    },
    {
      id: 'nav-tab-settings-support',
      label: 'Support',
      href: buildRoute(Route.MANAGE_SUPPORT),
    },
  ]
}

export default settingsNavTabItems
