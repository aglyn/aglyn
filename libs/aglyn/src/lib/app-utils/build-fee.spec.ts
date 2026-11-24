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
  BUILD_FEE_DEFAULT_LABEL,
  BUILD_FEE_TAX_CODE,
  buildFeeCentsFromDollars,
  buildFeeDraftProblem,
  buildFeeIsDue,
  buildFeeOverlapWarning,
  buildFeeSourceKey,
  chargeForWorkOverlapWarning,
  describeBuildFee,
  normalizeBuildFee,
  parseBuildFeeSourceKey,
  readBuildFee,
  withBuildFee,
} from './build-fee'
import { SITE_CARE_EXTRA_TIME_TAX_CODE } from './site-care'
import { readUpgradeProposal, standingUpgradeProposal } from './upgrade-proposal'

describe('a website build fee is checked before it is stored (AGL-4244)', () => {
  it('takes whole cents from $1 to $50,000, with "Website build" for a blank line', () => {
    expect(normalizeBuildFee({ amountCents: 35000 })).toEqual({
      ok: true,
      fee: { amountCents: 35000, label: BUILD_FEE_DEFAULT_LABEL },
    })
    expect(normalizeBuildFee({ amountCents: 100, label: '  E-commerce   build ' })).toEqual({
      ok: true,
      fee: { amountCents: 100, label: 'E-commerce build' },
    })
    expect(normalizeBuildFee({ amountCents: 5_000_000 })).toMatchObject({ ok: true })
  })

  it('reads no fee at all as none, not as an error', () => {
    for (const input of [undefined, null, {}, { amountCents: '' }, { amountCents: 0 }]) {
      expect(normalizeBuildFee(input as never)).toEqual({ ok: true, fee: null })
    }
  })

  it('refuses less than $1, more than $50,000, a fraction of a cent, and a long line', () => {
    for (const amountCents of [99, 5_000_001, -500, 350.5, 'abc', Number.NaN]) {
      expect(normalizeBuildFee({ amountCents } as never)).toMatchObject({ ok: false })
    }
    expect(normalizeBuildFee({ amountCents: 35000, label: 'x'.repeat(121) })).toMatchObject({ ok: false })
    expect(normalizeBuildFee({ amountCents: 35000, label: 42 } as never)).toMatchObject({ ok: false })
    expect(normalizeBuildFee('350' as never)).toMatchObject({ ok: false })
  })

  it('is billed under the code every Aglyn service carries', () => {
    expect(BUILD_FEE_TAX_CODE).toBe(SITE_CARE_EXTRA_TIME_TAX_CODE)
    expect(BUILD_FEE_TAX_CODE).toBe('txcd_10103001')
  })

  it('reads the dollars staff type as cents, and says what is wrong with them', () => {
    expect(buildFeeCentsFromDollars('350')).toBe(35000)
    expect(buildFeeCentsFromDollars('$1,250.50')).toBe(125050)
    expect(buildFeeCentsFromDollars('')).toBeNull()
    expect(buildFeeCentsFromDollars('3.505')).toBeNaN()
    expect(buildFeeDraftProblem({ amount: '', label: '' })).toBeNull()
    expect(buildFeeDraftProblem({ amount: '350', label: '' })).toBeNull()
    expect(buildFeeDraftProblem({ amount: '0.50', label: '' })).toMatch(/between \$1 and \$50,000/)
    expect(buildFeeDraftProblem({ amount: '60000', label: '' })).toMatch(/between \$1 and \$50,000/)
  })
})

describe('a stored fee is due until it is recorded paid', () => {
  it('is due with no paid invoice, and not once one is recorded', () => {
    const fee = readBuildFee({ amountCents: 35000, label: 'Website build', invoiceId: 'in_1' })
    expect(fee).toEqual({ amountCents: 35000, label: 'Website build', invoiceId: 'in_1' })
    expect(buildFeeIsDue(fee)).toBe(true)
    expect(buildFeeIsDue(readBuildFee({ amountCents: 35000, label: 'x', paidInvoiceId: 'in_1', paidAt: 5 }))).toBe(
      false,
    )
    expect(readBuildFee({ amountCents: 12 })).toBeNull()
    expect(readBuildFee('350')).toBeNull()
  })

  it('names its source on the subscription and reads it back', () => {
    expect(buildFeeSourceKey({ kind: 'proposal' })).toBe('proposal')
    expect(buildFeeSourceKey({ kind: 'bundle-link', id: 'abc' })).toBe('bundle:abc')
    expect(parseBuildFeeSourceKey('bundle:abc')).toEqual({ kind: 'bundle-link', id: 'abc' })
    expect(parseBuildFeeSourceKey('proposal')).toEqual({ kind: 'proposal' })
    expect(parseBuildFeeSourceKey('bundle:a/b')).toBeNull()
    expect(parseBuildFeeSourceKey('other')).toBeNull()
  })
})

