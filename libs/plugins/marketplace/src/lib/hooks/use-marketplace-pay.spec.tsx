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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Buying a listing in the console, as the buyer meets it (AGL-4049).
 *
 * Driven through the real hook and the real panel; only the door is answered
 * here, and only Stripe's own forms and the bank's step are stood in for. What
 * has to hold: the total is on screen before anything is charged, the
 * prerequisites are shown rather than failed on, the bank's step ends in the
 * server's word and never the browser's, and one press of Pay is one charge.
 */

const mockFetch = jest.fn()
const mockNextAction = jest.fn(async (_secret: string): Promise<string | null> => null)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'member-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  readGaClientId: async () => '555444333.1755100000',
}))
jest.mock('@aglyn/shared-ui-jsx/stripe/lazy-stripe', () => ({
  // Stand-ins for Stripe's fields: a button that does what confirming them does.
  LazyBillingCardForm: (props: {
    clientSecret: string
    onConfirmed: (id: string) => unknown
  }) => (
    <button onClick={() => void props.onConfirmed('seti_1')}>
      {`Save card ${props.clientSecret}`}
    </button>
  ),
  LazyBillingAddressForm: (props: { onConfirmed: (value: unknown) => unknown }) => (
    <button onClick={() => void props.onConfirmed({ name: 'A', line1: '1 Main', country: 'US' })}>
      {'Save address'}
    </button>
  ),
  handleStripeNextAction: (secret: string) => mockNextAction(secret),
}))

import { useMarketplacePay, type MarketplacePayResult } from './use-marketplace-pay'

const QUOTE = {
  quote: {
    listingName: 'Fancy Widget',
    amountCents: 1000,
    taxCents: 66,
    totalCents: 1066,
    card: { type: 'card', brand: 'visa', last4: '4242' },
    canPay: true,
  },
}

type Door = (body: Record<string, any>) => { status: number; body: unknown } | Promise<never>

let door: Door
let billing: (body: Record<string, any>) => { status: number; body: unknown }
const doorCalls: Array<{ body: Record<string, any>; key: string | undefined }> = []
const billingCalls: Array<Record<string, any>> = []

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

function Harness(props: { onResult: (result: MarketplacePayResult) => void; hostId?: string }) {
  const pay = useMarketplacePay({
    orgId: 'org-1',
    hostId: props.hostId,
    billingHref: '/acme/billing',
  })
  return (
    <>
      <button
        disabled={pay.busy}
        onClick={() =>
          void pay.buy({ listingId: 'listing-1', displayName: 'Fancy Widget' }).then(props.onResult)
        }
      >
        {'Buy'}
      </button>
      {pay.panel}
    </>
  )
}

async function open(hostId?: string) {
  const onResult = jest.fn()
  render(<Harness onResult={onResult} hostId={hostId} />)
  fireEvent.click(screen.getByRole('button', { name: 'Buy' }))
  return onResult
}

const pressPay = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Pay $10.66' }))

const payAttempts = () => doorCalls.filter((call) => (call.body['action'] ?? 'pay') === 'pay')

beforeEach(() => {
  mockFetch.mockReset()
  mockNextAction.mockReset()
  mockNextAction.mockImplementation(async () => null)
  doorCalls.length = 0
  billingCalls.length = 0
  door = ({ action }) =>
    action === 'quote'
      ? { status: 200, body: QUOTE }
      : { status: 200, body: { paid: true, invoiceId: 'in_1' } }
  billing = () => ({ status: 200, body: {} })
  mockFetch.mockImplementation(async (_user: unknown, url: string, init: any) => {
    const body = JSON.parse(String(init.body))
    if (url === '/api/billing/profile') {
      billingCalls.push(body)
      const answer = billing(body)
      return reply(answer.status, answer.body)
    }
    doorCalls.push({ body, key: init.headers['Idempotency-Key'] })
    const answer = await door(body)
    return reply(answer.status, answer.body)
  })
})

