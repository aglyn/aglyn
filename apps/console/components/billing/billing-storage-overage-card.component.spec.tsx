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
 * AGL-1957: `/api/billing/storage-overage` — the only writer of the storage
 * opt-in — had zero callers, so the AGL-1886 soft cap could not be turned on
 * by anybody. The media gate refused uploads with "turn it on in Billing" and
 * Billing had nothing to turn on.
 *
 * These cover the states that decide whether the consent is real: that the
 * price is named BEFORE the button, that the ceiling travels with the
 * acknowledgement, and that turning it off is never harder than turning it on.
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

/** A metered plan that has not opted in — the state every metered org starts in. */
const NOT_ACKNOWLEDGED = {
  acknowledged: false,
  monthlyCeilingUsd: 0,
  metered: true,
  defaultCeilingUsd: 25,
  maxCeilingUsd: 5000,
  includedStoragePerSiteMb: 10240,
  pricePerGbUsd: 0.0338,
}

const ACKNOWLEDGED = {
  ...NOT_ACKNOWLEDGED,
  acknowledged: true,
  monthlyCeilingUsd: 40,
}

beforeEach(() => {
  mockConfirm.mockReset()
  mockConfirm.mockReturnValue(Promise.resolve())
  mockEnqueueSnackbar.mockReset()
})

describe('BillingStorageOverageCard (AGL-1957)', () => {
  it('claims nothing about the opt-in while the request is in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Loading your storage settings…')).toBeTruthy()
    // "Metered storage off" is a claim about this org's billing CONSENT.
    // Rendering it before the answer arrives would offer an org that already
    // opted in a button to opt in again.
    expect(screen.queryByText('Metered storage off')).toBeNull()
  })

  it('reports a failed load as a failure, not as "off"', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'nope' }, 500),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    await screen.findByText(/couldn.t load your storage settings/)
    expect(screen.queryByText('Metered storage off')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('names the price and the included allowance BEFORE the opt-in button', async () => {
    // Consent to a charge that was not priced is not consent. The rate comes
    // from the route (same constants the rollup bills from), so the number
    // here is the number invoiced.
    global.fetch = jest.fn(async () =>
      jsonResponse(NOT_ACKNOWLEDGED),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/10240 MB/)).toBeTruthy()
    expect(screen.getByText(/\$0\.034 per GB/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Turn on metered storage' }),
    ).toBeTruthy()
  })

  it('sends the ceiling WITH the acknowledgement', async () => {
    // THE CENTRAL CASE. An acknowledgement with no bound is consent to any
    // amount — the surprise bill this whole feature exists to prevent. Forced
    // red by dropping `monthlyCeilingUsd` from the request: the route then
    // applies its $25 default and the number the customer typed and agreed to
    // is silently discarded.
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      calls.push(body)
      if (body.action === 'get') return jsonResponse(NOT_ACKNOWLEDGED)
      return jsonResponse({ ok: true, acknowledged: true, monthlyCeilingUsd: 60 })
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    const field = await screen.findByLabelText(/Monthly limit/)
    fireEvent.change(field, { target: { value: '60' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on metered storage' }),
    )

    await waitFor(() =>
      expect(
        calls.find((call) => call.action === 'acknowledge'),
      ).toMatchObject({ orgId: 'org-1', monthlyCeilingUsd: 60 }),
    )
  })

  it('shows the route’s own refusal rather than inventing one', async () => {
    // The legal ceiling range lives in the route. A client-side copy would be
    // a second source of truth for what a valid consent is.
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      if (body.action === 'get') return jsonResponse(NOT_ACKNOWLEDGED)
      return jsonResponse(
        {
          error: 'Set a monthly storage limit between $1 and $5000.',
          code: 'invalid_ceiling',
        },
        400,
      )
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    const field = await screen.findByLabelText(/Monthly limit/)
    fireEvent.change(field, { target: { value: '999999' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on metered storage' }),
    )

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('between $1 and $5000'),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('shows an opted-in org its ceiling, and seeds the field from it', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(ACKNOWLEDGED),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Metered storage on')).toBeTruthy()
    expect(screen.getByText('$40.00/mo limit')).toBeTruthy()
    // Seeded from the acknowledged ceiling, not the default — a field that
    // reset to $25 would make "Save limit" a quiet downgrade of the bound.
    expect((screen.getByLabelText(/Monthly limit/) as HTMLInputElement).value).toBe('40')
  })

  it('CONFIRMS before turning it off, and writes nothing if declined', async () => {
    // Turning it off means new uploads start being refused. The person should
    // hear that before it happens, not from a failing upload.
    mockConfirm.mockReturnValue(Promise.reject(new Error('declined')))
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      calls.push(JSON.parse(init.body))
      return jsonResponse(ACKNOWLEDGED)
    }) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Turn off metered storage' }),
    )

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    const confirmArgs = mockConfirm.mock.calls[0] as unknown as [
      { description?: unknown },
    ]
    expect(String(confirmArgs[0].description)).toContain('Nothing is deleted')
    await waitFor(() =>
      expect(calls.filter((call) => call.action === 'revoke')).toHaveLength(0),
    )
  })

  it('lets an org OFF a plan that no longer meters still turn it off', async () => {
    // Withdrawing consent is never gated on the conditions that allowed
    // giving it. An org that downgraded after opting in would otherwise be
    // stuck showing an acknowledgement it could not remove. Forced red by
    // rendering the whole acknowledged branch behind `metered`.
    global.fetch = jest.fn(async () =>
      jsonResponse({ ...ACKNOWLEDGED, metered: false }),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(
      await screen.findByRole('button', { name: 'Turn off metered storage' }),
    ).toBeTruthy()
    // And it does not offer to raise a limit on a plan with nothing to meter.
    expect(screen.queryByRole('button', { name: 'Save limit' })).toBeNull()
  })

  it('offers nothing to turn on when the plan has a fixed cap', async () => {
    // A free org has no metered line for consent to attach to. Offering the
    // button would earn a 409 from the route and teach the customer that
    // Billing controls do not work.
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ...NOT_ACKNOWLEDGED,
        metered: false,
        includedStoragePerSiteMb: 512,
      }),
    ) as unknown as typeof fetch

    render(<BillingStorageOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText(/nothing to meter and nothing to turn on/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Turn on metered storage' }),
    ).toBeNull()
  })

  it('is read-only without billing.manage', async () => {
    // The same permission the route requires, and the same one that agrees to
    // the charge.
    global.fetch = jest.fn(async () =>
      jsonResponse(NOT_ACKNOWLEDGED),
    ) as unknown as typeof fetch

    render(
      <BillingStorageOverageCardComponent orgId="org-1" canManage={false} />,
    )

    const button = await screen.findByRole('button', {
      name: 'Turn on metered storage',
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/need the Manage billing permission/)).toBeTruthy()
  })
})
