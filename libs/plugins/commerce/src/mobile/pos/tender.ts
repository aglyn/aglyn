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

import type { MobileApiClient, MobileCardReader } from '@aglyn/mobile-plugin-host'
import { posTipFromPercent } from '../../lib/model/commerce-pos'
import { type PosPaymentAnswer, type PosSalePayment, paymentOf, salePayment } from './sale-api'

/*==========================================
 * TAKING ONE TENDER (AGL-3618).
 *
 * Each tender is a short, resumable sequence against the open sale, and
 * every one ends in the same few outcomes the checkout can act on:
 *
 * - `settled`: the server recorded the payment (the sale may still have a
 *   balance, when this was a split);
 * - `canceled`: nobody was charged and the same tender can be tried again;
 * - `failed`: declined or broken, with words to read out;
 * - `unknown`: the answer was lost (the network dropped mid-call). The
 *   cashier checks the sale again rather than pressing the tender twice;
 *   the attempt key makes even a second press safe, because the route finds
 *   the payment the first press started.
 *
 * The device never decides that money moved: a card collected on this phone
 * is AUTHORIZED here and recorded by the server's own read of Stripe
 * (`status`), which also captures it.
 *=========================================*/

export type TenderOutcome =
  | { kind: 'settled'; answer: PosPaymentAnswer; payment: PosSalePayment | null }
  | { kind: 'canceled'; answer: PosPaymentAnswer | null }
  | { kind: 'failed'; message: string; answer: PosPaymentAnswer | null }
  | { kind: 'unknown'; message: string }

/** A lost answer (status 0) as opposed to the route's refusal. */
export function isLostAnswer(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return status === 0 || status === undefined
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const LOST =
  'The connection dropped before the answer arrived. Check the sale before taking payment again.'

function failedOrUnknown(error: unknown, fallback: string): TenderOutcome {
  if (isLostAnswer(error)) return { kind: 'unknown', message: LOST }
  return { kind: 'failed', message: messageOf(error, fallback), answer: null }
}

/** What a payment's own status means for the checkout. */
export function outcomeOfPayment(answer: PosPaymentAnswer): TenderOutcome | null {
  const payment = paymentOf(answer)
  if (!payment) return null
  if (payment.status === 'succeeded') return { kind: 'settled', answer, payment }
  if (payment.status === 'canceled') return { kind: 'canceled', answer }
  if (payment.status === 'failed') {
    return { kind: 'failed', message: payment.failureMessage || 'The card was declined.', answer }
  }
  return null
}

export interface TenderDeps {
  api: MobileApiClient
  hostId: string
  orderId: string
  sleep?: (ms: number) => Promise<void>
}

const wait = (deps: TenderDeps, ms: number) =>
  (deps.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay))))(ms)

/**
 * Re-reads one card payment from Stripe through the server until it settles
 * or fails. A collected card is usually recorded at the first read; the
 * retries cover the moment between the reader's answer and Stripe's.
 */
export async function settleCardPayment(
  deps: TenderDeps,
  paymentId: string,
  attempts = 5,
): Promise<TenderOutcome> {
  let last: PosPaymentAnswer | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await salePayment({ ...deps, step: { action: 'status', paymentId } })
    } catch (error) {
      if (attempt === attempts - 1) return failedOrUnknown(error, 'The payment could not be confirmed.')
      await wait(deps, 1000)
      continue
    }
    const outcome = outcomeOfPayment(last)
    if (outcome) return outcome
    await wait(deps, 1000 * (attempt + 1))
  }
  return {
    kind: 'unknown',
    message: 'The card was read, but the payment is not confirmed yet. Check the sale in a moment.',
  }
}

/** Stops a card payment nobody was charged for, so the balance is open again. */
export async function cancelCardPayment(deps: TenderDeps, paymentId: string): Promise<PosPaymentAnswer | null> {
  return await salePayment({ ...deps, step: { action: 'cancel', paymentId } }).catch(() => null)
}

/**
 * This device's reader (Tap to Pay or Bluetooth): the server makes the
 * intent, the reader collects the card, the server records it.
 */
