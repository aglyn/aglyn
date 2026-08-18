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
 * AGL-1938: `/pricing` publishes a "Commerce analytics" row as Pro-and-up
 * (`—, —, ✓, ✓, ✓, ✓, ✓, ✓`) and `/product/commerce` promises "a built-in
 * commerce analytics dashboard". The `commerceAnalytics` entitlement that
 * is supposed to sell that was INERT — its only occurrence outside
 * `plan-entitlements.ts` was its own type declaration — so this card
 * handed the Pro surface to every commerce org, Starter included.
 *
 * `checkEntitlement` is deliberately NOT mocked: the real plan table is
 * what the marketing page is a claim ABOUT, so a stubbed gate could agree
 * with the test and still disagree with `/pricing`. The org fixtures carry
 * real plan ids and the assertions read the real `PLAN_ENTITLEMENTS` rows.
 *
 * Each case is written so it FAILS with the gate deleted:
 *  - starter would render the revenue figure instead of the upsell;
 *  - the pending case would render the upsell instead of "Checking…",
 *    which is the `checkEntitlement(undefined) === free tier` trap that
 *    `useOrgPlan` exists to close.
 */

import { render, screen } from '@testing-library/react'

const orgPlan = { org: undefined as unknown, ready: false }

/** A paid, in-window order — $123.45 of 30-day revenue. */
const orderDocs: Array<Record<string, unknown>> = []
const productDocs: Array<Record<string, unknown>> = []
const collections: Record<string, Array<Record<string, unknown>>> = {
  orders: orderDocs,
  products: productDocs,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => orgPlan,
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/shop',
    orgSlug: 'acme',
    subdomain: 'shop',
  }),
  useFirestoreCollection: (build: () => unknown) => {
    const name = build() as string
    return { data: collections[name] ?? [] }
  },
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    header,
    children,
  }: {
    header?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <div>{header}</div>
      {children}
    </div>
  ),
  AppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import CommerceGlanceCard from './commerce-glance-card.component'

/**
 * TWO orders, so 30-day revenue ($246.90) differs from average order value
 * ($123.45). With one order the card renders the same string twice and the
 * "figures are present" assertion would be ambiguous about which it found.
 */
const REVENUE = '$246.90'
const UPSELL = /Commerce analytics .* is a Pro feature/s
const PENDING = /Checking your plan/

beforeEach(() => {
  orgPlan.org = undefined
  orgPlan.ready = false
  productDocs.length = 0
  orderDocs.length = 0
  orderDocs.push(
    {
      $id: 'order-1',
      createdAtMs: Date.now(),
      status: 'paid',
      totals: { totalCents: 12345 },
    },
    {
      $id: 'order-2',
      createdAtMs: Date.now(),
      status: 'paid',
      totals: { totalCents: 12345 },
    },
  )
})

/** `posRegisters: 0`, and crucially `commerceAnalytics: false`. */
function starterOrgLands() {
  orgPlan.org = { plan: 'starter', ownerUid: 'uid-owner' }
  orgPlan.ready = true
}

/** The first plan `/pricing` shows a ✓ for on the Commerce analytics row. */
function proOrgLands() {
  orgPlan.org = { plan: 'pro', ownerUid: 'uid-owner' }
  orgPlan.ready = true
}

describe('CommerceGlanceCard · commerceAnalytics gate', () => {
  it('withholds the figures on Starter, which /pricing marks "—"', () => {
    starterOrgLands()
    render(<CommerceGlanceCard hostId="host-1" />)

    expect(screen.queryByText(REVENUE)).toBeNull()
    expect(screen.getByText(UPSELL)).toBeTruthy()
  })

  it('renders the figures on Pro, which /pricing marks "✓"', () => {
    proOrgLands()
    render(<CommerceGlanceCard hostId="host-1" />)

    expect(screen.getByText(REVENUE)).toBeTruthy()
    expect(screen.queryByText(UPSELL)).toBeNull()
  })

  it('never accuses a paying org while the plan doc is still in flight', () => {
    // `ready: false` with no org — exactly what `useOrgPlan` returns during
    // the `hostIndex` lookup. An unguarded `checkEntitlement(undefined)`
    // resolves the FREE tier, so the upsell would libel a Pro customer.
    render(<CommerceGlanceCard hostId="host-1" />)

    expect(screen.getByText(PENDING)).toBeTruthy()
    expect(screen.queryByText(UPSELL)).toBeNull()
    expect(screen.queryByText(REVENUE)).toBeNull()
  })

  it('stays invisible for a host with no catalog and no orders', () => {
    proOrgLands()
    orderDocs.length = 0
    const { container } = render(<CommerceGlanceCard hostId="host-1" />)

    expect(container.textContent).toBe('')
  })
})
