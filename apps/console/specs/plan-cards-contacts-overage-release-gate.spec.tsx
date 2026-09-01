/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * A plan card quotes what the invoice will actually carry.
 *
 * AGL-1604 stopped the usage cron putting `contactsOverageUsd` into
 * `billedCents` while `release_contacts` is off for the org, and AGL-1658
 * stopped the usage caption quoting a dollar figure the invoice was
 * withholding. The PLAN CARDS were the surface nobody swept: every paid tier
 * printed a flat `(+$1/1k over)` beside its contacts band with no flag check
 * at all — a rate quoted as active on the card a customer reads to *choose* a
 * tier, while `release_contacts` is `defaultEnabled: false` and the overage
 * goes uninvoiced.
 *
 * Confirmed against the live page 2026-09-01: `aglyn.com/pricing` publishes
 * "Contacts, per 1,000 over the included band — $1 / $0.75 / $0.50 / $0.40 /
 * $0.25", and nothing bills.
 *
 * Three contracts, and the third is the one that is easy to get backwards:
 *
 *  1. THE SAME VERDICT AS THE INVOICE. The provider is REAL here —
 *     `ReleaseFlagsProvider` resolves through `isReleaseFlagOnForOrg` over the
 *     Remote Config value with `parseOrgReleaseFlagOverrides` applied to the
 *     org doc, the identical expression `report-usage` bills from. Only
 *     Remote Config and the org listener are faked, so the resolution under
 *     test is the shipped one. A stubbed hook would assert the stub.
 *
 *  2. THE RATE SURVIVES, ONLY THE TENSE MOVES. Deleting the figure would swap
 *     a phantom charge for a phantom wall — "1,000 contacts" reads as a cap,
 *     and contacts over the band are not capped, they are simply not charged
 *     yet. `/pricing` publishes the rate and `billing-and-plans/overview.md`
 *     tells the same customer it applies once Contacts opens, so the card has
 *     to agree with both.
 *
 *  3. AN UNSETTLED VERDICT MAKES NO CLAIM. Before Remote Config activates,
 *     every flag reads its registry default and `release_contacts` is
 *     default-off — so a card that rendered the unbilled wording on
 *     `ready: false` would tell a staff-granted org (AGL-1635) that it is not
 *     billed, for one paint, when it is. No rate at all is the only honest
 *     third state.
 */

import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SUPPORT_URL,
} from '@aglyn/aglyn/app-utils/platform-brand'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const ORG_ID = 'org-cards-1'

let mockFlagValue: { enabled: boolean } = { enabled: false }
let mockOrgOverrides: Record<string, boolean> | undefined
let mockActivationSettles = true

/**
 * `PLATFORM_BRANDING_PROFILE` rebuilt from its own constants — what
 * `resolveBrandingProfile` returns for an org that is not white-label. Mocked
 * for the reason the sibling card specs record: the real hook reaches
 * `use-secondary-nav`, and with it the plugin gate, the Firebase services
 * provider and `next/navigation` — a module graph this test has no business
 * loading. A module-level singleton, so a consumer memoizing on the object
 * cannot be made to loop (AGL-2365).
 */
const mockBranding = {
  branding: {
    productName: PLATFORM_BRAND_NAME,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    supportUrl: PLATFORM_SUPPORT_URL,
    fromName: PLATFORM_BRAND_NAME,
    emailLogoUrl: null,
    customConsoleDomain: null,
  },
  whiteLabel: false,
  ready: true,
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBranding,
  default: () => mockBranding,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      // Not staff, on purpose. `released` is what bills; the staff bypass
      // (`visible`) must not move a billing claim on a customer's card.
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
  useRemoteConfig: () => ({ defaultConfig: {} }),
}))

// The org DOC the provider reads per-org overrides from (AGL-1635) — the same
// document `report-usage` resolves the cron's verdict from.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: ORG_ID, plan: 'pro', releaseFlags: mockOrgOverrides },
    orgId: ORG_ID,
    ready: true,
    entitlementsFromCache: false,
  }),
  useCurrentOrg: () => ({
    org: { $id: ORG_ID, plan: 'pro', releaseFlags: mockOrgOverrides },
    orgId: ORG_ID,
    ready: true,
    entitlementsFromCache: false,
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => {
    if (!mockActivationSettles) return new Promise(() => undefined)
    return true
  },
  getValue: (_config: unknown, key: string) => ({
    asString: () =>
      key === 'release_contacts' ? JSON.stringify(mockFlagValue) : '',
  }),
}))

