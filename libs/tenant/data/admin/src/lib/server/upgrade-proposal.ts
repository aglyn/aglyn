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
 * The platform team's ask that a workspace buy a plan, server side
 * (AGL-3466): staff propose and withdraw it, and a live subscription settles
 * it.
 *
 * The sequence it serves: staff build a workspace for a client, comp it to
 * the tier being sold with the `trial` reason, and hand it over. The client
 * evaluates on that tier with no upgrade asked of them. When the evaluation
 * is done, staff record a proposal here; the owner is emailed and the
 * workspace's billing managers see a card with the plan preselected. When
 * the subscription goes live, the proposal and the trial comp both clear,
 * so a comp granted to evaluate cannot revive free access if the customer
 * later cancels.
 */

import type {
  AglynOrgBilling,
  OrgPlan,
  OrgUpgradeProposal,
} from '@aglyn/aglyn/server'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  isUpgradeProposalPlan,
  normalizeUpgradeProposalNote,
  upgradeProposalDestination,
} from '@aglyn/aglyn/app-utils/upgrade-proposal'
// Leaf modules, as `organizations.ts` imports its constants (AGL-1289).
import {
  isLiveSubscriptionStatus,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/org-billing-doc'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import { setAdminAudit } from './admin-audit-write'
import { meterOrgEmail } from './email-metering'
import firebaseAdmin from './firebase-admin'
import { logOrgActivity } from './organizations'
import {
  renderSystemEmailContent,
  systemEmailBrand,
} from './render-system-email'

const firestore = () => firebaseAdmin.app().firestore()

/** The override reason a sales-evaluation comp is granted under. */
export const TRIAL_PLAN_COMP_REASON = 'trial'

/** A proposal refused before anything was written. */
export class UpgradeProposalError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UpgradeProposalError'
    this.status = status
  }
}

export interface ProposeOrgUpgradeOptions {
  orgId: string
  plan: unknown
  note?: unknown
  /** The staff member proposing. */
  actor: { uid: string; email?: string | null }
  /** The console origin the email's link is built on. */
  origin: string
}

export interface ProposeOrgUpgradeResult {
  proposal: OrgUpgradeProposal
  /** Whether the owner's email actually went out. */
  emailed: boolean
}

/**
 * Record a proposal on the org, audit it, and email the owner.
 *
 * The org write and its audit row commit together, the property every staff
 * write to an org document keeps (AGL-1784). The email is sent after the
 * commit and is best-effort: the card on the org home is the proposal, and
 * an email that failed must not undo it.
 *
 * Refused when the workspace already has a live subscription — the question
 * a proposal asks is already answered — and for any plan a customer cannot
 * buy themselves.
 */
export async function proposeOrgUpgrade(
  options: ProposeOrgUpgradeOptions,
): Promise<ProposeOrgUpgradeResult> {
  const { orgId, actor, origin } = options
  if (!isUpgradeProposalPlan(options.plan)) {
    throw new UpgradeProposalError(
      'Choose a paid plan the workspace can buy itself',
    )
  }
  const plan: OrgPlan = options.plan
  const note = normalizeUpgradeProposalNote(options.note)
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const proposal: OrgUpgradeProposal = {
    plan,
    proposedBy: actor.uid,
    proposedAt: Date.now(),
    ...(note ? { note } : {}),
  }
  const org = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) throw new UpgradeProposalError('Unknown organization', 404)
    const data = snapshot.data() as Partial<AglynOrgBilling>
    const billing = await tx.get(
      orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
    )
    const status =
      (billing.get('subscription') as { status?: unknown } | undefined)?.status ??
      data.billingStatus
    if (isLiveSubscriptionStatus(status)) {
      throw new UpgradeProposalError(
        'This workspace already has a live subscription, so there is nothing to propose',
        409,
      )
    }
    tx.set(
      orgRef,
      { upgradeProposal: proposal, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    setAdminAudit(tx, db, {
      actorUid: actor.uid,
      action: 'org.upgradeProposal.propose',
      target: `orgs/${orgId}`,
      before: { upgradeProposal: data.upgradeProposal ?? null },
      after: { upgradeProposal: proposal },
      at: FieldValue.serverTimestamp(),
    })
    return data
  })
  await logOrgActivity(
    orgId,
    { uid: actor.uid, email: actor.email ?? null },
    `Proposed the ${PLAN_LABELS[plan]} plan`,
    { type: 'subscription', id: orgId },
    { staffActorId: actor.uid },
  )
  const emailed = await emailUpgradeProposal({ orgId, org, proposal, origin })
  return { proposal, emailed }
}

/** Remove a standing proposal, audited. Answers whether one stood. */
export async function withdrawOrgUpgrade(options: {
  orgId: string
  actor: { uid: string; email?: string | null }
}): Promise<boolean> {
  const { orgId, actor } = options
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const withdrawn = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) throw new UpgradeProposalError('Unknown organization', 404)
    const stored = snapshot.get('upgradeProposal') as OrgUpgradeProposal | undefined
    if (!stored) return null
    tx.set(
      orgRef,
      { upgradeProposal: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    setAdminAudit(tx, db, {
      actorUid: actor.uid,
      action: 'org.upgradeProposal.withdraw',
      target: `orgs/${orgId}`,
      before: { upgradeProposal: stored },
      after: { upgradeProposal: null },
      at: FieldValue.serverTimestamp(),
    })
    return stored
  })
  if (!withdrawn) return false
  await logOrgActivity(
    orgId,
    { uid: actor.uid, email: actor.email ?? null },
    `Withdrew the ${planName(withdrawn.plan)} plan proposal`,
    { type: 'subscription', id: orgId },
    { staffActorId: actor.uid },
  )
  return true
}

