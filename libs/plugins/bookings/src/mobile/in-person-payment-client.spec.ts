/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { takeBookingPayment, type BookingsApi, type BookingsCardReader } from './in-person-payment-client'
import { centsFromText, counterBookingFrom, formatUsd } from './today-bookings'

// The counter list's pure helpers are under test here, not its Firestore read.
jest.mock('firebase/firestore', () => ({}))

function harness(options: {
  settle?: { status: string; amountCents?: number }
  collect?: Awaited<ReturnType<BookingsCardReader['collect']>> | Error
  startError?: Error
}) {
  const requests: Array<{ path: string; init: any }> = []
  const api: BookingsApi = {
    request: jest.fn(async (path: string, init?: any) => {
      requests.push({ path, init })
      const action = init?.body?.action
      if (action === 'start') {
        if (options.startError) throw options.startError
        return { paymentIntentId: 'pi_1abcdef', clientSecret: 'pi_1abcdef_secret_x', amountCents: 5400, serviceCents: 5000, taxCents: 400 }
      }
      if (action === 'settle') return options.settle ?? { status: 'paid', amountCents: 5400 }
      return { status: 'canceled' }
    }) as BookingsApi['request'],
  }
  const reader: BookingsCardReader = {
    collect: jest.fn(async () => {
      if (options.collect instanceof Error) throw options.collect
      return options.collect ?? { status: 'collected' as const }
    }),
  }
  const run = () =>
    takeBookingPayment({ api, reader, hostId: 'host-1', bookingId: 'b-1', serviceCents: 5000, attemptKey: 'press-1' })
  return { api, reader, requests, run, actions: () => requests.map((entry) => entry.init.body.action) }
}

describe('takeBookingPayment', () => {
  it('starts with the attempt key, collects the priced amount, then settles', async () => {
    const h = harness({})
    await expect(h.run()).resolves.toEqual({ status: 'paid', amountCents: 5400 })
    expect(h.actions()).toEqual(['start', 'settle'])
    expect(h.requests[0].init.idempotencyKey).toBe('press-1')
    expect(h.requests[0].init.body).toEqual({ hostId: 'host-1', bookingId: 'b-1', action: 'start', amountCents: 5000 })
    expect(h.reader.collect).toHaveBeenCalledWith({ paymentIntentId: 'pi_1abcdef', clientSecret: 'pi_1abcdef_secret_x', amountCents: 5400 })
  })

  it('releases the intent when the customer cancels or the card fails', async () => {
    const canceled = harness({ collect: { status: 'canceled' } })
    await expect(canceled.run()).resolves.toEqual({ status: 'canceled' })
    expect(canceled.actions()).toEqual(['start', 'cancel'])

    const failed = harness({ collect: { status: 'failed', message: 'Declined' } })
    await expect(failed.run()).resolves.toEqual({ status: 'failed', message: 'Declined' })
    expect(failed.actions()).toEqual(['start', 'cancel'])
  })

  it('settles anyway when the reader’s answer is lost, so an authorization is never stranded', async () => {
    const h = harness({ collect: new Error('bridge went away') })
    await expect(h.run()).resolves.toEqual({ status: 'paid', amountCents: 5400 })
    expect(h.actions()).toEqual(['start', 'settle'])
  })

  it('releases an intent the server found uncollected', async () => {
    const h = harness({ settle: { status: 'pending' } })
    await expect(h.run()).resolves.toMatchObject({ status: 'failed' })
    expect(h.actions()).toEqual(['start', 'settle', 'cancel'])
  })

  it('refuses a bad amount before calling anything, and reports a refused start', async () => {
    const h = harness({})
    await expect(
      takeBookingPayment({ api: h.api, reader: h.reader, hostId: 'host-1', bookingId: 'b-1', serviceCents: 10, attemptKey: 'k' }),
    ).resolves.toMatchObject({ status: 'failed' })
    expect(h.requests).toHaveLength(0)

    const refused = harness({ startError: new Error('This booking is already paid.') })
    await expect(refused.run()).resolves.toEqual({ status: 'failed', message: 'This booking is already paid.' })
    expect(refused.reader.collect).not.toHaveBeenCalled()
  })
})

describe('counter bookings', () => {
  it('maps a booking document and its state', () => {
    expect(
      counterBookingFrom('b-1', { serviceId: 's', serviceName: 'Cut', name: 'Ada', startsAtMs: 5, endsAtMs: 9, status: 'confirmed' }, 4500, 1),
    ).toEqual({
      id: 'b-1',
      serviceId: 's',
      serviceName: 'Cut',
      name: 'Ada',
      startsAtMs: 5,
      endsAtMs: 9,
      state: 'payable',
      paidAmountCents: 0,
      suggestedCents: 4500,
    })
    expect(counterBookingFrom('b-2', { email: 'a@b.co', paidAmountCents: 5000 }, null, 1)).toMatchObject({
      name: 'a@b.co',
      serviceName: 'Appointment',
      state: 'paid',
      paidAmountCents: 5000,
    })
  })

  it('reads and writes dollar amounts', () => {
    expect(centsFromText('$12.50')).toBe(1250)
    expect(centsFromText('1,200')).toBe(120000)
    expect(centsFromText('12.')).toBe(1200)
    expect(centsFromText('12.345')).toBeNull()
    expect(centsFromText('abc')).toBeNull()
    expect(formatUsd(1250)).toBe('$12.50')
  })
})
