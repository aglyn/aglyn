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
 * A WEBSITE BUILD FEE, CHARGED WITH THE PLAN (AGL-4244), SERVER SIDE.
 *
 * Staff set a one-time fee on the upgrade proposal or on a bundle link; the
 * owner pays it with the plan, on the FIRST invoice of the subscription the
 * checkout starts. This module is the one place that decides which fee is
 * due, prices it in Stripe, and records it charged and then paid:
 *
 * 1. `resolveDueBuildFee` — the checkout's question. Read from Firestore,
 *    never from the request: the link named by `?bundle=` when it is for this
 *    workspace and still owes its fee, else the standing proposal's. A fee an
 *    earlier subscription already carried is checked against Stripe, so a
 *    webhook that never arrived cannot make a paid fee look due.
 * 2. `buildFeeProduct` — the Stripe product the line is priced against, its
 *    tax code checked (`BUILD_FEE_TAX_CODE`): `STRIPE_PRODUCT_WEBSITE_BUILD`
 *    when set, else the Site Care product Charge for work already bills on.
 * 3. `attachBuildFeeInvoice` — after the subscription is made, the first
 *    invoice's id is stamped on the fee's source.
 * 4. `recordBuildFeePayment` — from the webhook's `invoice.paid` for a
 *    subscription's first invoice: the fee is recorded paid on its source,
 *    on every other fee the workspace's links and proposal carry for the
 *    same build, with an `adminAudit` row. Idempotent on redelivery.
 *
 * Firebase-free, like `admin-audit-write`: every Firestore handle is the
 * caller's, so a route's spec replaces it with the one it already mocks.
 */

