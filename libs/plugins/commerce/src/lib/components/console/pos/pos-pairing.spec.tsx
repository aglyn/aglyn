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
 * The one pairing flow (AGL-3712) the register and the POS devices card both
 * open: a code for the register asked about, a fresh code of the other kind
 * when the merchant switches to a kiosk, and the server's refusal told back.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { posKioskGaps } from './pos-kiosk-readiness.component'
import { posRegistersSettingsHref, usePosPairing } from './pos-pairing.component'

const calls: any[] = []
let refuse = false

/** Swapped per case: the register's readers, as the readers route lists them. */
let readersAnswer: Record<string, unknown> = {
  available: true,
  readers: [{ id: 'tmr_1', registerId: 'reg-1' }],
}

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: any) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    if (refuse) {
      return { ok: false, status: 403, json: async () => ({ error: 'Not permitted' }) }
    }
    if (url === '/api/commerce/pos-readers') {
      return { ok: true, status: 200, json: async () => readersAnswer }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: body.mode === 'kiosk' ? '654321' : '123456', expiresAtMs: 1 }),
    }
  },
}))

/** Swapped per case: what the store's Stripe account can do. */
const PAYMENTS_READY = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }
let mockPayments: Record<string, unknown> = PAYMENTS_READY
/** Swapped per case: the commerce plugin's settings as the site resolves them. */
let mockConfig: Record<string, unknown> = { posKioskPayAtCounter: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useMerchantPayments: () => mockPayments,
  useHostOrgId: () => 'org-1',
  useSitePluginConfig: () => ({ config: mockConfig, overrides: [], ready: true }),
  useConsoleHostRoute: () => ({ base: '/acme/hosts/shop', orgSlug: 'acme', subdomain: 'shop' }),
  useStoreSettingsHref: (_hostId: string, page: string) => `/acme/hosts/shop/products/${page}`,
}))

function Harness({ onError }: { onError: (message: string) => void }) {
  const flow = usePosPairing({ user: { uid: 'u1' } as any, hostId: 'host-1', onError })
  return (
    <>
      <button type="button" onClick={() => void flow.open('reg-1', 'display', 'Front counter')}>
        {'open'}
      </button>
      {flow.dialog}
    </>
  )
}

beforeEach(() => {
  calls.length = 0
  refuse = false
  readersAnswer = { available: true, readers: [{ id: 'tmr_1', registerId: 'reg-1' }] }
  mockPayments = PAYMENTS_READY
  mockConfig = { posKioskPayAtCounter: true }
})

/** Opens the dialog and switches it to a kiosk, as a merchant pairing one does. */
async function openKiosk() {
  render(<Harness onError={jest.fn()} />)
  fireEvent.click(screen.getByText('open'))
  await screen.findByText('123456')
  fireEvent.click(screen.getByRole('button', { name: 'Self-service kiosk' }))
  await screen.findByText('654321')
}

