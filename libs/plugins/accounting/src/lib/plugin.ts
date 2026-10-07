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
import { mdiBookOpenVariant } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { ACCOUNTING_CONSOLE_SECTIONS } from './components/accounting-console-sections'
import {
  ACCOUNTING_ENTITLEMENT,
  ACCOUNTING_MANAGE_PERMISSION,
  ACCOUNTING_NAV_TAB_ID,
  ACCOUNTING_PERMISSIONS,
  ACCOUNTING_PLUGIN_ID,
} from './constants/bundle-common'

/** Code-split: the page only loads when it is opened. */
const AccountingConsolePage = lazy(() => import('./components/accounting-console-page'))

/**
 * The console half of the accounting plugin (AGL-3614), named in
 * `plugins.config.json` as `console`.
 *
 * ONE ORGANIZATION-LEVEL PAGE. A workspace keeps one set of books for every
 * site it sells through, so Accounting sits beside the organization's other
 * tabs, at `/[orgSlug]/accounting/<section>`.
 *
 * THREE GATES, each answered by the shell:
 *
 * - the RELEASE flag `release_accounting`, through the nav item's `navTabId`
 *   — off by default, and switched on only once a deployment has its Intuit
 *   or Xero credentials, so no customer meets a page with nothing to connect;
 * - the ENTITLEMENT `features.commerce`: accounting comes with every plan
 *   that sells, and no plan without;
 * - the PERMISSION `accounting.manage`, which owners and admins hold.
 */
export function registerAccountingConsole(): void {
  registerPluginPermissions(ACCOUNTING_PERMISSIONS)
  registerConsoleExtension({
    pluginId: ACCOUNTING_PLUGIN_ID,
    displayName: 'Accounting',
    permission: ACCOUNTING_MANAGE_PERMISSION,
    featureFlag: ACCOUNTING_ENTITLEMENT,
    orgNavItems: [
      {
        label: 'Accounting',
        href: '/accounting',
        sections: ACCOUNTING_CONSOLE_SECTIONS,
        navTabId: ACCOUNTING_NAV_TAB_ID,
        icon: { path: mdiBookOpenVariant.path },
        header: { title: 'Accounting', icon: { path: mdiBookOpenVariant.path } },
        Component: AccountingConsolePage,
      },
    ],
  })
}
