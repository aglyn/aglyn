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

import { registerConsoleExtension, registerPluginPermissions } from '@aglyn/aglyn'
import { mdiPhoneOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
// The `phone` feature key's type, declared beside its plan figures.
import type {} from './plan-entitlements'
import {
  PHONE_FEATURE,
  PHONE_NAV_TAB_ID,
  PHONE_PERMISSIONS,
  PHONE_PLUGIN_ID,
  PHONE_USE_PERMISSION,
} from './constants/bundle-common'

/** Code-split: the hub only loads when opened. */
const PhoneConsolePage = lazy(() => import('./components/phone-console-page'))

/**
 * Phone's console half (AGL-4251), named in `plugins.config.json` as
 * `console`. One organization-level surface, `/[orgSlug]/business-phone/<section>`:
 * the number belongs to the workspace, and its inbox holds every site's
 * customers.
 *
 * THREE GATES, each answered by the shell:
 * - the RELEASE flag `release_phone` (off by default), through `navTabId`;
 * - the ENTITLEMENT feature `phone`, which only the Phone add-on (or a staff
 *   override) switches on;
 * - the PERMISSION `phone.use`.
 */
export function registerPhoneConsole(): void {
  registerPluginPermissions(PHONE_PERMISSIONS)
  registerConsoleExtension({
    pluginId: PHONE_PLUGIN_ID,
    displayName: 'Phone',
    permission: PHONE_USE_PERMISSION,
    featureFlag: PHONE_FEATURE,
    upgradeNotice: {
      message:
        'Phone is a $15 a month add-on: a business number your team texts and takes calls on. Add it on Billing.',
      billingAnchor: 'addons',
    },
    orgNavItems: [
      {
        label: 'Phone',
        // The URL slug is the plugin id the console resolves the surface by.
        href: '/business-phone',
        sections: [
          { id: 'inbox', label: 'Inbox' },
          { id: 'calls', label: 'Calls' },
          { id: 'setup', label: 'Setup' },
          { id: 'settings', label: 'Settings' },
        ],
        navTabId: PHONE_NAV_TAB_ID,
        icon: { path: mdiPhoneOutline.path },
        header: {
          title: 'Phone',
          icon: { path: mdiPhoneOutline.path },
          docsTopic: 'phone',
        },
        Component: PhoneConsolePage,
      },
    ],
  })
}
