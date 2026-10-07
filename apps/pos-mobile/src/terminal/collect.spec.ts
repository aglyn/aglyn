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

import type { PaymentIntent, PaymentIntentResultType } from '@stripe/stripe-terminal-react-native'
import {
  collectCardPayment,
  collectErrorMessage,
  collectRequestProblem,
  readCollectRequest,
  readerCanTip,
  type TerminalPaymentApi,
} from './collect'

const ID = 'pi_3Abcdefghijklmno'
const SECRET = `${ID}_secret_Zyxwvutsrqponm`

function intent(overrides: Partial<PaymentIntent.Type> = {}): PaymentIntent.Type {
  return { id: ID, amount: 1250, status: 'requiresPaymentMethod', captureMethod: 'manual', charges: [], created: '0', currency: 'usd', livemode: false, ...overrides } as PaymentIntent.Type
}

const ok = (paymentIntent: PaymentIntent.Type): PaymentIntentResultType => ({ paymentIntent })
const fail = (code: string, message = 'nope', extra: Record<string, unknown> = {}): PaymentIntentResultType =>
  ({ error: { code, message, name: 'StripeError', nativeErrorCode: code, metadata: {}, ...extra } }) as PaymentIntentResultType

function api(steps: Partial<Record<keyof TerminalPaymentApi, PaymentIntentResultType>>) {
  const calls: Array<[string, unknown]> = []
  const fake: TerminalPaymentApi = {
    retrievePaymentIntent: async (secret) => {
      calls.push(['retrieve', secret])
      return steps.retrievePaymentIntent ?? ok(intent())
    },
    collectPaymentMethod: async (params) => {
      calls.push(['collect', params])
      return steps.collectPaymentMethod ?? ok(intent({ status: 'requiresConfirmation' }))
    },
    confirmPaymentIntent: async (params) => {
      calls.push(['confirm', params])
      return steps.confirmPaymentIntent ?? ok(intent({ status: 'requiresCapture' }))
    },
  }
  return { fake, calls }
}

const TAP = { deviceType: 'tapToPay' as const }
const WISEPAD = { deviceType: 'wisePad3' as const }
const request = { paymentIntentId: ID, clientSecret: SECRET, tipEligible: true, amountCents: null }

describe('readCollectRequest', () => {
  it('accepts an intent and its own secret', () => {
    expect(readCollectRequest({ paymentIntentId: ID, clientSecret: SECRET, tipEligible: true })).toEqual(request)
    expect(readCollectRequest({ paymentIntentId: ID, clientSecret: SECRET }).tipEligible).toBe(false)
    expect(readCollectRequest({ paymentIntentId: ID, clientSecret: SECRET, amountCents: 1250 }).amountCents).toBe(1250)
    expect(readCollectRequest({ paymentIntentId: ID, clientSecret: SECRET, amountCents: -5 }).amountCents).toBeNull()
    expect(readCollectRequest({ paymentIntentId: ID, clientSecret: SECRET, amountCents: '1250' }).amountCents).toBeNull()
  })

  it.each([
    [{}, /missing/],
    [{ paymentIntentId: 'cs_1', clientSecret: SECRET }, /missing/],
    [{ paymentIntentId: ID, clientSecret: 'pi_3Other1234567_secret_abcdefghi' }, /does not match/],
    [{ paymentIntentId: ID, clientSecret: 42 }, /missing/],
  ])('refuses %p', (params, problem) => {
    expect(collectRequestProblem(params as Record<string, unknown>)).toMatch(problem)
    expect(() => readCollectRequest(params as Record<string, unknown>)).toThrow(problem)
  })
})

