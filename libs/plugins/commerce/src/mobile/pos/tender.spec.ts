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

import type { MobileCardCollectOutcome, MobileCardReader } from '@aglyn/mobile-plugin-host'
import {
  cashQuickAmounts,
  centsFromText,
  isLostAnswer,
  payCash,
  payWithDeviceReader,
  pollSmartReader,
  startSmartReader,
  tipChoices,
} from './tender'

type Answer = Record<string, unknown>

/** The payment route, answering each action from a script. */
function route(script: Partial<Record<string, Array<Answer | Error>>>) {
  const calls: Array<{ action: string; body: any; key?: string }> = []
  const api = {
    request: jest.fn(async (_path: string, init?: any) => {
      const action = String(init?.body?.action)
      calls.push({ action, body: init?.body, key: init?.idempotencyKey })
      const next = script[action]?.shift()
      if (next instanceof Error) throw next
      return next ?? {}
    }),
  }
  return { api, calls, actions: () => calls.map((call) => call.action) }
}

const sale = (payments: Answer[], extra: Answer = {}) => ({
  sale: { orderId: 'o1', status: 'pending', totalCents: 1000, dueCents: 1000, tenderableCents: 1000, payments, ...extra },
})
const pending = { id: 'pay1', method: 'card_present', amountCents: 1000, tipCents: 150, status: 'pending' }
const lost = () => Object.assign(new Error('could not be reached'), { status: 0 })

function reader(outcome: MobileCardCollectOutcome | Error): MobileCardReader & { collect: jest.Mock } {
  return {
    state: { connected: true, kind: 'tapToPay', label: 'Tap to Pay', busy: false, testMode: true, prompt: null },
    collect: jest.fn(async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    }),
    cancel: jest.fn(async () => undefined),
    manage: jest.fn(),
  }
}

const deps = (api: any) => ({ api, hostId: 'h1', orderId: 'o1', sleep: async () => undefined })

describe('a card on this device (AGL-3618)', () => {
  it('starts the intent with the attempt key, collects the amount with the tip, and lets the server settle', async () => {
    const { api, calls, actions } = route({
      'card-present-sdk': [{ ...sale([pending]), paymentId: 'pay1', clientSecret: 'pi_123456789_secret_abcdefghij', paymentIntentId: 'pi_123456789' }],
      status: [{ ...sale([{ ...pending, status: 'succeeded' }], { status: 'paid', dueCents: 0 }), paymentId: 'pay1', completed: true }],
    })
    const device = reader({ status: 'collected', paymentIntentId: 'pi_123456789', amountCents: 1150, tipCents: 0 })
    const outcome = await payWithDeviceReader({ ...deps(api), reader: device, amountCents: 1000, tipCents: 150, attemptKey: 'press-1' })
    expect(outcome).toMatchObject({ kind: 'settled', answer: { completed: true } })
    expect(actions()).toEqual(['card-present-sdk', 'status'])
    expect(calls[0]).toMatchObject({ key: 'press-1', body: { amountCents: 1000, tipCents: 150 } })
    expect(device.collect).toHaveBeenCalledWith({
      paymentIntentId: 'pi_123456789',
      clientSecret: 'pi_123456789_secret_abcdefghij',
      amountCents: 1150,
      tipEligible: false,
    })
  })

  it('releases the intent when the customer cancels or the card is declined', async () => {
    for (const result of [
      { status: 'canceled', paymentIntentId: 'pi_1' } as const,
      { status: 'failed', paymentIntentId: 'pi_1', message: 'Declined: insufficient funds.' } as const,
    ]) {
      const { api, actions } = route({
        'card-present-sdk': [{ ...sale([pending]), paymentId: 'pay1', clientSecret: 's', paymentIntentId: 'pi_1' }],
        cancel: [{ ...sale([{ ...pending, status: 'canceled' }]), paymentId: 'pay1' }],
      })
      const outcome = await payWithDeviceReader({ ...deps(api), reader: reader(result), amountCents: 1000, tipCents: 0, attemptKey: 'k' })
      expect(outcome.kind).toBe(result.status)
      if (outcome.kind === 'failed') expect(outcome.message).toBe('Declined: insufficient funds.')
      expect(actions()).toEqual(['card-present-sdk', 'cancel'])
    }
  })

  it('settles from the server when the reader’s answer is lost', async () => {
    const { api, actions } = route({
      'card-present-sdk': [{ ...sale([pending]), paymentId: 'pay1', clientSecret: 's', paymentIntentId: 'pi_1' }],
      status: [
        { ...sale([pending]), paymentId: 'pay1' },
        { ...sale([{ ...pending, status: 'succeeded' }], { dueCents: 0 }), paymentId: 'pay1', completed: true },
      ],
    })
    const device = reader({ status: 'collected', paymentIntentId: 'pi_1', amountCents: 1000, tipCents: 0 })
    const outcome = await payWithDeviceReader({ ...deps(api), reader: device, amountCents: 1000, tipCents: 0, attemptKey: 'k' })
    expect(outcome.kind).toBe('settled')
    expect(actions()).toEqual(['card-present-sdk', 'status', 'status'])
  })

  it('reports a dropped connection as unknown, never as a failure to retry blindly', async () => {
    const { api } = route({ 'card-present-sdk': [lost()] })
    const device = reader({ status: 'collected', paymentIntentId: 'pi_1', amountCents: 1000, tipCents: 0 })
    const outcome = await payWithDeviceReader({ ...deps(api), reader: device, amountCents: 1000, tipCents: 0, attemptKey: 'k' })
    expect(outcome.kind).toBe('unknown')
    expect(device.collect).not.toHaveBeenCalled()
    expect(isLostAnswer(Object.assign(new Error('x'), { status: 409 }))).toBe(false)
  })

  it('does not ask for the card twice when a retried press already settled', async () => {
    const { api } = route({
      'card-present-sdk': [{ ...sale([{ ...pending, status: 'succeeded' }]), paymentId: 'pay1' }],
    })
    const device = reader({ status: 'collected', paymentIntentId: 'pi_1', amountCents: 1000, tipCents: 0 })
    expect((await payWithDeviceReader({ ...deps(api), reader: device, amountCents: 1000, tipCents: 0, attemptKey: 'k' })).kind).toBe('settled')
    expect(device.collect).not.toHaveBeenCalled()
  })
})

