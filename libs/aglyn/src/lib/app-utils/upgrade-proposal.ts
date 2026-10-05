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
 * The platform team's request that a workspace move to a paid plan
 * (AGL-3466), read in one place.
 *
 * A workspace staff build for a client is handed over first and sold second:
 * the client joins, looks around on whatever the workspace already has, and
 * only then is asked to upgrade. Staff record that ask as
 * `orgs/{orgId}.upgradeProposal`; this module decides whether it still
 * stands, what it may name, and where the button under it goes.
 */

import type {
  AglynOrgBilling,
  OrgPlan,
  OrgUpgradeProposal,
} from '../foundation/definitions/org-billing.types'
import {
  onboardingDestination,
  type OnboardingPlanIntent,
} from './onboarding-deep-link'
import { isLiveSubscriptionStatus } from './org-billing-doc'
import { PLAN_LABELS, SELF_SERVE_PLANS } from './plan-entitlements'

/** The longest staff note a proposal carries. */
export const UPGRADE_PROPOSAL_NOTE_MAX = 500

/**
 * The plans staff may propose: every tier a customer can buy themselves,
 * less Free, which is not a purchase. Enterprise is quoted per deal, so it
 * is never proposed through a checkout link.
 */
export const UPGRADE_PROPOSAL_PLANS: readonly OrgPlan[] = SELF_SERVE_PLANS.filter(
  (plan) => plan !== 'free',
)

export function isUpgradeProposalPlan(plan: unknown): plan is OrgPlan {
  return (
    typeof plan === 'string' &&
    (UPGRADE_PROPOSAL_PLANS as readonly string[]).includes(plan)
  )
}

/** A staff note as it is stored: trimmed, bounded, and absent when blank. */
export function normalizeUpgradeProposalNote(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined
  const trimmed = note.trim().slice(0, UPGRADE_PROPOSAL_NOTE_MAX)
  return trimmed || undefined
}

/**
 * The stored proposal, narrowed, or null when there is none worth showing.
 *
 * A proposal naming a plan this build cannot sell reads as none: a card whose
 * button opens a checkout for an unknown tier is worse than no card.
 */
export function readUpgradeProposal(
  org: Partial<AglynOrgBilling> | null | undefined,
): OrgUpgradeProposal | null {
  const raw = org?.upgradeProposal as Partial<OrgUpgradeProposal> | null | undefined
  if (!raw || typeof raw !== 'object' || !isUpgradeProposalPlan(raw.plan)) {
    return null
  }
  const note = normalizeUpgradeProposalNote(raw.note)
  return {
    plan: raw.plan,
    proposedBy: typeof raw.proposedBy === 'string' ? raw.proposedBy : '',
    proposedAt: Number.isFinite(raw.proposedAt) ? Number(raw.proposedAt) : 0,
    ...(note ? { note } : {}),
  }
}

/**
 * The proposal the workspace should be shown: the stored one, while no
 * subscription is live.
 *
 * `billingStatus` is the org document's mirror of the subscription status,
 * readable by every member, so this answers from the document the console
 * already holds. A live subscription means the workspace has bought a plan,
 * which settles the question the proposal asked; `writeOrgBilling`'s caller
 * clears the field then, and this hides it in the meantime.
 */
export function standingUpgradeProposal(
  org: Partial<AglynOrgBilling> | null | undefined,
): OrgUpgradeProposal | null {
  if (isLiveSubscriptionStatus(org?.billingStatus)) return null
  return readUpgradeProposal(org)
}

/** The plan intent a proposal carries into Billing: the plan, no interval. */
export function upgradeProposalIntent(
  proposal: Pick<OrgUpgradeProposal, 'plan'>,
): OnboardingPlanIntent {
  return {
    plan: proposal.plan,
    interval: 'month',
    // The proposal names a plan, not a cadence, so the page keeps whatever
    // its toggle says rather than being told "monthly".
    intervalStated: false,
    contactSales: false,
  }
}

/** Where the proposal's button goes: Billing, with the plan preselected. */
export function upgradeProposalDestination(
  orgSlug: string,
  proposal: Pick<OrgUpgradeProposal, 'plan'>,
): string {
  return onboardingDestination(orgSlug, upgradeProposalIntent(proposal))
}

/** "Acme's Aglyn team proposed the Starter plan". */
export function upgradeProposalHeadline(
  proposal: Pick<OrgUpgradeProposal, 'plan'>,
  options: { orgName?: string | null; productName: string },
): string {
  const workspace = options.orgName?.trim()
  const team = workspace
    ? `${workspace}'s ${options.productName} team`
    : `Your ${options.productName} team`
  return `${team} proposed the ${PLAN_LABELS[proposal.plan]} plan`
}
