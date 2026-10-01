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

import type { PluginUsageAxesDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { CRM_RECORDS_METER_ID } from './constants/bundle-common'

/**
 * THE CRM'S METER (AGL-3080): the records band — contacts, companies and
 * deals, counted together — in the platform's cost model and utilization
 * table. Compiled into core by the manifest generator (`register.usageAxes`).
 *
 * Priced at `perContactMonth`. The rate was measured on a contact, the most
 * expensive of the three to hold, so it over-covers a company or a deal
 * rather than under-pricing one. `crmRecordsCount` REPLACES `contactsCount`
 * when a rollup carries it — the contacts are inside the sum, and pricing
 * both would charge the same people twice — and `contactsCount` alone is
 * read only on a month written before the band was widened (AGL-2611). The
 * two components are recorded so the sum stays legible.
 *
 * The band is org-wide despite the entitlement's name: the records gate
 * compares `contactsPerHost` against an org-wide headcount, and the tier
 * model costs it unexpanded.
 */
export function crmUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      {
        id: 'contacts',
        order: 60,
        fields: ['crmRecordsCount'],
        fallbackFields: ['contactsCount'],
        recordedFields: ['companiesCount', 'dealsCount'],
        rate: 'perContactMonth',
      },
    ],
    bands: [
      {
        id: 'contactsCount',
        label: 'CRM records',
        order: 70,
        fields: ['crmRecordsCount'],
        fallbackFields: ['contactsCount'],
        entitlement: 'contactsPerHost',
      },
    ],
    // Measured in the monthly usage sweep by `server/crm-records-meter.ts`.
    meters: [{ id: CRM_RECORDS_METER_ID }],
  }
}
