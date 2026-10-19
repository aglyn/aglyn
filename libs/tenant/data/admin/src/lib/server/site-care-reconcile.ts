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
  previousSiteCareMonthKey,
  siteCareExtraTimeCents,
  siteCareMonthKey,
  siteCareMonthStatement,
  siteCareStatementRequest,
  type SiteCareRequest,
} from '@aglyn/aglyn/app-utils/site-care'
import { readOrgBilling } from './org-billing'
import { raiseOperatorAlert } from './operator-alerts'
import { readSiteCareRequest } from './site-care-requests'
import {
  listSiteCareExtraTimeItems,
  readExtraTimeItem,
  type SiteCareStripeOptions,
  type StripeExtraTimeItem,
} from './site-care-stripe'

/**
 * THE SITE CARE RECONCILIATION (AGL-3959).
 *
 * Once a day, for the current month and the one before: each request's
 * billed hours against the Stripe invoice item that carries them — amount,
 * quantity and description — and each month's billed total against the sum
 * of its Stripe items. Any difference is a finding, and a workspace-month
 * with findings raises `billing.siteCareReconciliation` (Should know)
 * rather than passing silently. The same shape as the pricing-drift check:
 * it compares and reports, and never changes anything on either side — the
 * fix is a person's, from the request.
 *
 * What it catches, by construction of how charges are written:
 * - a Stripe item with no row behind it (the call succeeded, the record did
 *   not land): a `creating` charge, or an item no request claims;
 * - a row with no Stripe object: a `pending` charge whose item is gone, or a
 *   `failed` one still owing hours;
 * - an item somebody edited in the Stripe dashboard: amount, quantity or
 *   description that no longer match the request.
 */

export type SiteCareFindingCode =
  | 'charge-stuck'
  | 'charge-failed'
  | 'item-missing'
  | 'item-mismatch'
  | 'item-not-voided'
  | 'item-without-row'
  | 'hours-mismatch'
  | 'month-total'
  | 'no-customer'

export interface SiteCareFinding {
  orgId: string
  month: string
  requestId: string | null
  code: SiteCareFindingCode
  detail: string
}

export interface SiteCareReconcileReport {
  months: string[]
  orgs: number
  requests: number
  findings: SiteCareFinding[]
  alerted: number
  errors: string[]
}

interface RequestRow {
  id: string
  orgId: string
  subject: string
  request: SiteCareRequest
}