/**
 * What a live subscription settles (AGL-3466), cleared in one transaction
 * with an audit row that says why:
 *
 * - the standing `upgradeProposal`, whose question the purchase answered;
 * - a stored plan comp granted for a sales TRIAL. A comp waits dormant under
 *   a live subscription and applies again if it ends (`resolvePlanComp`), so
 *   a trial comp left in place would hand a customer who cancels the tier for
 *   free. Comps granted for any other reason are left alone: those are
 *   decisions staff made for reasons a purchase does not answer.
 *
 * Called by the Stripe webhook once its mirror has recorded a live status.
 * Idempotent: a redelivery finds nothing to clear and writes nothing.
 */
export async function settleSubscriptionStart(
  orgId: string,
  context: { status: string; subscriptionId?: string | null },
): Promise<{ proposalCleared: boolean; trialCompRemoved: boolean }> {
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) return null
    const data = snapshot.data() as Partial<AglynOrgBilling>
    const proposal = data.upgradeProposal ?? null
    const entitlements = (data.entitlements ?? null) as Record<string, unknown> | null
    const comp = entitlements?.['planComp'] as
      | { plan?: string; reason?: string }
      | undefined
    const trialComp = comp?.reason === TRIAL_PLAN_COMP_REASON ? comp : null
    if (!proposal && !trialComp) return null
    // The map goes with its last key, so the staff list's override count
    // never reads an empty `entitlements` as one.
    const onlyComp =
      !!entitlements && Object.keys(entitlements).every((key) => key === 'planComp')
    tx.set(
      orgRef,
      {
        ...(proposal ? { upgradeProposal: FieldValue.delete() } : {}),
        ...(trialComp
          ? onlyComp
            ? { entitlements: FieldValue.delete() }
            : { entitlements: { planComp: FieldValue.delete() } }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    setAdminAudit(tx, db, {
      actorUid: 'system',
      action: 'org.subscriptionStarted.settle',
      target: `orgs/${orgId}`,
      reason: {
        code: 'subscription_live',
        note:
          `The subscription went live (${context.status})` +
          (context.subscriptionId ? `, ${context.subscriptionId}` : '') +
          ', which settles the upgrade proposal and ends the sales-trial comp.',
      },
      before: { upgradeProposal: proposal, planComp: comp ?? null },
      after: {
        upgradeProposal: null,
        // A comp granted for any other reason stays exactly as it was.
        planComp: trialComp ? null : (comp ?? null),
      },
      at: FieldValue.serverTimestamp(),
    })
    return { proposal, trialComp }
  })
  if (!outcome) return { proposalCleared: false, trialCompRemoved: false }
  // Nobody is present at a Stripe flip, and the row says so rather than
  // naming whoever last touched billing.
  if (outcome.proposal) {
    await logOrgActivity(
      orgId,
      { uid: null },
      `The ${planName(outcome.proposal.plan)} plan proposal closed — the subscription is live`,
      { type: 'subscription', id: orgId },
    )
  }
  if (outcome.trialComp) {
    await logOrgActivity(
      orgId,
      { uid: null },
      `The ${planName(outcome.trialComp.plan)} sales-trial comp ended — the subscription is live`,
      { type: 'subscription', id: orgId },
    )
  }
  return {
    proposalCleared: !!outcome.proposal,
    trialCompRemoved: !!outcome.trialComp,
  }
}

/** Mail the owner the proposal, in the workspace's brand. Never throws. */
async function emailUpgradeProposal(options: {
  orgId: string
  org: Partial<AglynOrgBilling>
  proposal: OrgUpgradeProposal
  origin: string
}): Promise<boolean> {
  const { orgId, org, proposal, origin } = options
  try {
    if (!isEmailConfigured()) return false
    const ownerUid = (org as { ownerUid?: unknown }).ownerUid
    if (typeof ownerUid !== 'string' || !ownerUid) return false
    const owner = await firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(ownerUid)
      .get()
    const to = owner.get('email')
    if (typeof to !== 'string' || !to) return false
    const brand = systemEmailBrand(org as Record<string, unknown>)
    const orgName = brand.orgName || 'your workspace'
    const slug = typeof org.slug === 'string' ? org.slug : ''
    const billingUrl = slug
      ? `${origin}${upgradeProposalDestination(slug, proposal)}`
      : origin
    const label = planName(proposal.plan)
    const productName = brand.merge['brand.productName'] || PLATFORM_BRAND_NAME
    const content = await renderSystemEmailContent(
      'org-upgrade-proposal',
      {
        'org.name': orgName,
        'plan.name': label,
        'proposal.note': proposal.note ?? '',
        billingUrl,
      },
      brand,
      {
        subject: `Your ${productName} team proposed the ${label} plan for ${orgName}`,
        text:
          `Your ${productName} team proposed moving ${orgName} to the ${label} ` +
          'plan. When you are ready, start the subscription from Billing, ' +
          `where the plan is already selected:\n\n${billingUrl}` +
          (proposal.note ? `\n\n${proposal.note}` : ''),
      },
    )
    const result = await sendEmail({
      to,
      subject: content.subject,
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
      ...(brand.fromName ? { fromName: brand.fromName } : {}),
      context: 'org-upgrade-proposal',
    })
    if (result.sent) await meterOrgEmail(orgId)
    return result.sent
  } catch (error) {
    console.error('[upgrade-proposal] owner email failed', error)
    return false
  }
}

function planName(plan: unknown): string {
  return typeof plan === 'string' && plan in PLAN_LABELS
    ? PLAN_LABELS[plan as OrgPlan]
    : String(plan ?? 'proposed')
}
