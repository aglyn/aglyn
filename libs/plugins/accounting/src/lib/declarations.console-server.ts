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

/**
 * The accounting plugin's CONSOLE-ONLY server declarations (AGL-3614),
 * named under `consoleServerDeclarations` in `plugins.config.json` and run
 * at the console's boot.
 *
 * Everything here opens a sealed ledger grant with `ACCOUNTING_TOKEN_KEY`,
 * which only the console holds, so none of it is declared where the tenant
 * runtime would load it:
 *
 * - the sync tick, on the console's fifteen-minute `plugin-console-crons`
 *   beat (`server/sync-job.ts`);
 * - the workspace eraser, which revokes the grant before the workspace's
 *   data goes.
 *
 * Light at boot: each body is imported the first time a tick or an erasure
 * asks for it.
 */

import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { listPluginOrgErasers, registerPluginOrgEraser } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { ACCOUNTING_PLUGIN_ID, ACCOUNTING_SYNC_JOB_ID } from './constants/bundle-common'

export function registerAccountingConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: ACCOUNTING_SYNC_JOB_ID,
      label: 'Accounting sync',
      drives:
        'Posts each connected workspace’s sales, refunds, fees and payouts to QuickBooks Online or Xero, keeps each ledger grant from expiring, and runs backfills. If it stops, nothing reaches the books and an idle grant lapses after 60 days (Xero) or 100 (QuickBooks).',
      run: async (context) => {
        const [{ runAccountingSyncJob }, { defaultAccountingJobDeps }] = await Promise.all([
          import('./server/sync-job'),
          import('./server/platform-deps'),
        ])
        return runAccountingSyncJob(defaultAccountingJobDeps(), context)
      },
    },
    { pluginId: ACCOUNTING_PLUGIN_ID },
  )
  if (!listPluginOrgErasers().includes(ACCOUNTING_PLUGIN_ID)) {
    registerPluginOrgEraser(
      async (request) => {
        const [{ createAccountingOrgEraser }, { platformAccountingProvider, platformFirestore }] = await Promise.all([
          import('./server/accounting-erasure'),
          import('./server/platform-deps'),
        ])
        return createAccountingOrgEraser({
          firestore: platformFirestore,
          providerFor: (provider) => platformAccountingProvider(provider),
        })(request)
      },
      { pluginId: ACCOUNTING_PLUGIN_ID },
    )
  }
}
