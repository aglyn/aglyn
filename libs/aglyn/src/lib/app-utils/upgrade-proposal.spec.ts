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
  isUpgradeProposalPlan,
  normalizeUpgradeProposalNote,
  readUpgradeProposal,
  standingUpgradeProposal,
  UPGRADE_PROPOSAL_NOTE_MAX,
  UPGRADE_PROPOSAL_PLANS,
  upgradeProposalDestination,
  upgradeProposalHeadline,
} from './upgrade-proposal'

const proposal = { plan: 'starter', proposedBy: 'staff-1', proposedAt: 1_700_000_000_000 }

describe('upgrade proposals (AGL-3466)', () => {
  it('proposes only plans a customer can buy themselves', () => {
    expect(UPGRADE_PROPOSAL_PLANS).not.toContain('free')
    expect(UPGRADE_PROPOSAL_PLANS).not.toContain('enterprise')
    expect(UPGRADE_PROPOSAL_PLANS).toContain('starter')
    expect(isUpgradeProposalPlan('agency')).toBe(true)
    expect(isUpgradeProposalPlan('free')).toBe(false)
    expect(isUpgradeProposalPlan('enterprise')).toBe(false)
    expect(isUpgradeProposalPlan('platinum')).toBe(false)
  })

  it('stores a note trimmed and bounded, and none when blank', () => {
    expect(normalizeUpgradeProposalNote('  as discussed  ')).toBe('as discussed')
    expect(normalizeUpgradeProposalNote('   ')).toBeUndefined()
    expect(normalizeUpgradeProposalNote(42)).toBeUndefined()
    expect(
      normalizeUpgradeProposalNote('x'.repeat(UPGRADE_PROPOSAL_NOTE_MAX + 10)),
    ).toHaveLength(UPGRADE_PROPOSAL_NOTE_MAX)
  })

  it('reads a stored proposal, and none for an unsellable plan', () => {
    expect(readUpgradeProposal({ upgradeProposal: proposal as never })).toEqual(proposal)
    expect(
      readUpgradeProposal({ upgradeProposal: { ...proposal, plan: 'enterprise' } as never }),
    ).toBeNull()
    expect(readUpgradeProposal({})).toBeNull()
    expect(readUpgradeProposal(null)).toBeNull()
  })

  it('stands while no subscription is live, comped or not', () => {
    const comped = {
      upgradeProposal: proposal as never,
      entitlements: { planComp: { plan: 'starter', reason: 'trial' } } as never,
    }
    expect(standingUpgradeProposal(comped)?.plan).toBe('starter')
    expect(
      standingUpgradeProposal({ ...comped, billingStatus: 'canceled' })?.plan,
    ).toBe('starter')
  })

  it('stops standing the moment a subscription is live', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(
        standingUpgradeProposal({ upgradeProposal: proposal as never, billingStatus: status }),
      ).toBeNull()
    }
  })

  it('sends the button to Billing with the plan preselected and no interval claimed', () => {
    expect(upgradeProposalDestination('acme', proposal as never)).toBe(
      '/acme/billing?plan=starter',
    )
  })

  it('names the workspace and the plan in the headline', () => {
    expect(
      upgradeProposalHeadline(proposal as never, { orgName: 'Acme', productName: 'Aglyn' }),
    ).toBe("Acme's Aglyn team proposed the Starter plan")
    expect(
      upgradeProposalHeadline(proposal as never, { orgName: ' ', productName: 'Aglyn' }),
    ).toBe('Your Aglyn team proposed the Starter plan')
  })
})
