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

import { act, renderHook } from '@testing-library/react'

/**
 * The marketplace surface of AGL-1532, driven end to end.
 *
 * The parser has its own unit spec; this one asserts the thing a user
 * actually sees. `useMarketplaceActions` is the funnel — five of the eight
 * install endpoints, plus the PAID purchase door, are reached only through
 * it — so if the honest copy does not come out of these callbacks, an
 * installs lock reads as a broken listing on every browse grid and listing
 * page in the console.
 *
 * That matters more than it sounds during an incident. `marketplace-installs`
 * is the lever you pull when a malicious listing slips review, and the whole
 * point of pulling it is that the platform keeps serving. "Install failed"
 * tells a customer the marketplace is broken; "installs are paused,
 * everything already installed keeps working" tells them the truth.
 */

const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

import { useMarketplaceActions } from './use-marketplace-actions'

const LISTING = { $id: 'listing-1', displayName: 'Fancy Widget', type: 'plugin' }

/** The body the installs chokepoint actually returns (AGL-1510). */
const INSTALLS_LOCKED = {
  error: 'locked',
  scope: 'feature',
  feature: 'marketplace-installs',
  reason: 'security',
  title: 'Marketplace installs are paused',
  message:
    'Installing from the marketplace is temporarily disabled. Everything ' +
    'already installed keeps working.',
  contact: 'support@aglyn.com',
}

/** The paid door refuses on BOTH keys (AGL-1545); checkout is the wider harm. */
const CHECKOUT_LOCKED = {
  error: 'locked',
  scope: 'feature',
  feature: 'checkout',
  reason: 'manual',
  title: 'Checkout is temporarily unavailable',
  message:
    'Checkout is temporarily unavailable — this is not a payment failure, ' +
    'and your account, subscription, and sites are unaffected. Please try ' +
    'again shortly.',
  contact: 'support@aglyn.com',
}

function respond(status: number, payload: unknown) {
  ;(global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })
}

const messages = () => enqueueSnackbar.mock.calls.map((call) => String(call[0]))
const said = (needle: string) =>
  messages().some((message) => message.includes(needle))

beforeEach(() => {
  enqueueSnackbar.mockClear()
})

