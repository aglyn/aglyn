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
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { orgRef } from './db'
import type { StoredLabel } from './labels'

/**
 * SHIPPING'S METER IN THE MONTHLY USAGE SWEEP (AGL-3612): the labels the
 * platform paid for and did not recover from the merchant's Stripe balance,
 * billed on the workspace's own invoice.
 *
 * Read from the month's labels every run: those whose charge is the usage
 * invoice's (`usage_invoice`, charged or deferred from a refused debit). A
 * label voided and refunded in its own month is never invoiced. One voided
 * in a later month stays on its own month's bill, which may already be
 * final, and is taken off the bill of the month it was credited in.
 *
 * Writes `shippingLabels` (count) and `shippingLabelCents` (the month's
 * total label charges, every method) onto the rollup.
 */

export { SHIPPING_USAGE_METER_ID } from '../constants/bundle-common'

export async function measureShippingMonth(context: PluginUsageMeterContext): Promise<PluginUsageMeterReading> {
  const snapshot = await orgRef(context.orgId)
    .collection(SHIPPING_COLLECTIONS.labels)
    .where('month', '==', context.month)
    .limit(10_000)
    .get()
  let labels = 0
  let totalCents = 0
  let invoiceCents = 0
  for (const doc of snapshot.docs) {
    const label = doc.data() as StoredLabel
    const billing = label.billing
    if (!billing) continue
    labels += 1
    if (billing.state === 'not_billed') continue
    // Credited within its own month: it never reaches an invoice. Credited
    // in a later month: its own month bills it as it stood when the month
    // closed, and the credit month takes it off — so a re-run reads the same.
    if (billing.state === 'credited' && (billing.creditMonth ?? context.month) === context.month) continue
    totalCents += billing.chargeCents
    if (billing.method === 'usage_invoice') invoiceCents += billing.chargeCents
  }
  // Credits for labels of EARLIER months that were invoiced and voided this
  // month: the refund the merchant is owed, taken off this month's bill.
  const credits = await orgRef(context.orgId)
    .collection(SHIPPING_COLLECTIONS.labels)
    .where('billing.creditMonth', '==', context.month)
    .limit(10_000)
    .get()
  let creditCents = 0
  for (const doc of credits.docs) {
    const label = doc.data() as StoredLabel
    if (label.month !== context.month && label.billing?.method === 'usage_invoice') {
      creditCents += label.billing.chargeCents
    }
  }
  const billedCents = Math.max(0, invoiceCents - creditCents)
  return {
    fields: { shippingLabels: labels, shippingLabelCents: totalCents },
    billedUsd: billedCents / 100,
  }
}
