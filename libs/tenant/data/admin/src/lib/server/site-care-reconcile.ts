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
  countedSiteCareMinutes,
  previousSiteCareMonthKey,
  siteCareCloseVerdict,
  siteCareExtraTimeCents,
  siteCareIncludedPool,
  siteCareMonthKey,
  siteCareMonthStatement,
  siteCareStatementRequest,
  type SiteCareRequest,
} from '@aglyn/aglyn/app-utils/site-care'
import { readOrgBilling } from './org-billing'
import { raiseOperatorAlert } from './operator-alerts'
import { readSiteCareRequest, SITE_CARE_MONTHS_COLLECTION } from './site-care-requests'
import {
  reconcileSiteCareProjects,
  type SiteCareProjectFindingCode,
} from './site-care-project-reconcile'
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
 *
 * ## And against our own ledger (AGL-4031)
 *
 * Comparing a charge with Stripe proves the two copies agree; it cannot
 * prove either is right. So every closed request is also checked against
 * the facts its charge is derived from — the minutes logged, how they were
 * counted against the included hour, the owner's recorded approval — by the
 * same arithmetic the close uses (`allocateSiteCareMinutes`'s counting and
 * `siteCareCloseVerdict`): $79 per STARTED hour of over-time, whole hours,
 * never below the hours approved, nothing without an approval unless it was
 * absorbed. A request, a charge, a Stripe item or a month total that does
 * not come to that number is a finding, whichever side it is on.
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
  // Against our own ledger (AGL-4031).
  | 'ledger-minutes'
  | 'ledger-unapproved'
  | 'ledger-hours'
  | 'ledger-amount'
  | 'month-ledger'
  // A flat-quoted project's invoices (AGL-3970), in the same check.
  | SiteCareProjectFindingCode

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
  /** Projects compared (AGL-3970). */
  projects: number
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

/**
 * The whole hours a closed request should bill, from its own minutes and
 * approval: the close's verdict, re-run. `null` when no approval covers the
 * over-time and it was not absorbed — nothing may bill, and the request
 * should not have closed that way.
 */
export function siteCareLedgerHours(request: SiteCareRequest): number | null {
  const overMinutes = Math.max(0, Number(request.overMinutes) || 0)
  const verdict = siteCareCloseVerdict({
    requiredHours: overMinutes > 0 ? Math.ceil(overMinutes / 60) : 0,
    approval: request.approval,
    absorb: request.absorbed,
  })
  return verdict.ok ? verdict.billedHours : null
}

/**
 * One workspace's closed requests against their own ledger. Pure, and needs
 * no Stripe: a workspace whose charges cannot be listed is still checked.
 */