describe('a smart reader and cash', () => {
  it('pushes to a smart reader, then reads it until it answers', async () => {
    const { api, calls } = route({
      'card-present': [{ ...sale([{ ...pending, readerId: 'tmr_1' }]), paymentId: 'pay1' }],
      status: [{ ...sale([pending]), paymentId: 'pay1' }, { ...sale([{ ...pending, status: 'failed', failureMessage: 'Card declined' }]), paymentId: 'pay1' }],
    })
    const started = await startSmartReader({ ...deps(api), readerId: 'tmr_1', amountCents: 1000, tipCents: 0, attemptKey: 'k' })
    expect(started).toMatchObject({ kind: 'waiting', paymentId: 'pay1' })
    expect(calls[0].body).toMatchObject({ readerId: 'tmr_1', amountCents: 1000 })
    expect(await pollSmartReader(deps(api), 'pay1')).toBeNull()
    expect(await pollSmartReader(deps(api), 'pay1')).toMatchObject({ kind: 'failed', message: 'Card declined' })
  })

  it('takes cash with what was handed over, and a part payment for a split', async () => {
    const { api, calls } = route({
      cash: [{ ...sale([{ id: 'c1', method: 'cash', amountCents: 400, status: 'succeeded', changeCents: 100 }], { dueCents: 600 }), paymentId: 'c1' }],
    })
    const outcome = await payCash({ ...deps(api), tenderedCents: 500, amountCents: 400, tipCents: 0, attemptKey: 'cash-1' })
    expect(outcome).toMatchObject({ kind: 'settled', payment: { changeCents: 100 }, answer: { sale: { dueCents: 600 } } })
    expect(calls[0]).toMatchObject({ key: 'cash-1', body: { action: 'cash', tenderedCents: 500, amountCents: 400, tipCents: 0 } })
    const refused = route({ cash: [Object.assign(new Error('Cash received is short'), { status: 400 })] })
    expect(await payCash({ ...deps(refused.api), tenderedCents: 1, tipCents: 0, attemptKey: 'k' })).toEqual({
      kind: 'failed',
      message: 'Cash received is short',
      answer: null,
    })
  })
})

describe('tips and amounts', () => {
  it('offers the merchant’s presets on the amount, and no tip', () => {
    expect(tipChoices(1999, [15, 20])).toEqual([
      { id: 'none', label: 'No tip', cents: 0 },
      { id: 'pct-15', label: '15%', cents: 300 },
      { id: 'pct-20', label: '20%', cents: 400 },
    ])
  })

  it('suggests the bills a customer hands over', () => {
    expect(cashQuickAmounts(1234)).toEqual([1234, 1500, 2000, 5000, 10000])
    expect(cashQuickAmounts(2000)).toEqual([2000, 5000, 10000])
    expect(cashQuickAmounts(0)).toEqual([])
  })

  it('reads typed money as whole cents', () => {
    expect(centsFromText('$12.5')).toBe(1250)
    expect(centsFromText('1,000')).toBe(100000)
    expect(centsFromText('12.345')).toBeNull()
    expect(centsFromText('abc')).toBeNull()
  })
})
