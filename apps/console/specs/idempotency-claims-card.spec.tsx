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
 * THE STRANDED-CLAIM CARD (AGL-2329, item 3).
 *
 * A capability is not a feature until the console exposes it, so the route
 * answering correctly — guarded in `idempotency-claims-route.spec.ts` — is
 * only half the fix. `status: 'pending'` was written by every claim and
 * queried by nothing; this is the screen that finally asks.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **Each row's own facts.** The fixture's two claims differ in every
 *    column, so a card printing the first claim's operation, org or age on
 *    every line looks entirely right and dies here.
 *  - **The two counts stay two counts.** A pending claim is ordinary traffic
 *    and a stranded one is a stuck key; collapsing them makes a busy minute
 *    and a dead process read identically.
 *  - **A refusal must not read as an empty queue.** "Nothing pending" and
 *    "you were refused" are opposite conclusions off the same blank card.
 */

import { render, screen, waitFor, within } from '@testing-library/react'

const NOW = 1_770_000_000_000
const MINUTE = 60_000

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    children,
  }: {
    header: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'staff-token' } }),
}))

import IdempotencyClaimsCard, {
  formatAge,
} from '../components/idempotency-claims-card.component'

/*
 * The card renders the console's shared `ListTable` now (AGL-2501), which is a
 * DataGrid: cells carry `role="gridcell"` and rows `role="row"`, not the
 * `<tr>`/`role="cell"` an MUI `<Table>` emits.
 *
 * The per-ROW scoping is the point and is kept: these assertions exist so a
 * card that reused the first claim's figures for the second is caught, and
 * checking the values existed anywhere on screen would pass for exactly that
 * bug.
 */
const rowFor = async (operation: string) => {
  const cell = await screen.findByRole('gridcell', { name: operation })
  const row = cell.closest('[role="row"]')
  if (!row) throw new Error(`no row for ${operation}`)
  return within(row as HTMLElement)
}

describe('the stranded-claim card (AGL-2329)', () => {
  const serve = (body: unknown) => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => body,
    })) as unknown as typeof fetch
  }

  it('renders each claim with its own operation, scope and age', async () => {
    serve({
      claims: [
        {
          id: 'a',
          kind: 'addon-purchase',
          // Scope and org are DIFFERENT identifiers — a claim can be scoped
          // to a host inside an org. Kept distinct in the fixture so a card
          // that rendered one value in both columns is visibly wrong.
          scopeId: 'host-globex-shop',
          orgId: 'org-globex',
          createdAtMs: NOW - 120 * MINUTE,
          ageMs: 120 * MINUTE,
          stranded: true,
        },
        {
          id: 'b',
          kind: 'checkout',
          scopeId: 'host-acme-www',
          orgId: 'org-acme',
          createdAtMs: NOW - 2 * MINUTE,
          ageMs: 2 * MINUTE,
          stranded: false,
        },
      ],
      pending: 2,
      stranded: 1,
      strandedAfterMs: 10 * MINUTE,
      truncated: false,
    })

    render(<IdempotencyClaimsCard />)

    // Per row, with different values in every column — a card reusing the
    // first claim's figures is wrong for the second and dies here.
    const dead = await rowFor('addon-purchase')
    expect(dead.getByText('host-globex-shop')).toBeTruthy()
    expect(dead.getByText('org-globex')).toBeTruthy()
    expect(dead.getByText('2h 0m')).toBeTruthy()
    expect(dead.getByText('stranded')).toBeTruthy()

    const fresh = await rowFor('checkout')
    expect(fresh.getByText('host-acme-www')).toBeTruthy()
    expect(fresh.getByText('org-acme')).toBeTruthy()
    expect(fresh.getByText('2 min')).toBeTruthy()
    expect(fresh.getByText('in flight')).toBeTruthy()

    // The two counts are shown as two numbers. Collapsing them into one makes
    // a busy minute and a dead process read the same.
    expect(await screen.findByText('2 in flight or stuck')).toBeTruthy()
    expect(await screen.findByText(/1 stranded over 10 min/)).toBeTruthy()
  })

  it('says the queue is empty rather than rendering a bare table', async () => {
    serve({
      claims: [],
      pending: 0,
      stranded: 0,
      strandedAfterMs: 10 * MINUTE,
      truncated: false,
    })
    render(<IdempotencyClaimsCard />)
    expect(
      await screen.findByText(/Every claim taken has settled or been released\./),
    ).toBeTruthy()
  })

  it('shows the route error rather than an empty, reassuring table', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Staff only' }),
    })) as unknown as typeof fetch
    render(<IdempotencyClaimsCard />)
    // "Nothing pending" and "you were refused" are opposite conclusions off
    // the same blank card.
    expect(await screen.findByText('Staff only')).toBeTruthy()
    await waitFor(() =>
      expect(screen.queryByText(/Every claim taken has settled/)).toBeNull(),
    )
  })

  it('formats an age in units an operator reads', () => {
    expect(formatAge(30_000)).toBe('under a minute')
    expect(formatAge(2 * MINUTE)).toBe('2 min')
    expect(formatAge(125 * MINUTE)).toBe('2h 5m')
    expect(formatAge(72 * 60 * MINUTE)).toBe('3 days')
    expect(formatAge(null)).toBe('unknown')
  })
})
