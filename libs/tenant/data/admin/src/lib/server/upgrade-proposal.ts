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
 *
 * A workspace that already subscribes can be proposed a CHANGE (AGL-4160):
 * another plan or billing cadence, usually with a code for the switch. That
 * proposal is marked `forSubscriber` and settled only when the subscription
 * moves to it, since a subscription being live is what it starts from.
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
  normalizeUpgradeProposalBundle,
  normalizeUpgradeProposalNote,
  upgradeProposalAnsweredBy,
  upgradeProposalDestination,
  upgradeProposalSummary,
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
  /**
   * The add-ons, cadence and coupon proposed with the plan (AGL-3956), in any
   * shape `parseBundleAddons` reads; fitted to the plan before storing.
   */
  addons?: unknown
  interval?: unknown
  coupon?: unknown
  /**
   * A retired Aglyn AI tier (AGL-4025). Credits are sold by the block since
   * AGL-4144 (`ai:<blocks>` in `addons`), so a proposal naming a tier is
   * refused rather than stored with a price nobody sells.
   */
  aiTier?: unknown
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
 * Refused for any plan a customer cannot buy themselves. A workspace with a
 * live subscription can be proposed a change of plan or cadence (AGL-4160),
 * stored as `forSubscriber`; a proposal of the plan and cadence it already
 * has is refused, since there is nothing to propose.
 */
export async function proposeOrgUpgrade(
  options: ProposeOrgUpgradeOptions,
): Promise<ProposeOrgUpgradeResult> {
  const { orgId, actor, origin } = options
  const built = buildUpgradeProposal(options)
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const { org, proposal } = await db.runTransaction(async (tx) => {
    const target = await readUpgradeProposalChange(tx, orgRef, built)
    const staged: OrgUpgradeProposal = target.live ? { ...built, forSubscriber: true } : built
    stageUpgradeProposal(tx, db, {
      orgId,
      proposal: staged,
      before: target.data,
      actorUid: actor.uid,
    })
    return { org: target.data, proposal: staged }
  })
  await recordUpgradeProposalActivity(orgId, actor, proposal)
  const emailed = await emailUpgradeProposal({ orgId, org, proposal, origin })
  return { proposal, emailed }
}

/**
 * The proposal as it will be stored, or the refusal: a plan the workspace
 * can buy itself, a bounded note, and the bundle fitted to the plan
 * (AGL-3956). Nothing is read or written.
 */
export function buildUpgradeProposal(
  options: Pick<
    ProposeOrgUpgradeOptions,
    'plan' | 'note' | 'addons' | 'interval' | 'coupon' | 'aiTier' | 'actor'
  > & {
    now?: number
  },
): OrgUpgradeProposal {
  if (!isUpgradeProposalPlan(options.plan)) {
    throw new UpgradeProposalError(
      'Choose a paid plan the workspace can buy itself',
    )
  }
  const plan: OrgPlan = options.plan
  if (options.aiTier != null) {
    throw new UpgradeProposalError(
      'AI tiers were replaced by AI credit blocks. Propose a number of blocks instead.',
    )
  }
  const note = normalizeUpgradeProposalNote(options.note)
  return {
    plan,
    proposedBy: options.actor.uid,
    proposedAt: options.now ?? Date.now(),
    ...(note ? { note } : {}),
    ...normalizeUpgradeProposalBundle(plan, options),
  }
}

/**
 * Read the org a proposal is for, inside the caller's transaction, refusing
 * an unknown workspace and one whose subscription is already live — the
 * question a proposal asks is then already answered. The owner hand-off,
 * which proposes a first plan, reads through this.
 */