export async function payWithDeviceReader(
  deps: TenderDeps & {
    reader: MobileCardReader
    amountCents: number
    tipCents: number
    attemptKey: string
  },
): Promise<TenderOutcome> {
  let started: PosPaymentAnswer
  try {
    started = await salePayment({
      ...deps,
      attemptKey: deps.attemptKey,
      step: { action: 'card-present-sdk', amountCents: deps.amountCents, tipCents: deps.tipCents },
    })
  } catch (error) {
    return failedOrUnknown(error, 'The card payment could not be started.')
  }
  const already = outcomeOfPayment(started)
  // A retried press whose first attempt already settled or failed.
  if (already && already.kind !== 'canceled') return already
  const payment = paymentOf(started)
  if (!payment || !started.clientSecret || !started.paymentIntentId) {
    return { kind: 'failed', message: payment?.failureMessage || 'The card payment could not be started.', answer: started }
  }
  const collected = await deps.reader.collect({
    paymentIntentId: started.paymentIntentId,
    clientSecret: started.clientSecret,
    amountCents: payment.amountCents + (payment.tipCents ?? 0),
    tipEligible: false,
  })
  if (collected.status === 'canceled') {
    return { kind: 'canceled', answer: (await cancelCardPayment(deps, payment.id)) ?? started }
  }
  if (collected.status === 'failed') {
    // The intent stays open on the server, which may still read a decline;
    // releasing it lets the cashier try another card or another tender.
    const answer = (await cancelCardPayment(deps, payment.id)) ?? started
    return { kind: 'failed', message: collected.message, answer }
  }
  return await settleCardPayment(deps, payment.id)
}

/** A smart reader on the counter: the server pushes the intent to it. */
export async function startSmartReader(
  deps: TenderDeps & { readerId: string; amountCents: number; tipCents: number; attemptKey: string },
): Promise<TenderOutcome | { kind: 'waiting'; answer: PosPaymentAnswer; paymentId: string }> {
  let started: PosPaymentAnswer
  try {
    started = await salePayment({
      ...deps,
      attemptKey: deps.attemptKey,
      step: {
        action: 'card-present',
        readerId: deps.readerId,
        amountCents: deps.amountCents,
        tipCents: deps.tipCents,
      },
    })
  } catch (error) {
    return failedOrUnknown(error, 'The card reader could not start the payment.')
  }
  const outcome = outcomeOfPayment(started)
  if (outcome) return outcome
  const payment = paymentOf(started)
  if (!payment) return { kind: 'failed', message: 'The card reader could not start the payment.', answer: started }
  return { kind: 'waiting', answer: started, paymentId: payment.id }
}

/** One read of a smart-reader payment; null while the customer is still at the reader. */
export async function pollSmartReader(deps: TenderDeps, paymentId: string): Promise<TenderOutcome | null> {
  try {
    return outcomeOfPayment(await salePayment({ ...deps, step: { action: 'status', paymentId } }))
  } catch (error) {
    return isLostAnswer(error) ? null : failedOrUnknown(error, 'The payment could not be read.')
  }
}

/** Cash: the server works out the change from what the customer handed over. */
export async function payCash(
  deps: TenderDeps & { tenderedCents: number; amountCents?: number; tipCents: number; attemptKey: string },
): Promise<TenderOutcome> {
  try {
    const answer = await salePayment({
      ...deps,
      attemptKey: deps.attemptKey,
      step: {
        action: 'cash',
        tenderedCents: deps.tenderedCents,
        tipCents: deps.tipCents,
        ...(deps.amountCents ? { amountCents: deps.amountCents } : {}),
      },
    })
    return outcomeOfPayment(answer) ?? { kind: 'settled', answer, payment: paymentOf(answer) }
  } catch (error) {
    return failedOrUnknown(error, 'The cash payment could not be recorded.')
  }
}

export interface TipChoice {
  id: string
  label: string
  cents: number
}

/** The merchant's tip presets on what is left to pay, plus no tip. */
export function tipChoices(baseCents: number, percentages: readonly number[]): TipChoice[] {
  return [
    { id: 'none', label: 'No tip', cents: 0 },
    ...percentages.map((percent) => ({
      id: `pct-${percent}`,
      label: `${percent}%`,
      cents: posTipFromPercent(baseCents, percent),
    })),
  ]
}

/** The bills a customer is likely to hand over: exact, then the next $5, $10, $20, $50, $100. */
export function cashQuickAmounts(dueCents: number): number[] {
  const due = Math.max(0, Math.round(dueCents))
  if (!due) return []
  const amounts = new Set<number>([due])
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const next = Math.ceil(due / step) * step
    if (next > due) amounts.add(next)
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 5)
}

/** "$12.50" or "12.5" as whole cents; null when it is not an amount. */
export function centsFromText(text: string): number | null {
  const cleaned = String(text ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  return Number.isFinite(cents) ? cents : null
}
