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
 * The storage-cap card (AGL-1957, inverted 2026-08-18).
 *
 * AGL-1957 found `/api/billing/storage-overage` had zero callers, so the
 * AGL-1886 opt-in could not be given by anybody and every metered org was
 * held at a hard cap it was told to escape via a screen that did not exist.
 *
 * The card that fixed that was a CONSENT switch. Zach's 2026-08-18 correction
 * turned it into an optional CAP: storage past the band bills by default, the
 * alerts prevent the surprise, and this card exists only for a customer who
 * would rather uploads stopped than be billed.
 *
 * So these cases guard two things at once — that the default state advertises
 * BILLING rather than a wall (the inversion, visible in the UI), and that the
 * cap the customer types is the cap that travels to the route.
 *
 * Every expectation here was forced red once against the code it guards.
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

/**
 * ONE stable object across renders. `useUser` returns a stable reference in
 * the app, and the card's load effect depends on `user` — a fresh object per
 * render makes the effect re-run forever and the card sits in `pending`,
 * which is a defect in the double rather than in the card.
 */
const mockUserData = { uid: 'admin-1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUserData }),
}))

import BillingStorageOverageCardComponent from './billing-storage-overage-card.component'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

/**
 * A metered plan with NO cap — the state every metered org starts in, and
 * now the state most of them will stay in.
 */
const UNCAPPED = {
  capSet: false,
  monthlyCapUsd: null,
  metered: true,
  defaultCapUsd: 25,
  maxCapUsd: 5000,
  includedStoragePerSiteMb: 10240,
  pricePerGbUsd: 0.0338,
}

const CAPPED = {
  ...UNCAPPED,
  capSet: true,
  monthlyCapUsd: 40,
}

beforeEach(() => {
  mockConfirm.mockReset()
  mockConfirm.mockReturnValue(Promise.resolve())
  mockEnqueueSnackbar.mockReset()
})