import type { OrgBuildFee } from '@aglyn/aglyn'
import {
  BUILD_FEE_TAX_CODE,
  buildFeeIsDue,
  buildFeeSourceKey,
  readBuildFee,
  type BuildFeeSource,
  type StandingBuildFee,
} from '@aglyn/aglyn/app-utils/build-fee'
import { readUpgradeProposal } from '@aglyn/aglyn/app-utils/upgrade-proposal'
import {
  isLiveSubscriptionStatus,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/org-billing-doc'
import { setAdminAudit } from './admin-audit-write'
import {
  siteCareExtraTimeProduct,
  siteCareStripeCall,
  siteCareStripeMessage,
  type SiteCareStripeOptions,
  type SiteCareStripeResult,
} from './site-care-stripe'

/** The collection bundle links live in (`bundle-links.ts`), named here so this module loads no Firebase. */
const BUNDLE_LINKS = 'bundleLinks'

/** The audit action a paid fee writes. */
export const BUILD_FEE_PAID_AUDIT_ACTION = 'billing.build-fee-paid'

type Db = FirebaseFirestore.Firestore

export interface DueBuildFee {
  fee: OrgBuildFee
  source: BuildFeeSource
}

function snapshotField(snapshot: unknown, field: string): unknown {
  const get = (snapshot as { get?: (name: string) => unknown } | null | undefined)?.get
  return typeof get === 'function' ? get.call(snapshot, field) : undefined
}

function snapshotExists(snapshot: unknown): boolean {
  return (snapshot as { exists?: unknown } | null | undefined)?.exists !== false && snapshot != null
}

/**
 * The fee this checkout must charge, or null. A link the request names wins
 * over the proposal, as Billing's own intent does (`billingPlanIntent`):
 * the link says what the owner came to buy. A link for another workspace,
 * or one whose fee is paid, names none, and the proposal is asked instead.
 */
export async function resolveDueBuildFee(
  db: Db,
  input: { orgId: string; bundleLinkId?: string | null },
  stripe: SiteCareStripeOptions = {},
): Promise<DueBuildFee | null> {
  const { orgId } = input
  const linkId = String(input.bundleLinkId ?? '').trim()
  const candidates: DueBuildFee[] = []
  if (linkId && !linkId.includes('/')) {
    const link = await db.collection(BUNDLE_LINKS).doc(linkId).get()
    if (snapshotExists(link) && snapshotField(link, 'workspaceId') === orgId) {
      const fee = readBuildFee(snapshotField(link, 'buildFee'))
      if (buildFeeIsDue(fee)) candidates.push({ fee, source: { kind: 'bundle-link', id: linkId } })
    }
  }
  const org = await db.collection('orgs').doc(orgId).get()
  const raw = snapshotField(org, 'upgradeProposal')
  const proposal =
    raw && typeof raw === 'object' && !isLiveSubscriptionStatus(snapshotField(org, 'billingStatus'))
      ? readUpgradeProposal({ upgradeProposal: raw } as never)
      : null
  if (proposal && !proposal.forSubscriber && buildFeeIsDue(proposal.buildFee)) {
    candidates.push({ fee: proposal.buildFee, source: { kind: 'proposal' } })
  }
  for (const candidate of candidates) {
    // A fee an earlier subscription carried: ask Stripe whether that
    // invoice was paid, so a missed webhook cannot bill it a second time.
    if (candidate.fee.invoiceId) {
      const paid = await invoiceWasPaid(candidate.fee.invoiceId, stripe)
      if (paid) {
        await recordBuildFeePayment(db, {
          orgId,
          source: candidate.source,
          invoiceId: candidate.fee.invoiceId,
          subscriptionId: candidate.fee.subscriptionId ?? null,
        })
        // Recording it paid also settles the workspace's other fees for
        // this build, so nothing else is asked.
        return null
      }
    }
    return candidate
  }
  return null
}

async function invoiceWasPaid(invoiceId: string, stripe: SiteCareStripeOptions): Promise<boolean> {
  const answer = await siteCareStripeCall(stripe, 'GET', `invoices/${encodeURIComponent(invoiceId)}`)
  if (!answer.ok) {
    // Unreadable is not paid, and not "charge it again" either: the caller
    // still sees the fee as due, and the live-subscription guard ahead of
    // every purchase is what stops a second subscription.
    console.error('[build-fees] reading an earlier invoice failed', invoiceId, siteCareStripeMessage(answer, ''))
    return false
  }
  return answer.body['status'] === 'paid'
}

/**
 * The product the fee is priced against, its tax code checked. A product
 * of its own (`STRIPE_PRODUCT_WEBSITE_BUILD`) names the line "Website build"
 * on the invoice; without one, the Site Care product, which Charge for work
 * already bills builds on under the same code.
 */
export async function buildFeeProduct(
  stripe: SiteCareStripeOptions & { productId?: string | null } = {},
): Promise<SiteCareStripeResult<{ productId: string }>> {
  const own = String(stripe.productId ?? process.env['STRIPE_PRODUCT_WEBSITE_BUILD'] ?? '').trim()
  if (!own) return siteCareExtraTimeProduct(stripe)
  const answer = await siteCareStripeCall(stripe, 'GET', `products/${encodeURIComponent(own)}`)
  if (!answer.ok) return { ok: false, error: siteCareStripeMessage(answer, 'Reading the website build product failed') }
  const code = answer.body['tax_code']
  const taxCode =
    typeof code === 'string' ? code : String((code as Record<string, unknown> | null)?.['id'] ?? '')
  if (taxCode !== BUILD_FEE_TAX_CODE) {
    return {
      ok: false,
      error: `The website build product carries tax code ${taxCode || 'none'}, not ${BUILD_FEE_TAX_CODE}; nothing was charged.`,
    }
  }
  return { ok: true, productId: own }
}

/**
 * The fee as one-time line params, at `prefix` (`add_invoice_items[0]` on
 * the subscription, `invoice_items[0]` on the preview): tax-exclusive, as
 * every platform price is, so Stripe Tax adds tax on top.
 */
export function buildFeeLineParams(
  prefix: string,
  fee: Pick<OrgBuildFee, 'amountCents'>,
  productId: string,
): Record<string, string> {
  return {
    [`${prefix}[price_data][product]`]: productId,
    [`${prefix}[price_data][currency]`]: 'usd',
    [`${prefix}[price_data][unit_amount]`]: String(fee.amountCents),
    [`${prefix}[price_data][tax_behavior]`]: 'exclusive',
    [`${prefix}[quantity]`]: '1',
  }
}

function sourceRef(db: Db, orgId: string, source: BuildFeeSource) {
  return source.kind === 'proposal'
    ? db.collection('orgs').doc(orgId)
    : db.collection(BUNDLE_LINKS).doc(source.id)
}

function sourceFieldPath(source: BuildFeeSource): string {
  return source.kind === 'proposal' ? 'upgradeProposal.buildFee' : 'buildFee'
}

/**
 * Stamp the first invoice on the fee's source, once the subscription that
 * carries it exists. Best-effort: the webhook records the payment from the
 * subscription's own metadata whether or not this landed.
 */
export async function attachBuildFeeInvoice(
  db: Db,
  input: { orgId: string; source: BuildFeeSource; invoiceId: string; subscriptionId: string },
): Promise<void> {
  if (!input.invoiceId) return
  try {
    const ref = sourceRef(db, input.orgId, input.source)
    const path = sourceFieldPath(input.source)
    await ref.update({
      [`${path}.invoiceId`]: input.invoiceId,
      ...(input.subscriptionId ? { [`${path}.subscriptionId`]: input.subscriptionId } : {}),
    })
  } catch (error) {
    console.error('[build-fees] stamping the first invoice failed', input.orgId, error)
  }
}

export interface RecordBuildFeePaymentInput {
  orgId: string
  source: BuildFeeSource
  invoiceId: string
  subscriptionId?: string | null
  /** Clock seam. */
  now?: number
}

/**
 * Record the fee paid (AGL-4244), in one transaction with its audit row:
 * on its source, and on every other fee this workspace's links and proposal
 * still owe, since every press of Copy bundle link or QR mints another link
 * for the same build. The payment itself is kept on the workspace's billing
 * record (`buildFeesPaid.<invoiceId>`), which outlives the proposal a live
 * subscription clears and is what makes a redelivery answer `already`.
 */
export async function recordBuildFeePayment(
  db: Db,
  input: RecordBuildFeePaymentInput,
): Promise<'recorded' | 'already' | 'none'> {
  const { orgId, source, invoiceId } = input
  if (!orgId || !invoiceId || invoiceId.includes('/') || invoiceId.includes('.')) return 'none'
  const now = input.now ?? Date.now()
  const links = await db.collection(BUNDLE_LINKS).where('workspaceId', '==', orgId).limit(100).get()
  const linkRefs = links.docs
    .filter((doc) => readBuildFee(doc.get('buildFee')) !== null)
    .map((doc) => doc.ref)
  return db.runTransaction(async (tx) => {
    const orgRef = db.collection('orgs').doc(orgId)
    const billingRef = orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID)
    const [orgSnapshot, billingSnapshot, ...linkSnapshots] = await Promise.all([
      tx.get(orgRef),
      tx.get(billingRef),
      ...linkRefs.map((ref) => tx.get(ref)),
    ])
    const recorded = (billingSnapshot.get('buildFeesPaid') as Record<string, unknown> | undefined)?.[invoiceId]
    if (recorded) return 'already'
    let target: OrgBuildFee | null = null
    const settled: string[] = []
    for (const snapshot of linkSnapshots) {
      const fee = readBuildFee(snapshot.get('buildFee'))
      if (!fee) continue
      const isSource = source.kind === 'bundle-link' && snapshot.id === source.id
      if (isSource) target = fee
      if (fee.paidInvoiceId) continue
      tx.update(snapshot.ref, {
        'buildFee.paidInvoiceId': invoiceId,
        'buildFee.paidAt': now,
        ...(isSource ? { 'buildFee.invoiceId': invoiceId } : {}),
      })
      settled.push(`bundle:${snapshot.id}`)
    }
    const proposalFee = orgSnapshot.exists
      ? readBuildFee((orgSnapshot.get('upgradeProposal') as { buildFee?: unknown } | undefined)?.buildFee)
      : null
    if (proposalFee) {
      if (source.kind === 'proposal') target = proposalFee
      if (!proposalFee.paidInvoiceId) {
        tx.update(orgRef, {
          'upgradeProposal.buildFee.paidInvoiceId': invoiceId,
          'upgradeProposal.buildFee.paidAt': now,
        })
        settled.push('proposal')
      }
    }
    const payment = {
      source: buildFeeSourceKey(source),
      amountCents: target?.amountCents ?? null,
      label: target?.label ?? null,
      subscriptionId: input.subscriptionId ?? null,
      paidAt: now,
    }
    tx.set(billingRef, { buildFeesPaid: { [invoiceId]: payment } }, { merge: true })
    setAdminAudit(tx, db, {
      actorUid: 'system',
      action: BUILD_FEE_PAID_AUDIT_ACTION,
      target: `orgs/${orgId}`,
      reason: {
        code: 'invoice_paid',
        note:
          `The subscription's first invoice ${invoiceId} was paid` +
          (input.subscriptionId ? ` (${input.subscriptionId})` : '') +
          ', which pays the website build fee.',
      },
      before: { buildFee: target, source: payment.source },
      after: { buildFee: target ? { ...target, paidInvoiceId: invoiceId, paidAt: now } : null, settled },
      at: new Date(now),
    })
    return 'recorded'
  })
}

/**
 * The build fees a workspace's proposal and bundle links carry, for the
 * staff warning before a Charge for work invoice (AGL-4244). One row per
 * distinct fee: every press of Copy bundle link mints another link for the
 * same build.
 */
export async function readWorkspaceBuildFees(db: Db, orgId: string): Promise<StandingBuildFee[]> {
  const [org, links] = await Promise.all([
    db.collection('orgs').doc(orgId).get(),
    db.collection(BUNDLE_LINKS).where('workspaceId', '==', orgId).limit(100).get(),
  ])
  const fees: StandingBuildFee[] = []
  const seen = new Set<string>()
  const add = (source: StandingBuildFee['source'], fee: OrgBuildFee | null) => {
    if (!fee) return
    const row = { source, amountCents: fee.amountCents, label: fee.label, paid: !!fee.paidInvoiceId }
    const key = JSON.stringify(row)
    if (seen.has(key)) return
    seen.add(key)
    fees.push(row)
  }
  add('proposal', readBuildFee((snapshotField(org, 'upgradeProposal') as { buildFee?: unknown } | undefined)?.buildFee))
  for (const doc of links.docs) add('bundle-link', readBuildFee(doc.get('buildFee')))
  return fees
}
