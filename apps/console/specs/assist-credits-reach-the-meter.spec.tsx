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
 * THE ASSIST BAND HAS AN ODOMETER, NOT JUST A CEILING.
 *
 * Assist is REFUSED at its band — it is discretionary spend, so the plan is
 * allowed to say no — which makes this meter the only thing standing between
 * a customer and learning their limit by being turned down mid-build. That is
 * the state `quota-surface-coverage.spec.ts` exists to refuse, one level up.
 *
 * That guard reads the component's text for the entitlement key and cannot
 * strip comments, so a meter reduced to `limit={0}` still satisfies it as long
 * as the key survives in prose nearby. This file closes that gap for this one
 * key by rendering the component and reading the row.
 *
 * ## Credits, and no dollars anywhere near the page
 *
 * The stored figure is `estCostUsd` — our provider bill at the serving model's
 * list rates. It reaches the browser only as credits, through
 * `/api/billing/assist-credits`, and the component asks that route rather than
 * Firestore because `orgs/{id}/assistUsage` is default-deny to every client.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => ({ managerSeats: 1, collaboratorSeats: 0 }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

/** Business: 18,000 credits included. */
const BUSINESS = { $id: 'org-1', plan: 'business' } as any
/** Free: `assistCreditsPerMonth: 0` — the plan sells no band. */
const FREE = { $id: 'org-1', plan: 'free' } as any
const HOSTS = [{ $id: 'host-a', displayName: 'Site A' }]

const METER = 'Aglyn Assist credits (this month)'

/** What `/api/billing/assist-credits` answers, or `null` for no band. */
let mockCredits: { used: number; limit: number; remaining: number } | null

beforeEach(() => {
  mockCredits = { used: 4_500, limit: 18_000, remaining: 13_500 }
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (url.startsWith('/api/billing/assist-credits')) {
      return { ok: true, json: async () => ({ credits: mockCredits }) }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

describe('the fixture is a plan that really sells a band', () => {
  it('Business includes 18,000 credits and Free includes none', () => {
    expect(PLAN_ENTITLEMENTS.business.assistCreditsPerMonth).toBe(18_000)
    expect(PLAN_ENTITLEMENTS.free.assistCreditsPerMonth).toBe(0)
  })
})

describe('a workspace with a band can see how much of it is left', () => {
  it('renders the drawn credits against the PLAN band', async () => {
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => {
      const row = screen.getByText(METER).parentElement?.parentElement
      // `UsageMeter` prints both figures ungrouped, as every meter on the
      // page does — `100000` for API requests included.
      expect(row?.textContent).toContain('4500')
    })
    // The denominator is the band the plan sells, read from the entitlement
    // rather than from whatever the route happened to answer — a meter that
    // took its own limit from the server would render any number the server
    // sent, including one no plan includes.
    const row = screen.getByText(METER).parentElement?.parentElement
    expect(row?.textContent).toContain(
      String(PLAN_ENTITLEMENTS.business.assistCreditsPerMonth),
    )
    // And nothing on the page quotes our provider bill. 4,500 credits is
    // $4.50 of model spend; that figure must appear nowhere.
    expect(document.body.textContent).not.toContain('$4.50')
  })

  it('keeps the UNMETERED state when the read fails, never a zero', async () => {
    // A failed read rendering "0 used" would tell a workspace it has its whole
    // band in hand at the moment we cannot tell whether it does.
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as any
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    expect(row?.textContent).toContain('not yet metered')
    expect(row?.textContent).not.toContain('0 / 18000')
  })

  it('stays UNMETERED when the answer carries no standing either', async () => {
    // The second failure shape, and the one an `?? { used: 0 }` fallback
    // would swallow: the request SUCCEEDS and answers `credits: null`. On a
    // plan that sells a band that is an answer we cannot use, and defaulting
    // it to zero would tell the workspace its whole band is in hand.
    mockCredits = null
    render(<BillingUsageComponent org={BUSINESS} hosts={HOSTS} />)
    await waitFor(() => expect(screen.getByText(METER)).toBeTruthy())
    const row = screen.getByText(METER).parentElement?.parentElement
    expect(row?.textContent).toContain('not yet metered')
    expect(row?.textContent).not.toContain('0 / 18000')
  })

  it('renders NO meter for a plan that sells no band', async () => {
    // "0 of 0" is not a readout of anything, and Free's assistant is bounded
    // by a message cap the panel already states.
    mockCredits = null
    render(<BillingUsageComponent org={FREE} hosts={HOSTS} />)
    await waitFor(() => expect(screen.queryAllByText(METER)).toHaveLength(0))
  })
})