export function compareSiteCareLedger(input: {
  orgId: string
  requests: readonly RequestRow[]
  /** Goodwill minutes per month, from the month documents; 0 when absent. */
  goodwillByMonth?: ReadonlyMap<string, number>
}): SiteCareFinding[] {
  const findings: SiteCareFinding[] = []
  const months = new Set<string>()
  for (const row of input.requests) {
    const { request } = row
    months.add(request.month)
    const at = { orgId: input.orgId, month: request.month, requestId: row.id }
    const title = `“${row.subject}”`
    // The minutes: logged → counted in whole blocks → included + over.
    const logged = Number(request.minutesLogged) || 0
    const minuteProblems: string[] = []
    if (request.countedMinutes !== countedSiteCareMinutes(logged)) {
      minuteProblems.push(`${logged} min logged count as ${countedSiteCareMinutes(logged)}, recorded ${request.countedMinutes}`)
    }
    if (request.includedMinutesUsed + request.overMinutes !== request.countedMinutes) {
      minuteProblems.push(
        `${request.includedMinutesUsed} included + ${request.overMinutes} over ≠ ${request.countedMinutes} counted`,
      )
    }
    if (request.includedMinutesUsed < 0 || request.overMinutes < 0) minuteProblems.push('negative minutes')
    if (minuteProblems.length) {
      findings.push({ ...at, code: 'ledger-minutes', detail: `${title}: ${minuteProblems.join('; ')}.` })
    }
    // The hours: whole started hours of over-time, never below the approval.
    const charge = request.charge
    const owing = charge !== null && (charge.status === 'creating' || charge.status === 'pending' || charge.status === 'failed')
    const expected = siteCareLedgerHours(request)
    if (expected === null) {
      if (request.billedHours > 0 || owing) {
        findings.push({
          ...at,
          code: 'ledger-unapproved',
          detail: request.approval
            ? `${title}: bills ${request.billedHours} h for ${request.overMinutes} min past the included hour, more than the ${request.approval.hours} h the owner approved.`
            : `${title}: bills ${request.billedHours} h for ${request.overMinutes} min past the included hour with no approval on file.`,
        })
      } else {
        findings.push({
          ...at,
          code: 'ledger-unapproved',
          detail: `${title}: ${request.overMinutes} min past the included hour, neither billed nor absorbed.`,
        })
      }
    } else {
      if (request.billedHours !== expected) {
        findings.push({
          ...at,
          code: 'ledger-hours',
          detail: `${title}: records ${request.billedHours} h billed, but ${request.overMinutes} min past the included hour${
            request.approval ? ` with ${request.approval.hours} h approved` : ''
          } come to ${expected} h.`,
        })
      }
      if (owing && charge.hours !== expected) {
        findings.push({
          ...at,
          code: 'ledger-hours',
          detail: `${title}: the ${charge.status} charge is for ${charge.hours} h; the logged time comes to ${expected} h.`,
        })
      }
    }
    if (charge && charge.amountCents !== siteCareExtraTimeCents(charge.hours)) {
      findings.push({
        ...at,
        code: 'ledger-amount',
        detail: `${title}: the charge records ${charge.amountCents} cents for ${charge.hours} h, which is ${siteCareExtraTimeCents(charge.hours)}.`,
      })
    }
  }
  for (const month of months) {
    const inMonth = input.requests.filter((row) => row.request.month === month)
    // The included pool is never overdrawn: each close takes only what the
    // month's earlier requests left of it.
    const pool = siteCareIncludedPool(input.goodwillByMonth?.get(month) ?? 0)
    const included = inMonth.reduce((sum, row) => sum + (Number(row.request.includedMinutesUsed) || 0), 0)
    if (included > pool) {
      findings.push({
        orgId: input.orgId,
        month,
        requestId: null,
        code: 'ledger-minutes',
        detail: `${month}: ${included} included minutes used of a ${pool}-minute allowance.`,
      })
    }
    // The month's pending charges against what the ledger says they come to.
    const pending = inMonth.filter((row) => row.request.charge?.status === 'pending')
    const recorded = pending.reduce((sum, row) => sum + (row.request.charge?.amountCents ?? 0), 0)
    const ledger = pending.reduce((sum, row) => sum + siteCareExtraTimeCents(siteCareLedgerHours(row.request) ?? 0), 0)
    if (recorded !== ledger) {
      findings.push({
        orgId: input.orgId,
        month,
        requestId: null,
        code: 'month-ledger',
        detail: `The ${month} pending charges record ${recorded} cents; the logged time and approvals behind them come to ${ledger}.`,
      })
    }
  }
  return findings
}

/**
 * Compares one workspace's requests with its Stripe items, and with their
 * own ledger ({@link compareSiteCareLedger}). Pure.
 */
