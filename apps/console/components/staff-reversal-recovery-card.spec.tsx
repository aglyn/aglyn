/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * The refund-reversal recovery SURFACE (AGL-2309).
 *
 * The query is only half the fix. `reversalOwedCents` was write-only because
 * nothing read it, and a route nobody renders is the same condition with an
 * extra file in it — the AGL-1900 rule: a capability is not a feature
 * until the console exposes it. So the first assertion here is not a
 * behaviour, it is that the card is MOUNTED, read off the page source.
 *
 * After that, every assertion is about a DOLLAR FIGURE reaching the screen.
 * "A row rendered" is precisely the check this whole class of defect passes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: any) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))

import StaffReversalRecoveryCard, {
  type ReversalRecoveryRow,
} from './staff-reversal-recovery-card.component'

/**
 * The two refusals the route projects, with DIFFERENT owed amounts.
 *
 * 3695 and 5912 are what the webhook computes for a $50 and an $80 refund of
 * the AGL-1639 worked example. They differ so that no single constant, and no
 * "render the first row's value for every row" bug, can satisfy both.
 */
const rows: ReversalRecoveryRow[] = [
  {
    $id: 'cs_large',
    listingId: 'Weather Widget',
    sellerOrgId: 'seller-large',
    buyerUid: 'buyer-2',
    owedCents: 5912,
    reason: 'no-transfer-on-charge',
    cause: 'refund',
    failedAt: 1755000000000,
  },
  {
    $id: 'cs_small',
    listingId: 'Booking Form',
    sellerOrgId: 'seller-small',
    buyerUid: 'buyer-1',
    owedCents: 3695,
    reason: 'reversal-refused',
    cause: 'partial-refund',
    failedAt: 1754000000000,
  },
]

describe('the card is on the staff overview at all', () => {
  it('is mounted by the overview page, fed from the overview payload', () => {
    const page = readFileSync(
      join(__dirname, '../app/(app)/admin/overview/page.tsx'),
      'utf8',
    )
    expect(page).toContain('StaffReversalRecoveryCard')
    // Fed from the route's own projection rather than a second fetch — two
    // reads of the same money is how a total and its rows start disagreeing.
    expect(page).toContain('data?.reversalRecovery')
    expect(page).toContain('metrics?.reversalOwedCents')
  })
})

describe('THE AMOUNT REACHES THE SCREEN', () => {
  it('shows each row’s own owed dollars, not one figure repeated', () => {
    render(<StaffReversalRecoveryCard rows={rows} owedCents={3695 + 5912} />)
    expect(screen.getByText(/\$59\.12 owed/)).toBeTruthy()
    expect(screen.getByText(/\$36\.95 owed/)).toBeTruthy()
  })

  it('puts the TOTAL outstanding in the header, where staff read first', () => {
    render(<StaffReversalRecoveryCard rows={rows} owedCents={3695 + 5912} />)
    // $96.07 — the sum. A header wired to either row would read $59.12 or
    // $36.95 and look entirely plausible.
    expect(screen.getByLabelText(/Refund reversals to recover — \$96\.07/)).toBeTruthy()
  })

  it('names the reason and the seller, so the row is chaseable', () => {
    render(<StaffReversalRecoveryCard rows={rows} owedCents={3695 + 5912} />)
    expect(screen.getByText(/reversal-refused/)).toBeTruthy()
    expect(screen.getByText(/seller seller-small/)).toBeTruthy()
    expect(screen.getByText(/Booking Form/)).toBeTruthy()
  })

  it('says "amount unknown" rather than $0.00 when the webhook never learned it', () => {
    // `no-charge-on-cause` settles without an amount. Rendering "$0.00 owed"
    // there reads as "nothing owed" on a row that is on this queue precisely
    // because something is — the one row a human most needs to open.
    render(
      <StaffReversalRecoveryCard
        rows={[
          {
            $id: 'cs_unknown',
            listingId: 'Gallery Block',
            sellerOrgId: 'seller-x',
            buyerUid: 'buyer-3',
            owedCents: 0,
            reason: 'no-charge-on-cause',
            cause: 'refund',
            failedAt: 1754000000000,
          },
        ]}
        owedCents={0}
      />,
    )
    expect(screen.getByText(/amount unknown/)).toBeTruthy()
    expect(screen.queryByText(/\$0\.00 owed/)).toBeNull()
    // With nothing quantified there is no total to put in the header.
    expect(screen.getByLabelText('Refund reversals to recover')).toBeTruthy()
  })
})

describe('an empty queue is a real answer', () => {
  it('says nothing is outstanding rather than rendering an empty card', () => {
    render(<StaffReversalRecoveryCard rows={[]} owedCents={0} />)
    expect(screen.getByText(/Nothing outstanding/)).toBeTruthy()
  })
})