/** Compares one workspace's requests with its Stripe items. Pure. */
export function compareSiteCareCharges(input: {
  orgId: string
  requests: readonly RequestRow[]
  items: readonly StripeExtraTimeItem[]
  /** Items read one by one because the listing did not reach them. */
  readItems?: ReadonlyMap<string, { deleted: boolean; item: StripeExtraTimeItem | null }>
}): SiteCareFinding[] {
  const findings: SiteCareFinding[] = []
  const byId = new Map(input.items.map((item) => [item.id, item]))
  const claimed = new Set<string>()
  const months = new Set<string>()
  for (const row of input.requests) {
    const { request } = row
    months.add(request.month)
    const charge = request.charge
    const at = { orgId: input.orgId, month: request.month, requestId: row.id }
    if (!charge) {
      if (request.billedHours > 0) {
        findings.push({ ...at, code: 'hours-mismatch', detail: `“${row.subject}” bills ${request.billedHours} h with no charge recorded.` })
      }
      continue
    }
    if (charge.invoiceItemId) claimed.add(charge.invoiceItemId)
    const fromStripe = charge.invoiceItemId
      ? (byId.get(charge.invoiceItemId) ?? input.readItems?.get(charge.invoiceItemId)?.item ?? null)
      : (input.items.find((item) => item.requestId === row.id) ?? null)
    const deleted = charge.invoiceItemId ? input.readItems?.get(charge.invoiceItemId)?.deleted === true : false
    if (fromStripe) claimed.add(fromStripe.id)
    switch (charge.status) {
      case 'creating':
        findings.push({
          ...at,
          code: 'charge-stuck',
          detail: fromStripe
            ? `“${row.subject}”: Stripe item ${fromStripe.id} exists but the request never recorded it. Retry the charge to record it.`
            : `“${row.subject}”: a charge was started and never finished. Retry it.`,
        })
        break
      case 'failed':
        findings.push({ ...at, code: 'charge-failed', detail: `“${row.subject}”: ${charge.hours} h owed with no Stripe item (${charge.error ?? 'failed'}).` })
        break
      case 'pending': {
        if (!fromStripe || deleted) {
          findings.push({ ...at, code: 'item-missing', detail: `“${row.subject}”: Stripe item ${charge.invoiceItemId} is gone.` })
          break
        }
        const expected = siteCareExtraTimeCents(charge.hours)
        const problems: string[] = []
        if (fromStripe.amountCents !== expected) problems.push(`amount ${fromStripe.amountCents} ≠ ${expected}`)
        if (fromStripe.quantity !== charge.hours) problems.push(`quantity ${fromStripe.quantity} ≠ ${charge.hours}`)
        if (fromStripe.description !== charge.description) problems.push('description differs')
        if (problems.length) {
          findings.push({ ...at, code: 'item-mismatch', detail: `“${row.subject}” (${fromStripe.id}): ${problems.join(', ')}.` })
        }
        if (request.billedHours !== charge.hours && !request.absorbed) {
          findings.push({ ...at, code: 'hours-mismatch', detail: `“${row.subject}”: billed ${request.billedHours} h but the charge is ${charge.hours} h.` })
        }
        break
      }
      case 'voided':
        if (fromStripe && !deleted) {
          findings.push({ ...at, code: 'item-not-voided', detail: `“${row.subject}”: voided here, but Stripe item ${fromStripe.id} is still there.` })
        }
        break
      default:
        break
    }
  }
  for (const item of input.items) {
    if (claimed.has(item.id)) continue
    findings.push({
      orgId: input.orgId,
      month: [...months][0] ?? '',
      requestId: item.requestId || null,
      code: 'item-without-row',
      detail: `Stripe item ${item.id} (${item.amountCents} cents) names request ${item.requestId}, which does not record it.`,
    })
  }
  // The month's total against Stripe's.
  for (const month of months) {
    const inMonth = input.requests.filter((row) => row.request.month === month)
    const statement = siteCareMonthStatement({
      month,
      goodwillMinutes: 0,
      requests: inMonth.map((row) => siteCareStatementRequest(row.id, row.subject, row.request)),
    })
    const stripeTotal = inMonth
      .filter((row) => row.request.charge?.status === 'pending' && row.request.charge.invoiceItemId)
      .reduce((sum, row) => {
        const id = String(row.request.charge?.invoiceItemId)
        const item = byId.get(id) ?? input.readItems?.get(id)?.item ?? null
        return sum + (item ? item.amountCents : 0)
      }, 0)
    const pendingRecorded = inMonth
      .filter((row) => row.request.charge?.status === 'pending')
      .reduce((sum, row) => sum + (row.request.charge?.amountCents ?? 0), 0)
    if (stripeTotal !== pendingRecorded) {
      findings.push({
        orgId: input.orgId,
        month,
        requestId: null,
        code: 'month-total',
        detail: `The ${month} statement bills ${statement.extraBilledCents} cents (${pendingRecorded} on pending items) and Stripe holds ${stripeTotal}.`,
      })
    }
  }
  return findings
}