export function compareSiteCareCharges(input: {
  orgId: string
  requests: readonly RequestRow[]
  items: readonly StripeExtraTimeItem[]
  /** Items read one by one because the listing did not reach them. */
  readItems?: ReadonlyMap<string, { deleted: boolean; item: StripeExtraTimeItem | null }>
  /** Goodwill minutes per month, from the month documents; 0 when absent. */
  goodwillByMonth?: ReadonlyMap<string, number>
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
        // What the owner will be invoiced against what the ledger says,
        // when the charge itself has drifted (otherwise the line above
        // already names the difference).
        const ledgerHours = siteCareLedgerHours(request)
        const ledgerCents = siteCareExtraTimeCents(ledgerHours ?? 0)
        if (ledgerCents !== expected && fromStripe.amountCents !== ledgerCents) {
          findings.push({
            ...at,
            code: 'ledger-amount',
            detail: `“${row.subject}” (${fromStripe.id}): Stripe will invoice ${fromStripe.amountCents} cents; the logged time and approval come to ${ledgerCents}.`,
          })
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
      goodwillMinutes: input.goodwillByMonth?.get(month) ?? 0,
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
  findings.push(...compareSiteCareLedger(input))
  return findings
}

/** Each month's goodwill minutes for one workspace, from its month documents. */
async function readGoodwill(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  months: readonly string[],
): Promise<Map<string, number>> {
  const goodwill = new Map<string, number>()
  for (const month of months) {
    const snapshot = await firestore.collection('orgs').doc(orgId).collection(SITE_CARE_MONTHS_COLLECTION).doc(month).get()
    goodwill.set(month, Math.max(0, Number(snapshot.get('goodwillMinutes') ?? 0) || 0))
  }
  return goodwill
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
    projects: 0,
    findings: [],
    alerted: 0,
    errors: [],
  }
  // Seventy days reaches back past the start of the previous month.
  const sinceMs = nowMs - 70 * 24 * 60 * 60 * 1000
  for (const [orgId, rows] of byOrg) {
    try {
      const goodwillByMonth = await readGoodwill(firestore, orgId, months)
      const charged = rows.filter((row) => row.request.charge)
      // Our own ledger first, and on its own wherever Stripe is not read: a
      // workspace with no charge, no customer, or a listing that failed is
      // still checked against itself (AGL-4031).
      const ledgerOnly = () => compareSiteCareLedger({ orgId, requests: rows, goodwillByMonth })
      let findings: SiteCareFinding[]
      const billing = charged.length ? await readOrgBilling(orgId) : null
      const customerId = String((billing as { stripeCustomerId?: unknown } | null)?.stripeCustomerId ?? '')
      const listed = customerId ? await listSiteCareExtraTimeItems({ customerId, sinceMs }, input.stripe) : null
      if (!charged.length) {
        findings = ledgerOnly()
      } else if (!customerId) {
        findings = [
          { orgId, month: current, requestId: null, code: 'no-customer', detail: 'Charges are recorded but the workspace has no Stripe customer.' },
          ...ledgerOnly(),
        ]
      } else if (!listed || listed.ok === false) {
        report.errors.push(`${orgId}: ${listed && listed.ok === false ? listed.error : 'no listing'}`)
        findings = ledgerOnly()
      } else {
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
        findings = compareSiteCareCharges({ orgId, requests: rows, items, readItems, goodwillByMonth })
      }
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
  await reconcileProjectsInto(firestore, report, { nowMs, dryRun: input.dryRun, stripe: input.stripe })
  return report
}

/**
 * The flat-quoted projects (AGL-3970), in the same run and on the same
 * alert: one per workspace with findings, deduplicated a day like the
 * month's, its `month` naming the projects rather than a month.
 */
async function reconcileProjectsInto(
  firestore: FirebaseFirestore.Firestore,
  report: SiteCareReconcileReport,
  input: { nowMs: number; dryRun: boolean; stripe?: SiteCareStripeOptions },
): Promise<void> {
  const current = siteCareMonthKey(input.nowMs)
  let projects
  try {
    projects = await reconcileSiteCareProjects(firestore, { nowMs: input.nowMs, stripe: input.stripe })
  } catch (error) {
    report.errors.push(`projects: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  report.projects = projects.projects
  report.errors.push(...projects.errors)
  const byOrg = new Map<string, SiteCareFinding[]>()
  for (const finding of projects.findings) {
    const row: SiteCareFinding = {
      orgId: finding.orgId,
      month: current,
      requestId: finding.projectId,
      code: finding.code,
      detail: finding.detail,
    }
    report.findings.push(row)
    const list = byOrg.get(finding.orgId) ?? []
    list.push(row)
    byOrg.set(finding.orgId, list)
  }
  if (input.dryRun) return
  for (const [orgId, list] of byOrg) {
    try {
      const orgSnap = await firestore.collection('orgs').doc(orgId).get()
      const result = await raiseOperatorAlert('billing.siteCareReconciliation', {
        dedupeKey: `${orgId}:projects`,
        context: {
          orgId,
          orgName: String(orgSnap.get('name') ?? orgId),
          month: 'projects',
          count: list.length,
          findings: list.map((finding) => finding.detail).join(' '),
        },
        orgId,
      })
      if (result.outcome !== 'deduped' && result.outcome !== 'below-threshold') report.alerted += 1
    } catch (error) {
      report.errors.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
