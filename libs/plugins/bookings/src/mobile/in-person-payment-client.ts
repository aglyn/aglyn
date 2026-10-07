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

import { bookingInPersonAmountProblem } from '../lib/model/booking-in-person'

/*==========================================
 * ONE IN-PERSON BOOKING PAYMENT, END TO END (AGL-3618).
 *
 * start (the server prices it and makes the intent) → the host app's card
 * reader collects the card → settle (the server re-reads Stripe and
 * captures). The reader is the app's; this module only sequences it, so it
 * runs in any app whose plugin context carries a card reader.
 *
 * A failed or canceled collection releases the intent so the booking is
 * payable again. A collection that cannot be confirmed (the answer was lost)
 * is settled anyway: the server reads Stripe, and an authorization the app
 * never heard about is still captured exactly once.
 *=========================================*/

/** The slice of the plugin context's API client this needs. */
export interface BookingsApi {
  request<T = unknown>(
    path: string,
    init?: { method?: 'POST'; body?: unknown; idempotencyKey?: string },
  ): Promise<T>
}

/** The slice of the host app's card reader this needs. */
export interface BookingsCardReader {
  collect(input: {
    paymentIntentId: string
    clientSecret: string
    amountCents: number
  }): Promise<{ status: 'collected' | 'canceled' | 'failed'; message?: string }>
}

export type InPersonOutcome =
  | { status: 'paid'; amountCents: number }
  | { status: 'canceled' }
  | { status: 'failed'; message: string }

const ROUTE = '/api/bookings/in-person-payment'

interface StartAnswer {
  paymentIntentId: string
  clientSecret: string
  amountCents: number
  serviceCents: number
  taxCents: number
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export async function takeBookingPayment(input: {
  api: BookingsApi
  reader: BookingsCardReader
  hostId: string
  bookingId: string
  /** The service amount staff entered, before tax. */
  serviceCents: number
  /** One per press of "Charge": a retry of the same press replays. */
  attemptKey: string
  /** Shown before the card is asked for: the whole charge, tax included. */
  onPriced?: (priced: { amountCents: number; taxCents: number }) => void
}): Promise<InPersonOutcome> {
  const problem = bookingInPersonAmountProblem(input.serviceCents)
  if (problem) return { status: 'failed', message: problem }
  let started: StartAnswer
  try {
    started = await input.api.request<StartAnswer>(ROUTE, {
      method: 'POST',
      body: { hostId: input.hostId, bookingId: input.bookingId, action: 'start', amountCents: input.serviceCents },
      idempotencyKey: input.attemptKey,
    })
  } catch (error) {
    return { status: 'failed', message: messageOf(error, 'The payment could not be started. Try again.') }
  }
  input.onPriced?.({ amountCents: started.amountCents, taxCents: started.taxCents })

  let collected: Awaited<ReturnType<BookingsCardReader['collect']>> | null = null
  try {
    collected = await input.reader.collect({
      paymentIntentId: started.paymentIntentId,
      clientSecret: started.clientSecret,
      amountCents: started.amountCents,
    })
  } catch {
    // The reader's answer was lost: the server's reading of Stripe decides.
    collected = null
  }

  if (collected && collected.status !== 'collected') {
    await release(input)
    return collected.status === 'canceled'
      ? { status: 'canceled' }
      : { status: 'failed', message: collected.message || 'The card was not taken.' }
  }
  try {
    const settled = await input.api.request<{ status: string; amountCents?: number }>(ROUTE, {
      method: 'POST',
      body: { hostId: input.hostId, bookingId: input.bookingId, action: 'settle' },
    })
    if (settled.status === 'paid') return { status: 'paid', amountCents: Number(settled.amountCents ?? started.amountCents) }
    await release(input)
    return { status: 'failed', message: 'The card was not charged. Try again.' }
  } catch (error) {
    return {
      status: 'failed',
      message: messageOf(error, 'The payment could not be confirmed. Check the booking before charging again.'),
    }
  }
}

async function release(input: { api: BookingsApi; hostId: string; bookingId: string }): Promise<void> {
  await input.api
    .request(ROUTE, { method: 'POST', body: { hostId: input.hostId, bookingId: input.bookingId, action: 'cancel' } })
    .catch(() => undefined)
}