describe('what the owner reads', () => {
  it('names the fee as its own one-time line beside the plan', () => {
    const fee = { amountCents: 35000, label: 'Website build' }
    expect(describeBuildFee(fee)).toBe('Website build, $350 one time')
    expect(describeBuildFee({ amountCents: 125050, label: 'E-commerce build' })).toBe(
      'E-commerce build, $1,250.50 one time',
    )
    expect(withBuildFee('Starter with Site Care, billed yearly', fee)).toBe(
      'Starter with Site Care, billed yearly, plus Website build, $350 one time',
    )
    expect(withBuildFee('Starter', null)).toBe('Starter')
    expect(withBuildFee('Starter', { ...fee, paidInvoiceId: 'in_1' })).toBe('Starter')
  })

  it('carries the fee on a proposal that starts a subscription, never on a change of plan', () => {
    const upgradeProposal = {
      plan: 'starter',
      proposedBy: 'staff-1',
      proposedAt: 1,
      buildFee: { amountCents: 35000, label: 'Website build' },
    }
    expect(readUpgradeProposal({ upgradeProposal } as never)?.buildFee).toEqual({
      amountCents: 35000,
      label: 'Website build',
    })
    expect(readUpgradeProposal({ upgradeProposal: { ...upgradeProposal, forSubscriber: true } } as never)?.buildFee).toBe(
      undefined,
    )
    expect(
      readUpgradeProposal({ upgradeProposal: { ...upgradeProposal, buildFee: { amountCents: 5 } } } as never)?.buildFee,
    ).toBe(undefined)
    // A live subscription settles the proposal, so its fee is no longer shown.
    expect(standingUpgradeProposal({ upgradeProposal, billingStatus: 'active' } as never)).toBeNull()
  })
})

describe('the staff warnings that keep a build from being billed twice', () => {
  const quoted = { title: 'New e-commerce website build', status: 'quoted', quote: { priceUsd: 350 } }

  it('warns beside a build fee when an un-invoiced Charge for work quote is open', () => {
    expect(chargeForWorkOverlapWarning([quoted])).toBe(
      'This workspace has an open Charge for work quote, New e-commerce website build $350 (quoted). ' +
        'If it is the same build, withdraw it so the client is not billed twice.',
    )
    expect(
      chargeForWorkOverlapWarning([quoted, { title: 'Logo', status: 'accepted', quote: { priceUsd: 100 } }]),
    ).toMatch(/^This workspace has open Charge for work quotes: .*Logo \$100 \(accepted, not invoiced\)/)
  })

  it('says nothing when every quote is invoiced, paid or refunded', () => {
    for (const status of ['invoiced', 'paid', 'deposit-paid', 'launched', 'refunded']) {
      expect(chargeForWorkOverlapWarning([{ ...quoted, status }])).toBeNull()
    }
    expect(chargeForWorkOverlapWarning([])).toBeNull()
    expect(chargeForWorkOverlapWarning(null)).toBeNull()
  })

  it('warns before a Charge for work invoice when a proposal or link carries a fee, paid or not', () => {
    expect(
      buildFeeOverlapWarning([
        { source: 'proposal', amountCents: 35000, label: 'Website build', paid: false },
        { source: 'bundle-link', amountCents: 35000, label: 'Website build', paid: true },
      ]),
    ).toBe(
      'This workspace already has a build fee: Website build $350 on the upgrade proposal, not paid yet; ' +
        'Website build $350 on the bundle link, already paid. If this invoice is for the same build, ' +
        'do not send it, so the client is not billed twice.',
    )
    expect(buildFeeOverlapWarning([])).toBeNull()
    expect(buildFeeOverlapWarning(undefined)).toBeNull()
  })
})
