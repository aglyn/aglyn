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
import {
  PHONE_MINUTES_COUNTER,
  PHONE_MINUTES_QUOTA,
  PHONE_TEXTS_COUNTER,
  PHONE_TEXTS_QUOTA,
} from './constants/usage'

/**
 * PHONE'S METERS (AGL-4251): call minutes and text segments in the platform's
 * cost model, and texts as an infrastructure meter billed at cost + 30% (kept
 * after card fees) past the pool the Phone add-on includes. Calls within the
 * US and Canada are unlimited, so minutes are a COST axis only — counted for
 * the margin, never billed. Compiled into core by the manifest generator
 * (`register.usageAxes`).
 *
 * Counted on the per-site counter of the site each number answers for, so the
 * usage sweep and the Billing estimate read them like form submissions. The
 * band is org-wide (`perHost` absent): the pool belongs to the workspace's
 * add-on, not to each site.
 *
 * Withheld while `release_phone` is off for the workspace: nothing is charged
 * for a feature it cannot open.
 */
export function phoneUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      { id: 'phoneMinutes', order: 74, fields: ['phoneMinutes'], rate: 'perPhoneMinute' },
      { id: 'phoneTexts', order: 75, fields: ['phoneTexts'], rate: 'perPhoneText' },
    ],
    bands: [
      {
        // Counted, never billed: the usage sweep sums the per-site counter
        // into the rollup's `phoneMinutes`, which the cost axis above prices.
        // The entitlement is unlimited with the add-on.
        id: 'phoneMinutes',
        label: 'Phone minutes',
        order: 74,
        fields: ['phoneMinutes'],
        entitlement: PHONE_MINUTES_QUOTA,
        hostCounter: PHONE_MINUTES_COUNTER,
      },
      {
        id: 'phoneTexts',
        label: 'Phone texts',
        order: 75,
        fields: ['phoneTexts'],
        entitlement: PHONE_TEXTS_QUOTA,
        hostCounter: PHONE_TEXTS_COUNTER,
        metered: {
          rate: 'perPhoneText',
          quotedPer: 1,
          noun: 'phone texts',
          withheldUntil: 'release_phone',
        },
      },
    ],
  }
}
