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
 * An UNLIMITED plan cap crossing a JSON boundary, on the two seat-allocation
 * cards — the same defect as AGL-2404 and the same chain:
 *
 *  1. Enterprise sets `posRegisters` / `membersPerHost` / `maxMembersPerHost`
 *     to `UNLIMITED`, which is `Number.POSITIVE_INFINITY`.
 *  2. `JSON.stringify(Infinity)` is `null`. Both routes sent that.
 *  3. `Number(null)` is `0` and `Number.isFinite(0)` is TRUE, so nothing
 *     guarding "is this payload usable" could see it.
 *
 * THE DISPLAY was the visible half — "Every site can run null registers on
 * your current plan". The COMPARISONS were the damaging half, because they do
 * not fail loudly, they just answer wrong:
 *
 *   `1 > null`   is TRUE  → a site running one register on an uncapped plan
 *                           was flagged "1 over the limit", and a site with
 *                           one collaborator raised the grandfather notice,
 *                           directly beneath a readout of `1/∞`.
 *   `null >= null` is TRUE → the same collaborator row claimed it was "At
 *                           your plan's maximum of null per site — more seats
 *                           can't raise it, upgrade instead", on the plan
 *                           there is nothing above.
 *
 * A false limit warning on a plan with no limit, addressed to the customers
 * paying the most for not having one.
 *
 * The fix is the AGL-2404 wire contract: each route sends a FINITE number
 * plus an explicit `*Unlimited` boolean, because `null` alone cannot
 * distinguish "unlimited" from "the field is missing" — and the cards rebuild
 * the `UNLIMITED` sentinel from the flag before any arithmetic runs.
 *
 * Every payload below is written the way `Response.json` really serialises
 * it: `null` for the cap and the flag beside it. A spec that passed `Infinity`
 * straight into the component would be testing a value the browser can never
 * receive.
 */

import { render, waitFor } from '@testing-library/react'

/** The card's rendered text, with markup boundaries flattened. */
const copy = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

// The cards read the signed-in user to authenticate their route call. Mocked
// so the spec needs no <FirebaseServicesProvider>; the token is never
// asserted, only that a call happens at all.
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'test-token' } }),
}))

// The cards' chrome: a snackbar, a loading queue and a confirm dialog. None
// of them is what this spec is about — it renders the cards only to read the
// copy they choose — so they are stubbed rather than stood up.
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: jest.fn() }),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => true) }),
}))

import BillingRegisterAllocationsCard from '../components/billing/billing-register-allocations-card.component'
import BillingCollaboratorAllocationsCard from '../components/billing/billing-collaborator-allocations-card.component'

/** The `action=get` payload, as the route serialises it. */
function serve(payload: Record<string, unknown>) {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch
}

const POOL = { purchased: 0, allocated: 0, available: 0, byHost: {} }

