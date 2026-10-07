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

import type { PluginPermission } from '@aglyn/aglyn'

/** Stable plugin id: persisted in `org.enabledPlugins`; never rename. */
export const ACCOUNTING_PLUGIN_ID = 'accounting'

/** Kept for the scaffold's readers; the same id. */
export const BUNDLE_ID = ACCOUNTING_PLUGIN_ID

/**
 * Who may connect a ledger, choose its accounts and retry a sync.
 *
 * Owners and admins by default: a connection writes into the books the
 * business files its taxes from, which is not an editor's decision.
 */
export const ACCOUNTING_MANAGE_PERMISSION = 'accounting.manage'

export const ACCOUNTING_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: ACCOUNTING_MANAGE_PERMISSION,
    pluginId: ACCOUNTING_PLUGIN_ID,
    label: 'Manage accounting',
    description:
      'Connect QuickBooks Online or Xero, choose the accounts sales are posted to, and retry a sync.',
    defaults: { admin: true, editor: false, viewer: false },
  },
]

/**
 * The entitlement the plugin is sold under: the plans that include commerce
 * carry accounting, with no add-on of its own.
 */
export const ACCOUNTING_ENTITLEMENT = 'commerce'

/** The release flag's nav tab id; `release_accounting` names it. */
export const ACCOUNTING_NAV_TAB_ID = 'nav-tab-org-accounting'

/** The console cron that runs the sync, as `/api/health/crons` lists it. */
export const ACCOUNTING_SYNC_JOB_ID = 'accounting-sync'
