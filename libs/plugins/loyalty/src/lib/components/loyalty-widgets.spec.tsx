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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LOYALTY_PROGRAM_DEFAULTS } from '../model/loyalty-program'
import { centsFromDollars, dollarsFromCents } from './loyalty-api'
import { LoyaltyMembersCard } from './loyalty-members-card.component'
import { describeLedgerEntry } from './loyalty-member-dialog.component'
import { LoyaltyOrderWidget } from './loyalty-order-widget.component'
import { LoyaltyProgramCard } from './loyalty-program-card.component'

/**
 * Rewards' console widgets (AGL-3640): the program card under Promotions with
 * Save in its header, the members list paged by the server's cursor with
 * search and a member's history and adjustment, and the order dialog's
 * section, which draws nothing for an order rewards never touched. The
 * routes are a recorded mock.
 */

const request = jest.fn()
const enqueueSnackbar = jest.fn()

jest.mock('./loyalty-api', () => ({
  ...jest.requireActual('./loyalty-api'),
  useLoyaltyFetch: () => request,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const TOTALS = { members: 12, outstandingPoints: 2_500, outstandingPointsCents: 2_500, outstandingCreditCents: 4_000 }

beforeEach(() => {
  request.mockReset()
  enqueueSnackbar.mockReset()
})

describe('LoyaltyProgramCard', () => {
  it('shows the program and what members hold, and saves a change from the header', async () => {
    request.mockResolvedValueOnce({ program: LOYALTY_PROGRAM_DEFAULTS, totals: TOTALS })
    render(<LoyaltyProgramCard hostId="host-1" />)
    expect(await screen.findByText('Rewards')).toBeTruthy()
    expect(screen.getByTestId('loyalty-program-status').textContent).toBe('Off')
    expect(screen.getByText('Worth $25.00')).toBeTruthy()
    expect(screen.getByText('$40.00')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Customers earn and spend rewards'))
    fireEvent.click(screen.getByLabelText('Members can refer friends'))
    fireEvent.change(screen.getByTestId('loyalty-refereeRewardCents'), { target: { value: '7.50' } })
    request.mockResolvedValueOnce({
      program: { ...LOYALTY_PROGRAM_DEFAULTS, enabled: true, referralsEnabled: true, refereeRewardCents: 750 },
      totals: TOTALS,
    })
    fireEvent.click(save)
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('loyalty/program', {
        body: {
          hostId: 'host-1',
          program: expect.objectContaining({ enabled: true, referralsEnabled: true, refereeRewardCents: 750, earnPointsPerDollar: 5 }),
        },
      }),
    )
    await waitFor(() => expect(screen.getByTestId('loyalty-program-status').textContent).toBe('On'))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Rewards program saved', { variant: 'success' })
  })

  it('refuses a rate that is not a whole number before asking the server', async () => {
    request.mockResolvedValueOnce({ program: LOYALTY_PROGRAM_DEFAULTS, totals: TOTALS })
    render(<LoyaltyProgramCard hostId="host-1" />)
    fireEvent.change(await screen.findByTestId('loyalty-earnPointsPerDollar'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Enter whole numbers for points.', { variant: 'error' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('LoyaltyMembersCard', () => {
  const MEMBER = {
    id: 'a'.repeat(32),
    email: 'sam@example.com',
    name: 'Sam',
    points: 1_250,
    creditCents: 500,
    lifetimePoints: 2_000,
    ordersCount: 3,
    rewardsCode: 'RW-7K3P-Q9XZ-2M4D',
    referralCode: 'RF-7K3P9X',
    referred: false,
    createdAtMs: 1,
    lastOrderAtMs: 2,
  }

  it('lists a page of members and pages forward with the server’s cursor', async () => {
    request.mockImplementation(async (_route: string, options: { query: Record<string, string> }) =>
      options.query.after ? { members: [{ ...MEMBER, id: 'b'.repeat(32), email: 'zed@example.com', name: null }], next: null } : { members: [MEMBER], next: MEMBER.id },
    )
    render(<LoyaltyMembersCard hostId="host-1" />)
    expect(await screen.findByText('Sam · sam@example.com')).toBeTruthy()
    expect(screen.getByText('1,250 points · $5.00 store credit · 3 orders')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('loyalty/members', { query: { hostId: 'host-1', limit: '10', sort: 'recent' } })
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('zed@example.com')).toBeTruthy()
    expect(request).toHaveBeenLastCalledWith('loyalty/members', {
      query: { hostId: 'host-1', limit: '10', sort: 'recent', after: MEMBER.id },
    })
  })

  it('opens a member’s history and adjusts their balance once per press', async () => {
    request.mockImplementation(async (route: string, options: { body?: unknown }) => {
      if (route === 'loyalty/members') return { members: [MEMBER], next: null }
      if (route === 'loyalty/member' && !options.body) {
        return {
          member: MEMBER,
          ledger: [{ id: 'x', kind: 'redeem', points: -120, creditCents: -500, orderId: 'o', channel: 'pos', note: null, atMs: 1 }],
        }
      }
      return { member: { ...MEMBER, creditCents: 1_500 }, ledger: [], emailed: true }
    })
    render(<LoyaltyMembersCard hostId="host-1" />)
    fireEvent.click(await screen.findByText('Sam · sam@example.com'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Spent · −120 points · −$5.00 credit')).toBeTruthy()
    expect(within(dialog).getByText('Rewards code: RW-7K3P-Q9XZ-2M4D')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adjust' }))
    const adjust = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    fireEvent.change(within(adjust).getByLabelText('Store credit ($)'), { target: { value: '10' } })
    fireEvent.click(within(adjust).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('loyalty/member', {
        body: { hostId: 'host-1', memberId: MEMBER.id, points: 0, creditCents: 1_000, note: '', notify: true },
        idempotencyKey: expect.any(String),
      }),
    )
    expect(enqueueSnackbar).toHaveBeenCalledWith('Saved, and the customer was emailed', { variant: 'success' })
  })
})

describe('LoyaltyOrderWidget', () => {
  it('draws nothing for an order rewards never touched', async () => {
    request.mockResolvedValue({
      order: { email: null, memberId: null, earnedPoints: 0, reversedPoints: 0, spentCents: 0, spentPoints: 0, spentCreditCents: 0, restoredCents: 0, entries: [] },
    })
    const { container } = render(<LoyaltyOrderWidget hostId="host-1" order={{ id: 'o-1' }} />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('says what the order earned and spent', async () => {
    request.mockResolvedValue({
      order: {
        email: 'sam@example.com',
        memberId: 'm',
        earnedPoints: 45,
        reversedPoints: 10,
        spentCents: 800,
        spentPoints: 300,
        spentCreditCents: 500,
        restoredCents: 0,
        entries: [],
      },
    })
    render(<LoyaltyOrderWidget hostId="host-1" order={{ id: 'o-1' }} />)
    expect(await screen.findByText('Earned 45 points for sam@example.com, 10 taken back by refunds')).toBeTruthy()
    expect(screen.getByText('Paid $8.00 with rewards ($5.00 store credit and 300 points)')).toBeTruthy()
  })
})

describe('the money a field holds', () => {
  it('reads dollars as whole cents and refuses anything else', () => {
    expect(centsFromDollars('$7.50')).toBe(750)
    expect(centsFromDollars('-5')).toBe(-500)
    expect(centsFromDollars('')).toBe(0)
    expect(centsFromDollars('7.555')).toBeNull()
    expect(centsFromDollars('abc')).toBeNull()
    expect(dollarsFromCents(1_000)).toBe('10.00')
    expect(describeLedgerEntry({ id: 'x', kind: 'earn', points: 45, creditCents: 0, orderId: null, channel: null, note: null, atMs: 0 })).toBe(
      'Earned · +45 points',
    )
  })
})
