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
 * AGL-1947: a merchant could BUY POS register seats and had nowhere to put
 * them — `/api/billing/register-allocations` had zero callers in the repo.
 *
 * These cover the states that decide whether the surface is honest rather
 * than merely present. The one that matters most is over-allocation: the
 * route owns that refusal, and a card that pre-empts it with a client-side
 * guess off a stale payload would either block a legal assignment or show
 * capacity the enforcement then refuses.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockConfirm = jest.fn(() => Promise.resolve())
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'admin-1', getIdToken: async () => 'tok' } }),
}))

import BillingRegisterAllocationsCardComponent from './billing-register-allocations-card.component'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

/** Two seats bought, one assigned, one free. */
const POOL_STATE = {
  pool: {
    purchased: 2,
    allocated: 1,
    available: 1,
    byHost: { 'host-a': 1 },
  },
  planCapPerSite: 1,
  sites: [
    {
      hostId: 'host-a',
      displayName: 'Main Street',
      registers: 2,
      allocatedSeats: 1,
      cap: 2,
    },
    {
      hostId: 'host-b',
      displayName: 'Airport Kiosk',
      registers: 0,
      allocatedSeats: 0,
      cap: 1,
    },
  ],
}

beforeEach(() => {
  mockConfirm.mockReset()
  mockConfirm.mockReturnValue(Promise.resolve())
  mockEnqueueSnackbar.mockReset()
})

describe('BillingRegisterAllocationsCard (AGL-1947)', () => {
  it('claims nothing about the pool while the request is in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Loading register seats…')).toBeTruthy()
    // "You haven't bought any" is a claim about this org's BILLING. Making it
    // before the answer arrives tells a paying merchant they own nothing.
    expect(screen.queryByText(/haven.t bought any/)).toBeNull()
  })

  it('reports a failed load as a failure, not as an empty pool', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'nope' }, 500),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    await screen.findByText(/couldn.t load your register seats/)
    expect(screen.queryByText(/haven.t bought any/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('shows purchased / assigned / unassigned once loaded', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(POOL_STATE),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('2 purchased')).toBeTruthy()
    expect(screen.getByText('1 assigned')).toBeTruthy()
    expect(screen.getByText('1 unassigned')).toBeTruthy()
    expect(screen.getByText('Main Street')).toBeTruthy()
    expect(screen.getByText('Airport Kiosk')).toBeTruthy()
  })

  it('tells an org with no seats how to buy one, without a site list claim', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        pool: { purchased: 0, allocated: 0, available: 0, byHost: {} },
        planCapPerSite: 1,
        sites: [{ ...POOL_STATE.sites[1] }],
      }),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/haven.t bought any POS register seats/)).toBeTruthy()
  })

  it('tells a fully-allocated org to move a seat rather than only to buy', async () => {
    // Telling this owner to buy another would sell them a register they are
    // already paying for — the AGL-1775 rule, mirrored from the registers card.
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ...POOL_STATE,
        pool: { purchased: 2, allocated: 2, available: 0, byHost: { 'host-a': 2 } },
      }),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/Every purchased seat is assigned/)).toBeTruthy()
    expect(screen.getByText(/move a seat off another site/)).toBeTruthy()
  })

  it('SENDS the assignment when the pool looks empty and shows the route’s refusal', async () => {
    // THE CENTRAL CASE. The "+" must not be disabled on `available === 0`:
    // that is a client-side guess against a payload that is already stale.
    // The route decides, and its 409 names the real numbers.
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      calls.push(body)
      if (body.action === 'get') {
        return jsonResponse({
          ...POOL_STATE,
          pool: { purchased: 1, allocated: 1, available: 0, byHost: { 'host-a': 1 } },
        })
      }
      return jsonResponse(
        {
          error:
            'You have 1 purchased register seat and 0 unassigned — buy ' +
            'another in Billing → Add-ons to assign more.',
          code: 'pool_exhausted',
        },
        409,
      )
    }) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    const addButton = await screen.findByRole('button', {
      name: 'Assign a register seat to Airport Kiosk',
    })
    expect((addButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(addButton)

    await waitFor(() =>
      expect(calls.some((call) => call.action === 'set')).toBe(true),
    )
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('buy another in Billing → Add-ons'),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('warns BEFORE stranding a running register, and does not write if declined', async () => {
    // Main Street runs 2 registers on a plan cap of 1. Releasing its seat
    // leaves one that cannot take sales — the merchant hears it here, not
    // from a cashier with a customer standing in front of them.
    mockConfirm.mockReturnValue(Promise.reject(new Error('declined')))
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      calls.push(body)
      return jsonResponse(POOL_STATE)
    }) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    const removeButton = await screen.findByRole('button', {
      name: 'Remove a register seat from Main Street',
    })
    fireEvent.click(removeButton)

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    // `mockConfirm` is declared with no parameters so jest can hoist it, so
    // the recorded args are typed as an empty tuple.
    const confirmArgs = mockConfirm.mock.calls[0] as unknown as [
      { description?: unknown },
    ]
    expect(String(confirmArgs[0].description)).toContain('cannot take sales')
    // Declined means NOTHING was written.
    await waitFor(() =>
      expect(calls.filter((call) => call.action === 'set')).toHaveLength(0),
    )
  })

  it('does not warn when the move strands nothing', async () => {
    // Airport Kiosk runs 0 registers; assigning it a seat cannot strand one.
    // A confirm on every move would train people to click through the one
    // that matters.
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      if (body.action === 'get') return jsonResponse(POOL_STATE)
      return jsonResponse({ ok: true, pool: POOL_STATE.pool, strandedRegisters: 0 })
    }) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Assign a register seat to Airport Kiosk',
      }),
    )

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('Airport Kiosk'),
        expect.objectContaining({ variant: 'success' }),
      ),
    )
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('is read-only without billing.manage', async () => {
    // Same permission the route requires, and the same one that BUYS the
    // seat. A viewer sees the pool and can move nothing.
    global.fetch = jest.fn(async () =>
      jsonResponse(POOL_STATE),
    ) as unknown as typeof fetch

    render(
      <BillingRegisterAllocationsCardComponent orgId="org-1" canManage={false} />,
    )

    const addButton = await screen.findByRole('button', {
      name: 'Assign a register seat to Airport Kiosk',
    })
    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Remove a register seat from Main Street',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(screen.getByText(/need the Manage billing permission/)).toBeTruthy()
  })

  it('shows a site running over its limit rather than hiding the overage', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ...POOL_STATE,
        sites: [
          { ...POOL_STATE.sites[0], allocatedSeats: 0, cap: 1, registers: 3 },
        ],
      }),
    ) as unknown as typeof fetch

    render(<BillingRegisterAllocationsCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/2 over the limit/)).toBeTruthy()
  })
})
