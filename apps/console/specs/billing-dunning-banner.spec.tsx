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
 * THE DUNNING BANNER'S CLIFF (AGL-1877) — the warning must not disappear at
 * the moment the consequence arrives.
 *
 * `DEAD_SUBSCRIPTION_STATUSES` in `plan-entitlements.ts` is
 * `{canceled, unpaid, incomplete}`, and deliberately does NOT contain
 * `past_due` — that is the grace period. So the instant Stripe flips a
 * subscription to `unpaid`, `resolveEffectivePlan` drops the whole workspace
 * to Free: hosts, seats, datasets, features, gone.
 *
 * This banner matched `past_due` ALONE. Its own trigger therefore stopped
 * matching on exactly that flip, so the customer's only on-screen explanation
 * vanished at the same instant their plan did — with the `past_due` copy, up
 * to that moment, promising "access continues during the retry window".
 *
 * A test that only asserted "past_due shows a banner" passed throughout, and
 * would go on passing if `unpaid` were removed again. So the `unpaid` case is
 * asserted on its COPY, not merely on a banner being present: showing the
 * retry-window sentence to a workspace whose retries are over is the specific
 * wrong answer, and it is indistinguishable from the right one if the test
 * only counts alerts.
 *
 * AGL-2413's lesson applied to a fixture: the shapes below are what the
 * WEBHOOK actually writes (`billingStatus` mirrored onto the org doc by
 * `writeOrgBilling`), not a hand-made convenience shape.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

export {}

const mockOrg: { value: Record<string, unknown> | undefined } = { value: {} }
const mockScope = { orgWide: true, loaded: true }

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({}),
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: null }),
  useScopeTokens: () => mockScope,
}))

jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => undefined,
}))

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ pathOrgSlug: 'acme', currentOrg: { slug: 'acme' } }),
}))

jest.mock('../hooks/use-secondary-nav', () => ({
  __esModule: true,
  useUrlNamesOrg: () => true,
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg.value, orgId: 'org-1' }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  QuotaWarningsBanner,
} = require('../components/quota-warnings-banner.component')

/** Exactly what the webhook mirror leaves on the org doc for each status. */
function orgAt(billingStatus: string) {
  return { plan: 'starter', billingStatus, slug: 'acme' }
}

function renderBanner(org: Record<string, unknown> | undefined) {
  mockOrg.value = org
  mockScope.orgWide = true
  mockScope.loaded = true
  return render(<QuotaWarningsBanner />)
}

describe('the dunning banner survives the flip to unpaid (AGL-1877)', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  it('warns during the retry window on past_due, promising continued access', () => {
    renderBanner(orgAt('past_due'))
    expect(screen.getByText(/last payment failed/i)).toBeTruthy()
    expect(screen.getByText(/access continues during the retry window/i)).toBeTruthy()
  })

  it('STILL warns once the subscription is unpaid — the plan has gone', () => {
    renderBanner(orgAt('unpaid'))
    expect(screen.getByText(/plan has stopped/i)).toBeTruthy()
  })

  it('and STOPS promising continued access, because there is none', () => {
    // The negative half, and the one that matters: a banner that renders on
    // `unpaid` while repeating the `past_due` sentence is worse than no
    // banner, and "an alert is present" cannot tell the two apart.
    renderBanner(orgAt('unpaid'))
    expect(screen.queryByText(/access continues during the retry window/i)).toBeNull()
  })

  it('says nothing at all while the subscription is healthy — the control', () => {
    // Without this, "always render a banner" passes both cases above.
    renderBanner(orgAt('active'))
    expect(screen.queryByText(/payment/i)).toBeNull()
    expect(screen.queryByText(/plan has stopped/i)).toBeNull()
  })

  it('says nothing for a workspace with no subscription at all', () => {
    renderBanner({ plan: 'free', slug: 'acme' })
    expect(screen.queryByText(/plan has stopped/i)).toBeNull()
  })

  it('rewords for a scoped collaborator, who cannot reach Billing', () => {
    mockOrg.value = orgAt('unpaid')
    mockScope.orgWide = false
    mockScope.loaded = true
    render(<QuotaWarningsBanner />)
    expect(screen.getByText(/A workspace admin needs to fix billing/i)).toBeTruthy()
  })
})