describe('usePosPairing', () => {
  it('shows a code for the register, and a kiosk code when switched', async () => {
    render(<Harness onError={jest.fn()} />)
    fireEvent.click(screen.getByText('open'))
    expect(await screen.findByText('123456')).toBeTruthy()
    expect(screen.getByText('Pair a customer display')).toBeTruthy()
    expect(screen.getByText('For Front counter')).toBeTruthy()
    expect(screen.getByText(/\/kiosk\/commerce\/pos-display$/)).toBeTruthy()
    expect(calls[0]).toMatchObject({
      url: '/api/commerce/pos-display',
      body: { action: 'pairing-code', hostId: 'host-1', registerId: 'reg-1', mode: 'display' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Self-service kiosk' }))
    expect(await screen.findByText('654321')).toBeTruthy()
    expect(screen.getByText('Pair a self-service kiosk')).toBeTruthy()
    expect(screen.getByText(/\/kiosk\/commerce\/pos-kiosk$/)).toBeTruthy()
    expect(calls[1].body).toMatchObject({ registerId: 'reg-1', mode: 'kiosk' })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('654321')).toBeNull())
  })

  it('tells the caller why no code was made', async () => {
    refuse = true
    const onError = jest.fn()
    render(<Harness onError={onError} />)
    fireEvent.click(screen.getByText('open'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Not permitted'))
    expect(screen.queryByText('Pair a customer display')).toBeNull()
  })
})

describe('kiosk payment prerequisites (AGL-3982)', () => {
  it('says nothing when the register has a reader and Stripe is ready', async () => {
    await openKiosk()
    await waitFor(() =>
      expect(calls.some((call) => call.url === '/api/commerce/pos-readers' && call.body.action === 'list')).toBe(true),
    )
    expect(screen.queryByTestId('pos-kiosk-readiness')).toBeNull()
  })

  it('names Stripe with a Payments link while the account is not ready', async () => {
    mockPayments = {
      state: 'not-connected',
      settled: true,
      ready: false,
      blocked: true,
      reason: 'Connect Stripe to take card payments.',
      href: '/acme/hosts/shop/products/payments',
    }
    await openKiosk()
    expect(
      await screen.findByText(
        'Connect Stripe to take card payments. Until then the kiosk can’t take cards; customers pay at the counter.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Open Payments').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/products/payments',
    )
  })

  it('sends a register with no reader to POS devices', async () => {
    readersAnswer = { available: true, readers: [{ id: 'tmr_1', registerId: 'reg-2' }] }
    await openKiosk()
    expect(await screen.findByText(/No card reader is assigned to Front counter\./)).toBeTruthy()
    expect(screen.getByText('Open POS devices').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/products/pos#pos-devices',
    )
  })

  it('warns when the kiosk has no way to take payment at all', async () => {
    readersAnswer = { available: true, readers: [] }
    mockConfig = { posKioskPayAtCounter: false }
    await openKiosk()
    expect(await screen.findByText(/This kiosk can’t take payment yet/)).toBeTruthy()
    expect(screen.getByText('Open store settings').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/admin/plugins/commerce',
    )
  })

  it('names no reader or Stripe step where the deployment takes no card payments', async () => {
    readersAnswer = { available: false, readers: [] }
    mockPayments = { ...PAYMENTS_READY, state: 'not-connected', ready: false, blocked: true, reason: 'Connect Stripe.' }
    await openKiosk()
    await waitFor(() => expect(calls.some((call) => call.url === '/api/commerce/pos-readers')).toBe(true))
    expect(screen.queryByText('Open Payments')).toBeNull()
    expect(screen.queryByText('Open POS devices')).toBeNull()
  })

  it('shows nothing about a kiosk on a customer display code', async () => {
    mockPayments = { ...PAYMENTS_READY, state: 'not-connected', ready: false, blocked: true, reason: 'Connect Stripe.' }
    render(<Harness onError={jest.fn()} />)
    fireEvent.click(screen.getByText('open'))
    await screen.findByText('123456')
    expect(screen.queryByTestId('pos-kiosk-readiness')).toBeNull()
    expect(calls.some((call) => call.url === '/api/commerce/pos-readers')).toBe(false)
  })
})

describe('posKioskGaps', () => {
  const ready = { cardsOffered: true, registerReaders: 1, payAtCounter: true, stripeBlocked: false }
  it('finds nothing missing on a ready register', () => {
    expect(posKioskGaps(ready)).toEqual([])
  })
  it('lists every gap, the kiosk-wide one first', () => {
    expect(posKioskGaps({ ...ready, registerReaders: 0, payAtCounter: false, stripeBlocked: true })).toEqual([
      'no-payment',
      'stripe',
      'reader',
    ])
  })
  it('keeps pay at the counter off as a choice while cards work', () => {
    expect(posKioskGaps({ ...ready, payAtCounter: false })).toEqual([])
  })
  it('asks for a reader choice on a register with several', () => {
    expect(posKioskGaps({ ...ready, registerReaders: 2 })).toEqual(['reader-choice'])
  })
  it('says only "no payment" where the deployment takes no cards', () => {
    expect(posKioskGaps({ ...ready, cardsOffered: false, payAtCounter: false, stripeBlocked: true })).toEqual([
      'no-payment',
    ])
    expect(posKioskGaps({ ...ready, cardsOffered: false, registerReaders: 0 })).toEqual([])
  })
})

describe('posRegistersSettingsHref', () => {
  it('points from the register page to the POS registers card', () => {
    expect(posRegistersSettingsHref('/acme/hosts/shop/pos')).toBe(
      '/acme/hosts/shop/products/pos#pos-registers',
    )
    expect(posRegistersSettingsHref(undefined)).toBeUndefined()
    expect(posRegistersSettingsHref('/acme/hosts/shop/products')).toBeUndefined()
  })
})