/** Runs the check over the current and previous month. */
export async function reconcileSiteCare(
  firestore: FirebaseFirestore.Firestore,
  input: { nowMs?: number; dryRun: boolean; stripe?: SiteCareStripeOptions },
): Promise<SiteCareReconcileReport> {
  const nowMs = input.nowMs ?? Date.now()
  const current = siteCareMonthKey(nowMs)
  const months = [current, previousSiteCareMonthKey(current)]
  const snapshot = await firestore.collection('supportTickets').where('siteCareMonth', 'in', months).limit(2000).get()
  const byOrg = new Map<string, RequestRow[]>()
  for (const doc of snapshot.docs) {
    const request = readSiteCareRequest(doc.get('siteCare'))
    const orgId = String(doc.get('orgId') ?? '')
    if (!request || !orgId || request.state !== 'closed') continue
    const rows = byOrg.get(orgId) ?? []
    rows.push({ id: doc.id, orgId, subject: String(doc.get('subject') ?? ''), request })
    byOrg.set(orgId, rows)
  }
  const report: SiteCareReconcileReport = {
    months,
    orgs: byOrg.size,
    requests: [...byOrg.values()].reduce((sum, rows) => sum + rows.length, 0),
    findings: [],
    alerted: 0,
    errors: [],
  }
  // Seventy days reaches back past the start of the previous month.
  const sinceMs = nowMs - 70 * 24 * 60 * 60 * 1000
  for (const [orgId, rows] of byOrg) {
    try {
      const charged = rows.filter((row) => row.request.charge)
      if (!charged.length) continue
      const billing = await readOrgBilling(orgId)
      const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
      if (!customerId) {
        report.findings.push({ orgId, month: current, requestId: null, code: 'no-customer', detail: 'Charges are recorded but the workspace has no Stripe customer.' })
        continue
      }
      const listed = await listSiteCareExtraTimeItems({ customerId, sinceMs }, input.stripe)
      if (listed.ok === false) {
        report.errors.push(`${orgId}: ${listed.error}`)
        continue
      }
      const listedIds = new Set(listed.items.map((item) => item.id))
      const readItems = new Map<string, { deleted: boolean; item: StripeExtraTimeItem | null }>()
      for (const row of charged) {
        const id = row.request.charge?.invoiceItemId
        if (!id || listedIds.has(id)) continue
        const read = await readExtraTimeItem(id, input.stripe)
        if (read.ok === false) {
          report.errors.push(`${orgId}/${row.id}: ${read.error}`)
          continue
        }
        readItems.set(id, {
          deleted: read.state.stage === 'deleted',
          item:
            read.state.stage === 'deleted'
              ? null
              : {
                  id,
                  amountCents: read.state.amountCents,
                  quantity: read.state.quantity,
                  description: read.state.description,
                  requestId: String(read.state.metadata['siteCareRequestId'] ?? row.id),
                  month: String(read.state.metadata['month'] ?? row.request.month),
                },
        })
      }
      // Only items for these months' requests are judged here: an older
      // month's item inside the listing window belongs to a month this run
      // does not read.
      const requestIds = new Set(rows.map((row) => row.id))
      const items = listed.items.filter(
        (item) => requestIds.has(item.requestId) || months.includes(item.month),
      )
      const findings = compareSiteCareCharges({ orgId, requests: rows, items, readItems })
      report.findings.push(...findings)
      if (input.dryRun || !findings.length) continue
      const byMonth = new Map<string, SiteCareFinding[]>()
      for (const finding of findings) {
        const list = byMonth.get(finding.month) ?? []
        list.push(finding)
        byMonth.set(finding.month, list)
      }
      const orgSnap = await firestore.collection('orgs').doc(orgId).get()
      const orgName = String(orgSnap.get('name') ?? orgId)
      for (const [month, list] of byMonth) {
        const result = await raiseOperatorAlert('billing.siteCareReconciliation', {
          dedupeKey: `${orgId}:${month}`,
          context: {
            orgId,
            orgName,
            month,
            count: list.length,
            findings: list.map((finding) => finding.detail).join(' '),
          },
          orgId,
        })
        if (result.outcome !== 'deduped' && result.outcome !== 'below-threshold') report.alerted += 1
      }
    } catch (error) {
      report.errors.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return report
}
