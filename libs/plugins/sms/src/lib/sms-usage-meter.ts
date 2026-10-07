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

import type {
  PluginUsageMeterContext,
  PluginUsageMeterReading,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { SMS_MARKUP, SMS_USAGE_COLLECTION } from './constants'

/**
 * Texts a workspace sent this month, billed AT COST (AGL-3610): the summed
 * per-send cost `sms-messaging.ts` recorded, times `1 + SMS_MARKUP` (zero
 * today). The monthly usage sweep adds `billedUsd` to the workspace's metered
 * line beside storage, page views and the offline POS fee.
 *
 * Every text is billed — there is no included allowance, because no plan
 * includes texts and adding one is a pricing decision.
 */
export async function measureSmsUsage(
  context: Pick<PluginUsageMeterContext, 'orgId' | 'month'>,
  firestore: FirebaseFirestore.Firestore,
): Promise<PluginUsageMeterReading> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(context.orgId)
    .collection(SMS_USAGE_COLLECTION)
    .doc(context.month)
    .get()
  const read = (field: string) => {
    const value = Number(snapshot.exists ? snapshot.get(field) : 0)
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const costUsd = read('costMicros') / 1_000_000
  const billedUsd = Math.round(costUsd * (1 + SMS_MARKUP) * 100) / 100
  return {
    fields: {
      smsMessages: read('messages'),
      smsSegments: read('segments'),
      smsCostUsd: Math.round(costUsd * 10_000) / 10_000,
      smsBilledUsd: billedUsd,
    },
    billedUsd,
  }
}