// Billing is org-scoped (`/[orgSlug]/billing`), so the URL names a workspace
// and the per-org overrides above are in scope (AGL-1935).
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))

import BillingPlanCardsComponent from '../components/billing/billing-plan-cards.component'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

beforeEach(() => {
  mockFlagValue = { enabled: false }
  mockOrgOverrides = undefined
  mockActivationSettles = true
})

function mount() {
  render(
    <ReleaseFlagsProvider>
      <BillingPlanCardsComponent plan="pro" onSelect={jest.fn()} />
    </ReleaseFlagsProvider>,
  )
}

/** Every contacts row on screen, billed or not. */
const contactsRows = () => screen.queryAllByText(/[\d,∞]+ contacts/)

/** Rows quoting the rate as a charge that is happening NOW. */
const billedNow = () =>
  screen.queryAllByText(/contacts \(\+\$[\d.]+\/1k over\)/)

/** Rows quoting the rate as one that starts later. */
const billedLater = () =>
  screen.queryAllByText(/contacts \(\+\$[\d.]+\/1k over once Contacts opens\)/)

/**
 * The gate has settled into SOME claim — deliberately outcome-neutral.
 *
 * Waiting on the wording a case expects would turn a regression into a
 * `waitFor` timeout, which reports as "nothing ever appeared" and hides which
 * of the two wordings actually rendered. Waiting on either, then asserting
 * which, makes a wrong verdict fail on the assertion that names it.
 *
 * The contacts ROW itself is not a usable signal: it renders with no rate at
 * all before activation, so a test that waited on it would race the provider
 * and read the unsettled third state as an answer.
 */
const settled = () =>
  expect(billedNow().length + billedLater().length).toBeGreaterThan(0)

describe('plan cards, contacts overage release gate', () => {
  it('does not quote an active charge while the overage is withheld', async () => {
    mockFlagValue = { enabled: false }
    mount()
    await waitFor(settled)

    // FORCED RED: pre-fix every paid card printed "(+$0.5/1k over)" here with
    // no flag check, so this expectation failed with a non-zero count while
    // `report-usage` invoiced nothing.
    expect(billedNow()).toHaveLength(0)
    expect(billedLater().length).toBeGreaterThan(0)
  })

  it('still publishes the rate — the tense moves, the number does not', async () => {
    mockFlagValue = { enabled: false }
    mount()
    await waitFor(settled)
    expect(billedLater().length).toBeGreaterThan(0)

    // The band alone would read as a hard cap. Contacts over it are not
    // capped, only uncharged, so a bare count is its own false claim.
    expect(screen.queryAllByText(/[\d,]+ contacts$/)).toHaveLength(0)
  })

  it('quotes the charge as active once the flag is on', async () => {
    mockFlagValue = { enabled: true }
    mount()
    await waitFor(settled)
    expect(billedNow().length).toBeGreaterThan(0)
    expect(billedLater()).toHaveLength(0)
  })

  it('follows a per-org staff grant, because that org IS billed', async () => {
    // Globally off, granted to this one org (AGL-1635). `report-usage` bills
    // it, so the card has to say so — the override outranks the rollout.
    mockFlagValue = { enabled: false }
    mockOrgOverrides = { release_contacts: true }
    mount()
    await waitFor(settled)
    expect(billedNow().length).toBeGreaterThan(0)
    expect(billedLater()).toHaveLength(0)
  })

  it('follows a per-org force-OFF even while the rollout is on', async () => {
    mockFlagValue = { enabled: true }
    mockOrgOverrides = { release_contacts: false }
    mount()
    await waitFor(settled)
    expect(billedLater().length).toBeGreaterThan(0)
    expect(billedNow()).toHaveLength(0)
  })

  it('makes no billing claim at all until the verdict settles', async () => {
    // Activation never lands, so `ready` stays false. The registry default is
    // OFF, so the tempting shortcut — render the unbilled wording — would be
    // asserting "not billed" at a staff-granted org that is billed.
    mockActivationSettles = false
    mockFlagValue = { enabled: true }
    mount()
    await waitFor(() => expect(contactsRows().length).toBeGreaterThan(0))

    expect(billedNow()).toHaveLength(0)
    expect(billedLater()).toHaveLength(0)
  })
})
