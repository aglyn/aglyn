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

import { checkCrmRecordsQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  PluginUsageMeterContext,
  PluginUsageMeterReading,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * The CRM's month in the usage sweep: the records band (AGL-890, widened in
 * AGL-2611) — contacts, companies and deals, counted together across the
 * workspace and measured against the ONE band `contactsPerHost` names.
 *
 * ## A stock, read at the end of the month it bills (AGL-2399)
 *
 * Records are a LEVEL, not a total: the count read now describes now. The
 * closed-month sweep runs after the month is over, so it bills the last
 * reading taken INSIDE the month — the period-end stamp each in-progress
 * sweep writes — and falls back to measuring only when no such reading
 * exists. The in-progress sweep stamps its own reading as the period-end one,
 * and a closed sweep never stamps, so every re-run of a closed month reads
 * the same input and bills the same amount.
 *
 * The records trio is resolved as a unit, so `contactsCount + companiesCount
 * + dealsCount === crmRecordsCount` on every row. A closed month with a
 * contacts reading but no records reading was measured on contacts alone,
 * before the band was widened, and bills the other two as nothing — the
 * permissive direction, and the only one the period-end rule permits. The
 * persisted names still say "contacts" because every reader of the rollup
 * keys on them; the quantity behind them is the records band.
 *
 * ## Withheld while the CRM is dark (AGL-1604)
 *
 * `release_crm` gates the console CRM. Records still accrue while it is off —
 * capture and `GET /v1/contacts` keep running — and nobody may be charged for
 * what they cannot reach, so the overage is withheld rather than billed, and
 * recorded as withheld so the month is legible. The COUNT is written always:
 * it is an entitlement input, and only the figure that reaches the invoice
 * moves with the flag.
 */
export async function measureCrmRecords(
  context: PluginUsageMeterContext,
): Promise<PluginUsageMeterReading> {
  const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(context.orgId)
  // Three aggregate counts, one per collection the band counts. Tasks and
  // activities are not counted, deliberately.
  const [contactsSnap, companiesSnap, dealsSnap] = await Promise.all([
    orgRef.collection('contacts').count().get(),
    orgRef.collection('companies').count().get(),
    orgRef.collection('deals').count().get(),
  ])
  const contactsCountAtSweep = Number(contactsSnap.data().count ?? 0)
  const companiesCountAtSweep = Number(companiesSnap.data().count ?? 0)
  const dealsCountAtSweep = Number(dealsSnap.data().count ?? 0)
  // The band's own figure: the three summed, measured at the same instant, so
  // the total and its parts describe one moment.
  const crmRecordsCountAtSweep =
    contactsCountAtSweep + companiesCountAtSweep + dealsCountAtSweep

  /**
   * A reading an earlier sweep stamped, or `null` when there is none to
   * trust. A missing field, a NaN or a negative falls back to measuring and
   * never bills as zero: billing zero on a malformed field would forfeit the
   * overage silently and look exactly like a customer inside the band.
   */
  const stamped = (field: string): number | null => {
    const value = Number(context.previous[field])
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const contactsAtPeriodEnd = stamped('contactsCountAtPeriodEnd')
  const crmRecordsAtPeriodEnd = stamped('crmRecordsCountAtPeriodEnd')
  const companiesAtPeriodEnd = stamped('companiesCountAtPeriodEnd')
  const dealsAtPeriodEnd = stamped('dealsCountAtPeriodEnd')

  const { closed } = context
  const contactsCount =
    closed && contactsAtPeriodEnd !== null ? contactsAtPeriodEnd : contactsCountAtSweep
  const [crmRecordsCount, companiesCount, dealsCount] =
    closed && crmRecordsAtPeriodEnd !== null
      ? [crmRecordsAtPeriodEnd, companiesAtPeriodEnd ?? 0, dealsAtPeriodEnd ?? 0]
      : closed && contactsAtPeriodEnd !== null
        ? [contactsAtPeriodEnd, 0, 0]
        : [crmRecordsCountAtSweep, companiesCountAtSweep, dealsCountAtSweep]

  // The band's verdict on the SUM, unchanged by the flag — the count and the
  // quota are what entitlement resolution reads, and only the figure that
  // reaches the invoice moves.
  const quota = checkCrmRecordsQuota(context.org as never, crmRecordsCount)
  const billed = context.releaseFlagOn('release_crm')
  const overageUsd = billed ? quota.overageMonthlyUsd : 0

  return {
    fields: {
      contactsCount,
      crmRecordsCount,
      companiesCount,
      dealsCount,
      // What this run measured, beside the billed basis: the difference is
      // how much a month moved by being measured inside it.
      contactsCountAtSweep,
      crmRecordsCountAtSweep,
      contactsOverageUsd: overageUsd,
      contactsOverageBilled: billed,
      contactsOverageWithheldUsd: billed ? 0 : quota.overageMonthlyUsd,
    },
    // Stamped together, so a closed sweep reads the total and its parts back
    // as one unit taken on one day.
    periodEndFields: {
      contactsCountAtPeriodEnd: contactsCountAtSweep,
      crmRecordsCountAtPeriodEnd: crmRecordsCountAtSweep,
      companiesCountAtPeriodEnd: companiesCountAtSweep,
      dealsCountAtPeriodEnd: dealsCountAtSweep,
    },
    billedUsd: overageUsd,
    periodEndBasis:
      closed && (contactsAtPeriodEnd !== null || crmRecordsAtPeriodEnd !== null),
  }
}
