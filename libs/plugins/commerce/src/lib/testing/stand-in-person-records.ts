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

import {
  registerPluginPersonRecords,
  type PluginPersonRefundRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'

/**
 * A plugin that keeps people, standing in for the one that does (AGL-3080).
 *
 * Commerce reports money it handed back — a refund, a dispute lost — through
 * `plugin-person-records` and imports no record system, so its specs stand an
 * owner up the way the loader would. One plugin may not import another, which
 * is why this is here rather than borrowed from the CRM.
 *
 * What these specs certify is that the seller REPORTS the right reversal:
 * once, with the amount this attempt reversed, and whether it closed the
 * sale. What the report does to the customer's record — the gross left alone,
 * the timeline line, the refusal to conjure a contact — is held by the CRM's
 * own `person-refund.spec.ts`.
 *
 * Returns the reports, in the order the seller made them.
 */
export function standInPersonRecords(): PluginPersonRefundRequest[] {
  const refunds: PluginPersonRefundRequest[] = []
  registerPluginPersonRecords(
    {
      async find() {
        return null
      },
      async read(request) {
        return request.records.map(() => null)
      },
      async recordRefund(request) {
        refunds.push(request)
        return 'recorded'
      },
    },
    { pluginId: 'record-system' },
  )
  return refunds
}

/**
 * The customer's ledger as the reports add up: what was handed back and how
 * many sales were closed by it — `undefined` for none, as an untouched record
 * reads — so a spec reads one figure rather than summing reports itself.
 */
export function reportedRefundLedger(refunds: readonly PluginPersonRefundRequest[]): {
  refundedCents: number | undefined
  refundedOrdersCount: number | undefined
} {
  const refundedCents = refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  const closed = refunds.filter((refund) => refund.closedTheSale).length
  return {
    refundedCents: refunds.length ? refundedCents : undefined,
    refundedOrdersCount: closed ? closed : undefined,
  }
}