export async function readUpgradeProposalTarget(
  tx: FirebaseFirestore.Transaction,
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<Partial<AglynOrgBilling>> {
  const target = await readUpgradeProposalChange(tx, orgRef, null)
  return target.data
}

/**
 * Read the org a proposal is for, and whether its subscription is live
 * (AGL-4160). A live subscription takes a proposal that CHANGES it — another
 * plan, or the cadence it is not billed on — and refuses one it already
 * answers, or no proposal at all.
 */
export async function readUpgradeProposalChange(
  tx: FirebaseFirestore.Transaction,
  orgRef: FirebaseFirestore.DocumentReference,
  proposal: Pick<OrgUpgradeProposal, 'plan' | 'interval'> | null,
): Promise<{ data: Partial<AglynOrgBilling>; live: boolean }> {
  const snapshot = await tx.get(orgRef)
  if (!snapshot.exists) throw new UpgradeProposalError('Unknown organization', 404)
  const data = snapshot.data() as Partial<AglynOrgBilling>
  const billing = await tx.get(
    orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
  )
  const subscription = billing.get('subscription') as
    | { status?: unknown; interval?: unknown }
    | undefined
  const status = subscription?.status ?? data.billingStatus
  if (!isLiveSubscriptionStatus(status)) return { data, live: false }
  if (!proposal) {
    throw new UpgradeProposalError(
      'This workspace already has a live subscription, so there is nothing to propose',
      409,
    )
  }
  if (upgradeProposalAnsweredBy(proposal, { plan: data.plan, interval: subscription?.interval })) {
    const cadence =
      subscription?.interval === 'year'
        ? ', billed yearly'
        : subscription?.interval === 'month'
          ? ', billed monthly'
          : ''
    throw new UpgradeProposalError(
      `This workspace already subscribes to ${planName(data.plan)}${cadence}, so there is ` +
        'nothing to propose. Propose another plan or billing cadence.',
      409,
    )
  }
  return { data, live: true }
}

/**
 * Write the proposal and its audit row into the caller's transaction, so
 * they commit with whatever else the caller writes (AGL-1784) — the owner
 * invitation, for a hand-off that proposes in the same act (AGL-3956).
 */
export function stageUpgradeProposal(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  options: {
    orgId: string
    proposal: OrgUpgradeProposal
    before: Partial<AglynOrgBilling>
    actorUid: string
  },
): void {
  const { orgId, proposal, before, actorUid } = options
  tx.set(
    db.collection('orgs').doc(orgId),
    { upgradeProposal: proposal, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  setAdminAudit(tx, db, {
    actorUid,
    action: 'org.upgradeProposal.propose',
    target: `orgs/${orgId}`,
    before: { upgradeProposal: before.upgradeProposal ?? null },
    after: { upgradeProposal: proposal },
    at: FieldValue.serverTimestamp(),
  })
}

/** "Proposed the Starter plan", naming the bundle when there is one. */
export function proposalActivityLine(proposal: OrgUpgradeProposal): string {
  const label = planName(proposal.plan)
  const summary = upgradeProposalSummary(proposal)
  return summary === label
    ? `Proposed the ${label} plan`
    : `Proposed the ${label} plan (${summary})`
}

/** The workspace's feed line for a proposal, after it commits. */
export async function recordUpgradeProposalActivity(
  orgId: string,
  actor: { uid: string; email?: string | null },
  proposal: OrgUpgradeProposal,
): Promise<void> {
  await logOrgActivity(
    orgId,
    { uid: actor.uid, email: actor.email ?? null },
    proposalActivityLine(proposal),
    { type: 'subscription', id: orgId },
    { staffActorId: actor.uid },
  )
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
  context: {
    status: string
    subscriptionId?: string | null
    /**
     * The plan and cadence the live subscription is on (AGL-4160). A
     * proposal made to a subscriber is settled only by the subscription
     * reaching it; absent, the org doc's `plan` stands in for the plan.
     */
    plan?: string | null
    interval?: string | null
  },
): Promise<{ proposalCleared: boolean; trialCompRemoved: boolean }> {
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) return null
    const data = snapshot.data() as Partial<AglynOrgBilling>
    const stored = data.upgradeProposal ?? null
    // A change proposed to a subscriber stands until the subscription is on
    // it: being live is where it started, so it settles nothing.
    const proposal =
      stored?.forSubscriber === true &&
      !upgradeProposalAnsweredBy(stored, {
        plan: context.plan ?? data.plan,
        interval: context.interval,
      })
        ? null
        : stored
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
          (proposal?.forSubscriber
            ? `The subscription moved to the proposed plan (${context.status})`
            : `The subscription went live (${context.status})`) +
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
      `The ${planName(outcome.proposal.plan)} plan proposal closed — ` +
        (outcome.proposal.forSubscriber
          ? 'the subscription moved to it'
          : 'the subscription is live'),
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
    const summary = upgradeProposalSummary(proposal, { brand: productName })
    // A workspace that already subscribes switches; one that does not starts
    // a subscription (AGL-4160).
    const nextStep = proposal.forSubscriber
      ? 'When you are ready, switch to it from Billing. The plan is already selected ' +
        'there, and Billing shows what the switch costs today, with any code applied, ' +
        'before anything is charged.'
      : 'When you are ready, start the subscription from Billing. The plan is already ' +
        'selected there, beside the others so you can compare them first.'
    const unchanged = proposal.forSubscriber
      ? 'Nothing changes until you switch.'
      : 'Nothing changes until you start the subscription.'
    const content = await renderSystemEmailContent(
      'org-upgrade-proposal',
      {
        'org.name': orgName,
        'plan.name': label,
        'proposal.note': proposal.note ?? '',
        'proposal.summary': summary === label ? '' : summary,
        'proposal.nextStep': nextStep,
        'proposal.unchanged': unchanged,
        billingUrl,
      },
      brand,
      {
        subject: `Your ${productName} team proposed the ${label} plan for ${orgName}`,
        text:
          `Your ${productName} team proposed moving ${orgName} to the ${label} ` +
          (summary === label ? 'plan. ' : `plan (${summary}). `) +
          (proposal.forSubscriber
            ? 'When you are ready, switch to it from Billing, '
            : 'When you are ready, start the subscription from Billing, ') +
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