describe('BillingStorageOverageCard (AGL-1957)', () => {
  it('claims nothing about the cap while the request is in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Loading your storage settings…')).toBeTruthy()
    // "No cap" is a claim about this org's billing settings. Rendering it
    // before the answer arrives would tell a capped org it was uncapped.
    expect(screen.queryByText('No cap — extra storage bills')).toBeNull()
  })

  it('reports a failed load as a failure, not as "no cap"', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'nope' }, 500),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    await screen.findByText(/couldn.t load your storage settings/)
    expect(screen.queryByText('No cap — extra storage bills')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('THE INVERSION, on screen: an uncapped org is told uploads KEEP WORKING', async () => {
    // The UI half of the correction. Before it, this state read "uploads are
    // refused unless you turn on metered storage" — a wall, and a demand.
    // Forced red by restoring that sentence: the assertions below flip.
    global.fetch = jest.fn(async () =>
      jsonResponse(UNCAPPED),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/keep working/)).toBeTruthy()
    expect(screen.getByText(/10240 MB/)).toBeTruthy()
    // The price is named — from the route, which serves the same constants the
    // rollup bills from (AGL-1957), so this number is the invoiced number.
    expect(screen.getByText(/\$0\.034 per GB/)).toBeTruthy()
    // And the alerts are promised, because they are the actual protection.
    expect(screen.getByText(/alert you/)).toBeTruthy()
    // The cap is offered as optional, never as a precondition.
    expect(screen.getByText(/This is optional/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set a monthly cap' })).toBeTruthy()
    // Nothing anywhere says uploads are refused in this state.
    expect(screen.queryByText(/uploads are refused/)).toBeNull()
  })

  it('sends the cap the customer TYPED', async () => {
    // THE CENTRAL CASE. Forced red by dropping `capUsd` from the request: the
    // route applies its $25 fallback and the number the customer chose is
    // silently discarded — an org that asked to stop at $2 stops at $25.
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      calls.push(body)
      if (body.action === 'get') return jsonResponse(UNCAPPED)
      return jsonResponse({ ok: true, capSet: true, monthlyCapUsd: 60 })
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    const field = await screen.findByLabelText(/Monthly cap/)
    fireEvent.change(field, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set a monthly cap' }))

    await waitFor(() =>
      expect(calls.find((call) => call.action === 'setCap')).toMatchObject({
        orgId: 'org-1',
        capUsd: 60,
      }),
    )
  })

  it('shows the route’s own refusal rather than inventing one', async () => {
    // The legal cap range lives in the route. A client-side copy would be a
    // second source of truth for what a valid cap is.
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      if (body.action === 'get') return jsonResponse(UNCAPPED)
      return jsonResponse(
        {
          error: 'Set a monthly storage cap between $1 and $5000.',
          code: 'invalid_cap',
        },
        400,
      )
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    const field = await screen.findByLabelText(/Monthly cap/)
    fireEvent.change(field, { target: { value: '999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set a monthly cap' }))

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('between $1 and $5000'),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('shows a capped org its cap, and seeds the field from it', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(CAPPED),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Monthly cap set')).toBeTruthy()
    expect(screen.getByText('$40.00/mo cap')).toBeTruthy()
    // Seeded from the cap in force, not the default — a field that reset to
    // $25 would make "Save cap" a quiet tightening of the customer's ceiling.
    expect((screen.getByLabelText(/Monthly cap/) as HTMLInputElement).value).toBe(
      '40',
    )
    // A capped org is told it is still billed BELOW the cap. The cap bounds
    // the invoice; it does not zero it, and implying otherwise would be the
    // surprise bill arriving from the other direction.
    expect(screen.getByText(/are billed at about/)).toBeTruthy()
  })

  it('CONFIRMS before removing the cap, and writes nothing if declined', async () => {
    // Removing the cap is the direction that can RAISE a bill — uploads that
    // were being refused start landing and billing. The person should hear
    // that before it happens, not from an invoice. Setting a cap is the safe
    // direction and is deliberately NOT confirmed (see the case above, which
    // clicks straight through).
    mockConfirm.mockReturnValue(Promise.reject(new Error('declined')))
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      calls.push(JSON.parse(init.body))
      return jsonResponse(CAPPED)
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove cap' }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    const confirmArgs = mockConfirm.mock.calls[0] as unknown as [
      { description?: unknown },
    ]
    // The consequence, in the words that matter: billing, with no ceiling.
    expect(String(confirmArgs[0].description)).toContain('no ceiling')
    expect(String(confirmArgs[0].description)).toContain('alerted')
    await waitFor(() =>
      expect(calls.filter((call) => call.action === 'clearCap')).toHaveLength(0),
    )
  })

  it('lets an org OFF a plan that no longer meters still remove its cap', async () => {
    // Removing a cap is never gated on the conditions that allowed setting it.
    // An org that downgraded while capped would otherwise be stuck showing a
    // control it could not clear. Forced red by rendering the whole capped
    // branch behind `metered`.
    global.fetch = jest.fn(async () =>
      jsonResponse({ ...CAPPED, metered: false }),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(
      await screen.findByRole('button', { name: 'Remove cap' }),
    ).toBeTruthy()
    // And it does not offer to edit a cap on a plan with nothing to bill.
    expect(screen.queryByRole('button', { name: 'Save cap' })).toBeNull()
  })

  it('offers no cap when the plan never bills for storage', async () => {
    // A free org has no overage for a cap to bound. Offering the control would
    // earn a 409 from the route and teach the customer that Billing controls
    // do not work — and it says plainly that free is never charged, which is
    // the property Zach asked to be true and visible.
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ...UNCAPPED,
        metered: false,
        includedStoragePerSiteMb: 250,
      }),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/never charged/)).toBeTruthy()
    expect(screen.getByText(/no overage to cap/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set a monthly cap' })).toBeNull()
  })

  it('is read-only without billing.manage', async () => {
    // The same permission the route requires — raising a cap raises what the
    // org can be invoiced, so it buys things in both directions.
    global.fetch = jest.fn(async () =>
      jsonResponse(UNCAPPED),
    ) as unknown as typeof fetch

    render(
      <BillingStorageOverageCardComponent orgId="org-1" canManage={false} />,
    )

    const button = await screen.findByRole('button', {
      name: 'Set a monthly cap',
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/need the Manage billing permission/)).toBeTruthy()
  })
})