describe('the total comes first', () => {
  it('shows the price, the tax, the total and the card, and charges nothing yet', async () => {
    await open()
    expect(await screen.findByRole('button', { name: 'Pay $10.66' })).toBeTruthy()
    expect(screen.getByText('$10.00')).toBeTruthy()
    expect(screen.getByText('$0.66')).toBeTruthy()
    expect(screen.getByText(/Charged to VISA •••• 4242/)).toBeTruthy()
    expect(payAttempts()).toEqual([])
  })

  it('names the workspace on every call, and the site when there is one', async () => {
    await open('host-1')
    await screen.findByRole('button', { name: 'Pay $10.66' })
    expect(doorCalls[0].body).toMatchObject({
      listingId: 'listing-1',
      orgId: 'org-1',
      hostId: 'host-1',
      action: 'quote',
    })
  })

  it('tells someone who cannot see billing only that it is the card on file', async () => {
    door = () => ({
      status: 200,
      body: { quote: { ...QUOTE.quote, card: null } },
    })
    await open()
    expect(await screen.findByText(/Charged to the card on file/)).toBeTruthy()
  })

  it('Cancel ends it with nothing charged', async () => {
    const onResult = await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ outcome: 'stopped', error: null }),
    )
    expect(payAttempts()).toEqual([])
  })

  it('a workspace that owns it is told, not charged', async () => {
    door = () => ({ status: 409, body: { code: 'already_purchased', error: 'owned' } })
    const onResult = await open()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'owned', error: null }))
  })

  it('a refusal comes back as the reason', async () => {
    door = () => ({ status: 409, body: { error: 'The publisher has not enabled payouts yet' } })
    const onResult = await open()
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        outcome: 'stopped',
        error: 'The publisher has not enabled payouts yet',
        locked: false,
      }),
    )
  })

  it('a lockdown reads as a pause', async () => {
    door = () => ({
      status: 423,
      body: {
        error: 'locked',
        scope: 'feature',
        feature: 'checkout',
        reason: 'manual',
        title: 'Checkout is temporarily unavailable',
        message: 'Checkout is temporarily unavailable — this is not a payment failure.',
        contact: 'support@aglyn.com',
      },
    })
    const onResult = await open()
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    const result = onResult.mock.calls[0][0] as MarketplacePayResult
    expect(result.locked).toBe(true)
    expect(result.error).toContain('not a payment failure')
  })

  it('a dead connection says so', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    const onResult = await open()
    await waitFor(() =>
      expect(String(onResult.mock.calls[0]?.[0]?.error)).toContain('Check your connection'),
    )
  })
})

describe('someone who may buy but not charge the card', () => {
  it('sees the price and who can buy it, and no Pay button', async () => {
    door = () => ({ status: 200, body: { quote: { ...QUOTE.quote, canPay: false, card: null } } })
    const onResult = await open()
    expect(await screen.findByText('$10.66')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Ask someone who manages billing to buy it.')
    expect(screen.getByRole('alert').textContent).toContain('permission')
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
    expect(screen.queryByText(/Charged to/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'stopped', error: null }))
    expect(payAttempts()).toEqual([])
  })

  it('keeps the price on screen when the workspace has no card either', async () => {
    door = () => ({
      status: 412,
      body: { code: 'card_required', canManageBilling: false, amountCents: 1000 },
    })
    await open()
    expect(await screen.findByText('$10.00')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('needs a card on file')
  })
})

describe('paying', () => {
  it('sends the total the buyer saw, the GA client id and an attempt key', async () => {
    const onResult = await open()
    await pressPay()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'paid', error: null }))
    const [attempt] = payAttempts()
    expect(attempt.body).toMatchObject({
      expectedTotalCents: 1066,
      gaClientId: '555444333.1755100000',
    })
    expect(attempt.key).toBeTruthy()
  })

  it('a payment still clearing ends as pending', async () => {
    door = ({ action }) =>
      action === 'quote'
        ? { status: 200, body: QUOTE }
        : { status: 200, body: { submitted: true, invoiceId: 'in_1' } }
    const onResult = await open()
    await pressPay()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'pending', error: null }))
  })

  it('a decline stays on the panel with Stripe\'s words, and the next press is a new attempt', async () => {
    door = ({ action }) =>
      action === 'quote'
        ? { status: 200, body: QUOTE }
        : { status: 402, body: { error: 'Your card was declined.', declined: true } }
    await open()
    await pressPay()
    expect(await screen.findByText('Your card was declined.')).toBeTruthy()
    await pressPay()
    await waitFor(() => expect(payAttempts()).toHaveLength(2))
    expect(payAttempts()[0].key).not.toBe(payAttempts()[1].key)
  })

  it('a lost connection keeps the key: the second press replays, it does not charge again', async () => {
    let first = true
    door = ({ action }) => {
      if (action === 'quote') return { status: 200, body: QUOTE }
      if (first) {
        first = false
        return Promise.reject(new Error('offline')) as Promise<never>
      }
      return { status: 200, body: { paid: true, invoiceId: 'in_1' } }
    }
    const onResult = await open()
    await pressPay()
    expect(await screen.findByText(/could not be confirmed/)).toBeTruthy()
    await pressPay()
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(payAttempts()[0].key).toBe(payAttempts()[1].key)
  })

  it('a total that moved shows the new one and says so', async () => {
    let total = 1066
    door = ({ action }) => {
      if (action === 'quote') {
        return {
          status: 200,
          body: { quote: { ...QUOTE.quote, totalCents: total, taxCents: total - 1000 } },
        }
      }
      total = 1100
      return {
        status: 409,
        body: { error: 'The total changed. Check the new total and pay again.', code: 'total_changed' },
      }
    }
    await open()
    await pressPay()
    expect(await screen.findByRole('button', { name: 'Pay $11.00' })).toBeTruthy()
    expect(screen.getByText(/The total changed/)).toBeTruthy()
  })
})

