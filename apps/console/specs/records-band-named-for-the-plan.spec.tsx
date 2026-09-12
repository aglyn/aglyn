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
 * THE RECORDS BAND IS NAMED FOR WHAT THE PLAN HAS (AGL-2851).
 *
 * The CRM is included from Starter, and a Free workspace opens none of it.
 * The band itself does not go away there: capture still runs on every plan —
 * forms, sign-ups, bookings and orders keep writing people — and the same
 * count still caps it, so the meter has to stay. What it may not do is call
 * those records a CRM the plan cannot open, or break them into "Contacts ·
 * Companies · Deals", which are the CRM's own sections.
 *
 * ## Why the Starter half is in every case
 *
 * A component that named the plan-less wording for EVERYONE would satisfy a
 * one-sided assertion while deleting the readout every paying customer uses
 * to see what fills their band. So each case is paired: what Free reads, and
 * what the first plan with the CRM reads instead.
 *
 * ## The band is the same number either way
 *
 * `contactsPerHost` is read straight from the plan, so the meter's denominator
 * is asserted through `resolveOrgEntitlements` rather than transcribed — the
 * wording is what this file is about, not the figure.
 */

import { resolveOrgEntitlements } from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'

/** Contacts, companies and deals, so the parts caption has three real reads. */
const COUNTS: Record<string, number> = {
  contacts: 7,
  companies: 2,
  deals: 3,
}

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
  getCountFromServer: async (ref: { path: string }) => {
    const leaf = ref.path.split('/').pop() ?? ''
    return { data: () => ({ count: COUNTS[leaf] ?? 0 }) }
  },
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}))

import BillingUsageComponent from '../components/billing/billing-usage.component'

const HOSTS = [{ $id: 'host-a', displayName: 'Site A' }]

const FREE = { $id: 'org-1', plan: 'free' } as never
/** The first plan that carries the CRM — the control in every case below. */
const STARTER = { $id: 'org-1', plan: 'starter' } as never

const CRM_METER = 'CRM records (organization)'
const CAPTURE_METER = 'Stored records (organization)'

beforeEach(() => {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/billing/host-usage')) {
      return { ok: true, json: async () => ({ monthPageViews: 0 }) }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as never
})

/** Render the page for one org and wait for the records meter to settle. */
async function meterFor(org: never, label: string): Promise<HTMLElement> {
  render(<BillingUsageComponent org={org} hosts={HOSTS} />)
  const row = screen.getByText(label).parentElement as HTMLElement
  const band = resolveOrgEntitlements(org).contactsPerHost
  await waitFor(() => {
    expect(row.textContent).toContain(
      `${COUNTS.contacts + COUNTS.companies + COUNTS.deals} / ${band}`,
    )
  })
  return row
}

describe('the fixture plans really do differ over the CRM', () => {
  it('Free carries none of it and Starter carries it', () => {
    expect(resolveOrgEntitlements(FREE).features.crm).toBe(false)
    expect(resolveOrgEntitlements(STARTER).features.crm).toBe(true)
  })

  it('and both are held to a records band, so the meter has work to do', () => {
    expect(resolveOrgEntitlements(FREE).contactsPerHost).toBeGreaterThan(0)
    expect(resolveOrgEntitlements(STARTER).contactsPerHost).toBeGreaterThan(0)
  })
})

describe('the meter names what the plan has (AGL-2851)', () => {
  it('reads stored records on Free, and says nothing about a CRM', async () => {
    await meterFor(FREE, CAPTURE_METER)
    expect(screen.queryByText(CRM_METER)).toBeNull()
  })

  it('reads CRM records on Starter', async () => {
    await meterFor(STARTER, CRM_METER)
    expect(screen.queryByText(CAPTURE_METER)).toBeNull()
  })
})

describe('the caption under it (AGL-2851)', () => {
  it('tells a Free workspace what the band stops, and where the CRM starts', async () => {
    await meterFor(FREE, CAPTURE_METER)
    // The cap is on CAPTURE, which runs on every plan — so the sentence is
    // about new people arriving, not about a locked section.
    expect(
      screen.getByText(/your sites stop adding new people/),
    ).toBeTruthy()
    // Named rather than derived through `planLabelGrantingFeature`, which is
    // the call the component makes: deriving it here would assert `x === x`
    // and pass on a page naming the wrong tier.
    expect(
      screen.getByText(/included from Starter\./),
    ).toBeTruthy()
  })

  it('breaks the band into the CRM sections that fill it, on Starter', async () => {
    await meterFor(STARTER, CRM_METER)
    expect(
      screen.getByText(
        `Contacts ${COUNTS.contacts} · Companies ${COUNTS.companies} · ` +
          `Deals ${COUNTS.deals}`,
      ),
    ).toBeTruthy()
  })

  it('NEGATIVE CONTROL: Free is not shown the sections it cannot open', async () => {
    await meterFor(FREE, CAPTURE_METER)
    expect(screen.queryByText(/Companies \d+ · Deals \d+/)).toBeNull()
  })
})