describe('collectCardPayment', () => {
  it('collects then confirms (authorizes) the server-created intent', async () => {
    const { fake, calls } = api({})
    await expect(collectCardPayment(fake, request, TAP)).resolves.toEqual({
      status: 'collected',
      paymentIntentId: ID,
      amountCents: 1250,
      tipCents: 0,
    })
    expect(calls.map(([step]) => step)).toEqual(['retrieve', 'collect', 'confirm'])
    expect(calls[0][1]).toBe(SECRET)
  })

  it('skips on-reader tipping on Tap to Pay and offers it on a WisePad 3', async () => {
    const tap = api({})
    await collectCardPayment(tap.fake, request, TAP)
    expect(tap.calls[1][1]).toMatchObject({ skipTipping: true, customerCancellation: 'enableIfAvailable' })

    const pad = api({ confirmPaymentIntent: ok(intent({ status: 'requiresCapture', amount: 1450, amountDetails: { tip: { amount: 200 } } as never })) })
    await expect(collectCardPayment(pad.fake, request, WISEPAD)).resolves.toMatchObject({ amountCents: 1450, tipCents: 200 })
    expect(pad.calls[1][1]).toMatchObject({ skipTipping: false })

    const noTip = api({})
    await collectCardPayment(noTip.fake, { ...request, tipEligible: false }, WISEPAD)
    expect(noTip.calls[1][1]).toMatchObject({ skipTipping: true })
  })

  it('collects when the register’s amount matches the intent, and refuses one that does not', async () => {
    const match = api({})
    await expect(collectCardPayment(match.fake, { ...request, amountCents: 1250 }, TAP)).resolves.toMatchObject({
      status: 'collected',
    })
    const differ = api({})
    await expect(collectCardPayment(differ.fake, { ...request, amountCents: 999 }, TAP)).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/does not match the register/),
    })
    expect(differ.calls.map(([step]) => step)).toEqual(['retrieve'])
  })

  it('refuses without a connected reader, touching nothing', async () => {
    const { fake, calls } = api({})
    await expect(collectCardPayment(fake, request, null)).resolves.toMatchObject({ status: 'failed' })
    expect(calls).toHaveLength(0)
  })

  it('reports an intent already authorized instead of asking for the card twice', async () => {
    const { fake, calls } = api({ retrievePaymentIntent: ok(intent({ status: 'requiresCapture' })) })
    await expect(collectCardPayment(fake, request, TAP)).resolves.toMatchObject({ status: 'collected' })
    expect(calls.map(([step]) => step)).toEqual(['retrieve'])
  })

  it('refuses when the retrieved intent is not the one asked for', async () => {
    const { fake } = api({ retrievePaymentIntent: ok(intent({ id: 'pi_3Someoneelses99' })) })
    await expect(collectCardPayment(fake, request, TAP)).resolves.toMatchObject({ status: 'failed' })
  })

  it('treats a cancel at either step as canceled, so the same intent can be collected again', async () => {
    const atCollect = api({ collectPaymentMethod: fail('CANCELED') })
    await expect(collectCardPayment(atCollect.fake, request, TAP)).resolves.toEqual({ status: 'canceled', paymentIntentId: ID })
    const atConfirm = api({ confirmPaymentIntent: fail('Canceled') })
    await expect(collectCardPayment(atConfirm.fake, request, TAP)).resolves.toEqual({ status: 'canceled', paymentIntentId: ID })
  })

  it('reports a decline with the words to read out', async () => {
    const { fake } = api({
      confirmPaymentIntent: fail('DECLINED_BY_STRIPE_API', 'x', { apiError: { declineCode: 'insufficient_funds' } }),
    })
    await expect(collectCardPayment(fake, request, TAP)).resolves.toEqual({
      status: 'failed',
      paymentIntentId: ID,
      message: 'Declined: insufficient funds. Ask for another card.',
      code: 'DECLINED_BY_STRIPE_API',
    })
  })

  it('counts a confirm error whose intent authorized anyway as a success', async () => {
    const { fake } = api({
      confirmPaymentIntent: fail('UNEXPECTED_SDK_ERROR', 'x', { paymentIntent: intent({ status: 'requiresCapture' }) }),
    })
    await expect(collectCardPayment(fake, request, TAP)).resolves.toMatchObject({ status: 'collected' })
  })

  it('reports a failed retrieval', async () => {
    const { fake } = api({ retrievePaymentIntent: fail('NOT_CONNECTED_TO_READER') })
    await expect(collectCardPayment(fake, request, TAP)).resolves.toMatchObject({
      status: 'failed',
      message: 'The card reader disconnected. Reconnect it and try again.',
    })
  })
})

describe('helpers', () => {
  it('only WisePad 3 readers tip on screen', () => {
    expect(readerCanTip(WISEPAD)).toBe(true)
    expect(readerCanTip({ deviceType: 'stripeM2' })).toBe(false)
    expect(readerCanTip(TAP)).toBe(false)
    expect(readerCanTip(null)).toBe(false)
  })

  it('falls back to the SDK message, then ours', () => {
    expect(collectErrorMessage({ code: 'X', message: 'SDK words' } as never, 'ours')).toBe('SDK words')
    expect(collectErrorMessage(undefined, 'ours')).toBe('ours')
    expect(collectErrorMessage({ code: 'DECLINED_BY_READER', message: '' } as never, 'ours')).toMatch(/declined/)
  })
})