describe('the bank\'s step', () => {
  const needsBank = (settled: { status: number; body: unknown }): Door =>
    ({ action }) => {
      if (action === 'quote') return { status: 200, body: QUOTE }
      if (action === 'settle') return settled
      return {
        status: 200,
        body: { requiresAction: true, paymentClientSecret: 'pi_secret', invoiceId: 'in_1' },
      }
    }

  it('runs it, then asks the server whether it paid', async () => {
    door = needsBank({ status: 200, body: { paid: true, invoiceId: 'in_1' } })
    const onResult = await open()
    await pressPay()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'paid', error: null }))
    expect(mockNextAction).toHaveBeenCalledWith('pi_secret')
    expect(doorCalls.find((call) => call.body['action'] === 'settle')?.body).toMatchObject({
      invoiceId: 'in_1',
      listingId: 'listing-1',
    })
  })

  it('a bank that says no is said, and the server is still asked', async () => {
    mockNextAction.mockImplementation(async () => 'Your bank declined the authentication.')
    door = needsBank({ status: 402, body: { error: 'Not completed.', declined: true } })
    await open()
    await pressPay()
    expect(await screen.findByText('Your bank declined the authentication.')).toBeTruthy()
    expect(doorCalls.some((call) => call.body['action'] === 'settle')).toBe(true)
  })

  it('the server\'s word beats the browser\'s: a payment that landed is paid', async () => {
    mockNextAction.mockImplementation(async () => 'The window closed.')
    door = needsBank({ status: 200, body: { paid: true, invoiceId: 'in_1' } })
    const onResult = await open()
    await pressPay()
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ outcome: 'paid', error: null }))
  })
})

describe('prerequisites are shown, never failed on', () => {
  const needing = (code: string, canManageBilling: boolean): Door => {
    let met = false
    billing = (body) => {
      if (body['action'] === 'finalize-card-setup' || body['action'] === 'set-billing-address') {
        met = true
      }
      return { status: 200, body: { clientSecret: 'seti_secret' } }
    }
    return ({ action }) =>
      met && action === 'quote'
        ? { status: 200, body: QUOTE }
        : { status: 412, body: { error: 'Add a card in Billing first', code, canManageBilling, amountCents: 1000 } }
  }

  it('no card, and this person can add one: the card form opens in place', async () => {
    door = needing('card_required', true)
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Save card seti_secret' }))
    await screen.findByRole('button', { name: 'Pay $10.66' })
    expect(billingCalls.map((call) => call['action'])).toEqual([
      'create-setup-intent',
      'finalize-card-setup',
    ])
    expect(billingCalls[1]).toMatchObject({ orgId: 'org-1', setupIntentId: 'seti_1' })
  })

  it('no address, and this person can add one: the address form opens in place', async () => {
    door = needing('billing_address_required', true)
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Save address' }))
    await screen.findByRole('button', { name: 'Pay $10.66' })
    expect(billingCalls[0]).toMatchObject({
      orgId: 'org-1',
      action: 'set-billing-address',
      line1: '1 Main',
      country: 'US',
    })
  })

  it('a card that saves onto a workspace with no address goes on to the address', async () => {
    let step = 0
    billing = (body) => {
      if (body['action'] === 'finalize-card-setup') step = 1
      if (body['action'] === 'set-billing-address') step = 2
      return { status: 200, body: { clientSecret: 'seti_secret' } }
    }
    door = () =>
      step === 0
        ? { status: 412, body: { code: 'card_required', canManageBilling: true } }
        : step === 1
          ? { status: 412, body: { code: 'billing_address_required', canManageBilling: true } }
          : { status: 200, body: QUOTE }
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Save card seti_secret' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save address' }))
    expect(await screen.findByRole('button', { name: 'Pay $10.66' })).toBeTruthy()
  })

  it('no card, and this person cannot add one: it says who can', async () => {
    door = needing('card_required', false)
    await open()
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toContain('needs a card on file')
    expect(notice.textContent).toContain('permission')
    expect(billingCalls).toEqual([])
  })

  it('a card form that will not open says why', async () => {
    door = needing('card_required', true)
    billing = () => ({ status: 502, body: { error: 'Could not open the card form. Nothing has changed.' } })
    await open()
    expect(await screen.findByText(/Could not open the card form/)).toBeTruthy()
  })
})

describe('stripe stays lazy', () => {
  it('the hook and the panel import nothing of Stripe\'s statically', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const file of ['use-marketplace-pay.tsx', '../components/marketplace-pay-panel.component.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8')
      expect(source).not.toMatch(/from '@stripe\//)
      expect(source).not.toMatch(/import .* from '@aglyn\/shared-ui-jsx\/stripe\/(billing-card-form|browser-stripe)/)
    }
    await act(async () => undefined)
  })
})