describe('Register seats · a plan with UNLIMITED registers', () => {
  it('does not tell an Enterprise customer their sites can run "null" registers', async () => {
    serve({
      pool: POOL,
      // `JSON.stringify(UNLIMITED)` — this is literally what arrives.
      planCapPerSite: 0,
      planCapPerSiteUnlimited: true,
      sites: [],
    })
    render(<BillingRegisterAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/haven’t bought any POS/i))
    // The two numbers a nulled cap produces: `null` rendered straight, and
    // the `0` a `Number(null)` coercion turns it into.
    expect(copy()).not.toMatch(/run null registers/i)
    expect(copy()).not.toMatch(/run 0 registers/i)
    expect(copy()).toMatch(/as many registers as it needs/i)
  })

  it('never reports an uncapped site as "over the limit"', async () => {
    serve({
      pool: POOL,
      planCapPerSite: 0,
      planCapPerSiteUnlimited: true,
      sites: [
        {
          hostId: 'host-1',
          displayName: 'Flagship',
          registers: 3,
          allocatedSeats: 0,
          cap: 0,
          capUnlimited: true,
        },
      ],
    })
    render(<BillingRegisterAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    // `3 > null` is true, so the pre-fix card said "3 over the limit" on a
    // plan that has no limit. This is the assertion that matters most.
    expect(copy()).not.toMatch(/over the limit/i)
    expect(copy()).toMatch(/3 registers running · can run unlimited/i)
  })

  it('survives the pre-fix wire shape — a bare null with no flag', async () => {
    // THE BACKSTOP, and the payload customers actually received: `null` for
    // the cap and no flag beside it, because the route had not been taught to
    // send one. A surface reading it must still refuse to invent a limit —
    // otherwise a route that is rolled back, or a new one written to the old
    // pattern, reintroduces the false warning silently.
    serve({
      pool: POOL,
      planCapPerSite: null,
      sites: [
        {
          hostId: 'host-1',
          displayName: 'Flagship',
          registers: 3,
          allocatedSeats: 0,
          cap: null,
        },
      ],
    })
    render(<BillingRegisterAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    expect(copy()).not.toMatch(/over the limit/i)
    expect(copy()).not.toMatch(/can run null/i)
    expect(copy()).not.toMatch(/can run 0/i)
  })

  it('still names a real cap on a plan that really has one', async () => {
    // The fix must not have converted every plan into "unlimited", which
    // would be the same defect pointed the other way.
    serve({
      pool: POOL,
      planCapPerSite: 2,
      planCapPerSiteUnlimited: false,
      sites: [
        {
          hostId: 'host-1',
          displayName: 'Flagship',
          registers: 3,
          allocatedSeats: 0,
          cap: 2,
          capUnlimited: false,
        },
      ],
    })
    render(<BillingRegisterAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    expect(copy()).toMatch(/can run 2/)
    expect(copy()).toMatch(/1 over the limit/i)
    expect(copy()).not.toMatch(/unlimited/i)
  })
})

describe('Collaborator seats · a plan with UNLIMITED collaborators', () => {
  const unlimitedState = {
    pool: POOL,
    planCapPerSite: 0,
    planCapPerSiteUnlimited: true,
    maxCapPerSite: 0,
    maxCapPerSiteUnlimited: true,
    sites: [
      {
        hostId: 'host-1',
        displayName: 'Flagship',
        collaborators: 1,
        allocatedSeats: 0,
        cap: 0,
        capUnlimited: true,
      },
    ],
  }

  it('does not raise the grandfather notice on a site that is over nothing', async () => {
    serve(unlimitedState)
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    // `1 > null` is true, so the pre-fix card announced "Flagship has more
    // collaborators than its limit. Everyone keeps their access." to an org
    // whose plan sells no limit at all.
    expect(copy()).not.toMatch(/more collaborators than its limit/i)
    expect(copy()).not.toMatch(/over the limit and kept/i)
  })

  it('does not claim an uncapped site has hit the plan’s maximum', async () => {
    // An EMPTY site on purpose. The band caption is the `else` of the
    // over-limit one, so a site that also trips the over-limit bug never
    // reaches it and an assertion made on that payload would pass without
    // ever exercising the band test.
    serve({
      ...unlimitedState,
      sites: [{ ...unlimitedState.sites[0], collaborators: 0 }],
    })
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    // `null >= null` is true — and so is `Infinity >= Infinity`, which is why
    // rehydrating alone does not fix this one and the band test is explicit.
    expect(copy()).not.toMatch(/at your plan’s maximum/i)
    expect(copy()).not.toMatch(/upgrade instead/i)
  })

  it('reads the site’s allowance as ∞ rather than 0', async () => {
    serve(unlimitedState)
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    expect(copy()).toMatch(/1\/∞ collaborators/)
    expect(copy()).not.toMatch(/1\/0 collaborators/)
  })

  it('does not tell an Enterprise customer each site can have "null" collaborators', async () => {
    serve({ ...unlimitedState, sites: [] })
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/haven’t bought any extra/i))
    expect(copy()).not.toMatch(/have null collaborators/i)
    expect(copy()).not.toMatch(/have 0 collaborators/i)
    expect(copy()).toMatch(/as many collaborators as it needs/i)
  })

  it('survives the pre-fix wire shape — a bare null with no flag', async () => {
    // The payload customers actually received. `1 > null` is TRUE and
    // `null >= null` is TRUE, so this single row produced BOTH false
    // warnings at once on an org whose plan sells no limit.
    serve({
      pool: POOL,
      planCapPerSite: null,
      maxCapPerSite: null,
      sites: [
        {
          hostId: 'host-1',
          displayName: 'Flagship',
          collaborators: 1,
          allocatedSeats: 0,
          cap: null,
        },
      ],
    })
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    expect(copy()).not.toMatch(/more collaborators than its limit/i)
    expect(copy()).not.toMatch(/over the limit and kept/i)
    expect(copy()).not.toMatch(/at your plan’s maximum/i)
    expect(copy()).toMatch(/1\/∞ collaborators/)
  })

  it('keeps the grandfather notice and the band warning on a capped plan', async () => {
    // The counter-case: a real band, really hit, really over it. Both
    // messages must survive the fix or the notice AGL-2439 exists for is gone.
    serve({
      pool: POOL,
      planCapPerSite: 1,
      planCapPerSiteUnlimited: false,
      maxCapPerSite: 1,
      maxCapPerSiteUnlimited: false,
      sites: [
        {
          hostId: 'host-1',
          displayName: 'Flagship',
          collaborators: 3,
          allocatedSeats: 0,
          cap: 1,
          capUnlimited: false,
        },
      ],
    })
    render(<BillingCollaboratorAllocationsCard orgId="org-1" canManage />)
    await waitFor(() => expect(copy()).toMatch(/Flagship/))
    expect(copy()).toMatch(/more collaborators than its limit/i)
    expect(copy()).toMatch(/2 over the limit and kept/i)
    expect(copy()).toMatch(/3\/1 collaborators/)
  })
})