describe('AGL-1532 · the marketplace funnel renders the 423 body', () => {
  it('an installs lock reads as paused, not as a failed install', async () => {
    respond(423, INSTALLS_LOCKED)
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    expect(said('Marketplace installs are paused')).toBe(true)
    expect(said('already installed keeps working')).toBe(true)
    // The sentence this replaces. Its return is the planted red.
    expect(said('Install failed')).toBe(false)
    // A pause is not the user's error, and it must not vanish unread.
    expect(enqueueSnackbar.mock.calls[0][1]).toMatchObject({
      variant: 'warning',
      persist: true,
    })
  })

  it('a PURCHASE during a lock is never dressed as a payment failure', async () => {
    respond(423, CHECKOUT_LOCKED)
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.buy(LISTING)
    })
    expect(said('not a payment failure')).toBe(true)
    expect(said('unaffected')).toBe(true)
    expect(said('Checkout failed')).toBe(false)
    // Nothing that would send a buyer to their bank.
    const text = messages().join(' ').toLowerCase()
    expect(text).not.toContain('declined')
    expect(text).not.toContain('card')
  })

  it('an uninstall refused by the same lock says so too', async () => {
    // Uninstall rides `install-plugin`, so the lock catches it — and
    // "Uninstall failed" is the worst possible sentence for someone trying
    // to REMOVE the listing under investigation.
    respond(423, INSTALLS_LOCKED)
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.uninstall(LISTING)
    })
    expect(said('Marketplace installs are paused')).toBe(true)
    expect(said('Uninstall failed')).toBe(false)
  })

  it('a fanned-out plan says "paused" ONCE, not once per site', async () => {
    respond(423, INSTALLS_LOCKED)
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.installPlan(LISTING, [
        { scope: 'host', hostId: 'host-1' },
        { scope: 'host', hostId: 'host-2' },
        { scope: 'host', hostId: 'host-3' },
      ] as never)
    })
    // Three identical refusals stacked into the error summary would read as
    // three broken sites — the opposite of what the lock is saying.
    const paused = messages().filter((message) =>
      message.includes('Marketplace installs are paused'),
    )
    expect(paused).toHaveLength(1)
    expect(said('failed')).toBe(false)
    // …and it stopped asking after the first refusal.
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1)
  })

  it('a REAL failure keeps its generic error — locks do not swallow faults', async () => {
    // The whole affordance is worthless if it also launders 500s into a
    // reassuring "we paused this on purpose".
    respond(500, { error: 'Install failed' })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    expect(said('Install failed')).toBe(true)
    expect(said('paused')).toBe(false)
    expect(enqueueSnackbar.mock.calls[0][1]).toMatchObject({
      variant: 'error',
    })
  })

  it('a 423 whose body is rubbish still degrades to an honest notice', async () => {
    respond(423, 'gateway ate the body')
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    expect(enqueueSnackbar).toHaveBeenCalled()
    const text = messages().join(' ')
    expect(text).not.toContain('undefined')
    expect(text.toLowerCase()).toContain('paused')
  })

  it('a purchase carries the browser GA client id (AGL-1638)', async () => {
    // The server-side `purchase` is sent from the Stripe webhook, which has
    // no browser to ask. Unless `buy` captures the client id here and posts
    // it, the webhook's `metadata.ga_client_id` read is dead and every
    // marketplace sale lands on a synthetic, sessionless GA user.
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID = 'G-SPEC'
    ;(window as unknown as { gtag?: unknown }).gtag = (
      _command: string,
      _measurementId: string,
      _field: string,
      callback: (value: string) => void,
    ) => callback('555444333.1755100000')
    // The reply deliberately carries no redirect URL: what matters here is
    // the REQUEST, and jsdom's `window.location` cannot be stubbed to absorb
    // the handoff to Stripe.
    respond(200, {})
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.buy(LISTING)
    })
    const request = (global.fetch as jest.Mock).mock.calls[0]
    expect(String(request[0])).toBe('/api/marketplace/checkout')
    expect(JSON.parse(String(request[1].body))).toMatchObject({
      listingId: 'listing-1',
      gaClientId: '555444333.1755100000',
    })
  })

  it('a purchase still asks when gtag never ran (AGL-1638)', async () => {
    // Consent refused, ad blocker, analytics unconfigured. `readGaClientId`
    // resolves null within 500ms rather than hanging — attribution is lost,
    // the sale is not, and analytics never delays a payment.
    delete (window as unknown as { gtag?: unknown }).gtag
    respond(200, {})
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.buy(LISTING)
    })
    const body = JSON.parse(
      String((global.fetch as jest.Mock).mock.calls[0][1].body),
    )
    expect(body.listingId).toBe('listing-1')
    // The key is PRESENT and null — proof the capture ran and came back
    // empty, which is a different fact from the capture never happening (the
    // defect: `gaClientId` simply absent from every marketplace checkout).
    expect(Object.hasOwn(body, 'gaClientId')).toBe(true)
    expect(body.gaClientId).toBeNull()
  })

  it('an expiry reads as a local time, never as an epoch number', async () => {
    const untilMs = Date.UTC(2026, 8, 1, 17, 0, 0)
    respond(423, {
      ...INSTALLS_LOCKED,
      untilMs,
      message: `${INSTALLS_LOCKED.message} Expected back by ${new Date(
        untilMs,
      ).toUTCString()}.`,
    })
    const { result } = renderHook(() => useMarketplaceActions('host-1'))
    await act(async () => {
      await result.current.install(LISTING)
    })
    const text = messages().join(' ')
    expect(text).toContain('Expected back around')
    expect(text).not.toContain(String(untilMs))
    expect(text).not.toContain('Expected back by')
  })
})
