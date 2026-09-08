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
 * The AI assist hard-cap card (AGL-2653).
 *
 * Two things are guarded at once: that the default state advertises SELLING
 * past the band rather than a wall (the decision, visible in the UI), and
 * that the boolean the customer throws is the boolean that travels to the
 * route. Every expectation here was forced red once against the code it
 * guards.
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
 * ONE stable object across renders. The card's load effect depends on
 * `user`, and a fresh object per render makes the effect re-run forever.
 */
const mockUserData = { uid: 'admin-1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUserData }),
}))

import BillingAssistOverageCardComponent from './billing-assist-overage-card.component'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

const LABEL = 'Stop AI assist at the included band'

/** Pro with the switch OFF — the state every paid org starts in. */
const SELLING = {
  hardCap: false,
  bandCredits: 2_750,
  overageRateUsdPer1k: 3,
  sellsOverage: true,
  label: LABEL,
}

const STOPPED = { ...SELLING, hardCap: true }

/** Enterprise: a band, no rate, nothing to switch. */
const CONTRACTUAL = {
  hardCap: false,
  bandCredits: 87_000,
  overageRateUsdPer1k: null,
  sellsOverage: false,
  label: LABEL,
}

/** Free: no band at all. */
const BANDLESS = { ...CONTRACTUAL, bandCredits: null }

/** Every body the card posted, in order. */
function postedBodies(): Record<string, unknown>[] {
  return (global.fetch as jest.Mock).mock.calls.map(([, init]) =>
    JSON.parse(String((init as RequestInit).body)),
  )
}

beforeEach(() => {
  mockConfirm.mockReset()
  mockConfirm.mockReturnValue(Promise.resolve())
  mockEnqueueSnackbar.mockReset()
})

describe('BillingAssistOverageCard (AGL-2653)', () => {
  it('claims nothing about the switch while the request is in flight', async () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('Loading your AI assist settings…')).toBeTruthy()
    // "No stop" is a claim about this org's billing settings. Rendering it
    // before the answer arrives would tell a stopped org it was selling.
    expect(screen.queryByText('No stop — extra credits bill')).toBeNull()
  })

  it('the DEFAULT advertises selling past the band, with the band and the rate', async () => {
    // FORCED RED by rendering the chip from `!hardCap ? 'Stops…'`: the
    // inverted label failed the first query.
    global.fetch = jest.fn(async () => jsonResponse(SELLING)) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)

    expect(await screen.findByText('No stop — extra credits bill')).toBeTruthy()
    expect(screen.getByText('2,750 credits/mo included')).toBeTruthy()
    expect(screen.getByText(/billed at \$3\.00 per 1,000 on your monthly invoice/)).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: LABEL }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(false)
    // The read is the `get` action, and nothing else was posted.
    expect(postedBodies()).toEqual([{ orgId: 'org-1', action: 'get' }])
  })

  it('turning it ON posts `setHardCap: true` with no confirmation', async () => {
    // FORCED RED by posting `hardCap: String(checked)`: the body then carried
    // the string "true", which the route refuses with a 400.
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'setHardCap') return jsonResponse({ ok: true, hardCap: true })
      return jsonResponse(SELLING)
    }) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    const toggle = await screen.findByRole('switch', { name: LABEL })
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'setHardCap',
        hardCap: true,
      }),
    )
    // On never raises a bill, so it is a plain click.
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/will stop at your included credits/),
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('turning it OFF asks first — that is the direction that can raise a bill — then posts false', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'setHardCap') return jsonResponse({ ok: true, hardCap: false })
      return jsonResponse(STOPPED)
    }) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    expect(await screen.findByText('Stops at the included band')).toBeTruthy()
    const toggle = (await screen.findByRole('switch', { name: LABEL })) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    // The dialog quotes the rate the org is agreeing to.
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/\$3\.00 per 1,000/),
      }),
    )
    await waitFor(() =>
      expect(postedBodies()).toContainEqual({
        orgId: 'org-1',
        action: 'setHardCap',
        hardCap: false,
      }),
    )
  })

  it('a declined confirmation posts NOTHING', async () => {
    mockConfirm.mockReturnValue(Promise.reject(new Error('cancelled')))
    global.fetch = jest.fn(async () => jsonResponse(STOPPED)) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    fireEvent.click(await screen.findByRole('switch', { name: LABEL }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(postedBodies().filter((body) => body.action === 'setHardCap')).toEqual([])
  })

  it('renders the route’s own sentence when the write is refused', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.action === 'setHardCap') {
        return jsonResponse(
          { error: 'Your plan already stops AI assist at its included band', code: 'not_sold' },
          409,
        )
      }
      return jsonResponse(SELLING)
    }) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    fireEvent.click(await screen.findByRole('switch', { name: LABEL }))

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Your plan already stops AI assist at its included band',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('view-only without billing.manage: the switch is disabled and says why', async () => {
    global.fetch = jest.fn(async () => jsonResponse(SELLING)) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage={false} />)
    const toggle = (await screen.findByRole('switch', { name: LABEL })) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect(
      screen.getByText('You need the Manage billing permission to change this.'),
    ).toBeTruthy()
  })

  it('offers NO switch where the plan sells no overage, and says which reason', async () => {
    global.fetch = jest.fn(async () => jsonResponse(CONTRACTUAL)) as unknown as typeof fetch
    const { unmount } = render(
      <BillingAssistOverageCardComponent orgId="org-1" canManage />,
    )
    expect(await screen.findByText('Included credits only')).toBeTruthy()
    expect(screen.getByText(/never charged/)).toBeTruthy()
    expect(screen.queryByRole('switch', { name: LABEL })).toBeNull()
    unmount()

    global.fetch = jest.fn(async () => jsonResponse(BANDLESS)) as unknown as typeof fetch
    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    expect(await screen.findByText('No AI assist credits')).toBeTruthy()
    expect(screen.getByText(/no band to stop at/)).toBeTruthy()
    expect(screen.queryByRole('switch', { name: LABEL })).toBeNull()
  })

  it('keeps the switch reachable to turn OFF on a plan that stopped selling', async () => {
    // An org that turned it on under Pro and then moved to Enterprise must
    // be able to clear it, though there is nothing for it to do there.
    global.fetch = jest.fn(async () =>
      jsonResponse({ ...CONTRACTUAL, hardCap: true }),
    ) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    const toggle = (await screen.findByRole('switch', { name: LABEL })) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(false)
    expect(screen.getByText(/not doing anything/)).toBeTruthy()
  })

  it('a payload that sells overage but cannot name the rate is a LOAD FAILURE', async () => {
    // A defaulted rate would quote "$0.00 per 1,000" to a person deciding
    // whether to leave the switch off. Worse than an error.
    global.fetch = jest.fn(async () =>
      jsonResponse({ ...SELLING, overageRateUsdPer1k: undefined }),
    ) as unknown as typeof fetch

    render(<BillingAssistOverageCardComponent orgId="org-1" canManage />)
    expect(
      await screen.findByText('We couldn’t load your AI assist settings. Nothing has changed.'),
    ).toBeTruthy()
    expect(screen.queryByRole('switch', { name: LABEL })).toBeNull()
  })
})
