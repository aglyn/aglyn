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

/**
 * THE FORMS PLUGIN'S METER (AGL-3080): form submissions, in the platform's
 * cost model and utilization table. Compiled into core by the manifest
 * generator (`register.usageAxes`).
 *
 * Priced at `perFormSubmission`, one of the three rates the customer is
 * billed at cost × 1.30 — the rate itself stays core's, beside the billed
 * table it is reconciled against. The band is per SITE, so the org-wide band
 * is the plan's figure times `hostLimit`.
 */
export function formsUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      {
        id: 'formSubmissions',
        order: 30,
        fields: ['formSubmissions'],
        rate: 'perFormSubmission',
      },
    ],
    bands: [
      {
        id: 'formSubmissions',
        label: 'Form submissions',
        order: 40,
        fields: ['formSubmissions'],
        entitlement: 'formSubmissionsPerMonth',
        perHost: true,
      },
    ],
  }
}
