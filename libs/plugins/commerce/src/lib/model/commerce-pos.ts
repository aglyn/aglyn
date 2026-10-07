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

/*==========================================
 * THE POS TENDER LEDGER (AGL-3607).
 *
 * A register sale used to be settled by exactly one tender and recorded none:
 * whether a POS order was paid in cash, by the QR link or to a room was
 * inferred afterwards from which other fields happened to be set. A sale now
 * carries `payments[]`, one entry per tender, and takes payments until the
 * balance due is zero. Only then is it `paid`.
 *
 * Every figure here is integer cents. `amountCents` is what a payment put
 * toward the SALE; a tip rides beside it in `tipCents` and never counts toward
 * the balance, the platform's take or the store's revenue. Tips belong to the
 * merchant and their staff.
 *
 * Pure and framework-free, so the register, the customer display and the
 * server read one answer.
 *=========================================*/

/** How one payment toward a register sale was taken. */
export type OrderPaymentMethod =
  | 'cash'
  /** A Stripe Terminal smart reader (tap, insert or swipe). */
  | 'card_present'
  /** A card typed into the console by staff (card not present). */
  | 'card_keyed'
  /** The Stripe payment page the customer opens from a QR code. */
  | 'card_link'
  | 'gift_card'
  /** Charged to a checked-in reservation's folio. */
  | 'folio'

export type OrderPaymentStatus =
  /** Started and not finished: reserves its amount against the balance. */
  | 'pending'
  | 'succeeded'
  /** Declined or errored; may be retried, reserves nothing. */
  | 'failed'
  | 'canceled'
  /** Taken and then handed back when the open sale was voided. */
  | 'reversed'

export const ORDER_PAYMENT_METHODS: readonly OrderPaymentMethod[] = [
  'cash',
  'card_present',
  'card_keyed',
  'card_link',
  'gift_card',
  'folio',
]

/** One payment toward a register sale, on `HostOrder.payments`. */
export interface OrderPayment {
  /** Stable id, derived from the register's attempt key so a retry finds it. */
  id: string
  method: OrderPaymentMethod
  /** Cents put toward the sale. Never includes the tip. */
  amountCents: number
  /** Gratuity on top of `amountCents`, the merchant's and not revenue. */
  tipCents?: number
  status: OrderPaymentStatus
  /** When the payment was started. */
  atMs: number
  /** When it reached `succeeded`. */
  settledAtMs?: number
  /** Stripe PaymentIntent for `card_present` / `card_keyed` / a paid link. */
  paymentIntentId?: string
  /** Stripe Checkout Session for `card_link`. */
  checkoutSessionId?: string
  /** The payment page a `card_link` payment shows as a QR. */
  checkoutUrl?: string
  /** The Terminal reader a `card_present` payment runs on. */
  readerId?: string
  /** The gift card's code (its document id) for `gift_card`. */
  giftCardId?: string
  cardBrand?: string
  last4?: string
  /** Cash handed over for a `cash` payment, and the change given back. */
  cashTenderedCents?: number
  changeCents?: number
  /** The stay a `folio` payment was charged to. */
  reservationId?: string
  /** The folio entry's `atMs`, so a void can remove exactly that entry. */
  folioAtMs?: number
  /**
   * The platform's take attributed to this payment (excludes the tip). For a
   * card payment it is netted from the payout with Stripe's processing cost
   * added, and recorded in `feeCents`; otherwise it accrues to the invoice.
   */
  takeFeeCents?: number
  /** The `application_fee_amount` a card payment carried, or 0. */
  feeCents?: number
  /** Why a `failed` payment failed, in words the cashier can read out. */
  failureMessage?: string
  /** Whether Stripe moved real money; absent for tenders Stripe never saw. */
  livemode?: boolean
  /** The console user who took the payment. */
  cashierId?: string
}

/** The tenders whose money moves through Stripe. */
export const POS_CARD_METHODS: ReadonlySet<OrderPaymentMethod> = new Set([
  'card_present',
  'card_keyed',
  'card_link',
])

export function isCardPaymentMethod(method: OrderPaymentMethod): boolean {
  return POS_CARD_METHODS.has(method)
}

/** Whole non-negative cents from an untrusted value. */
function wholeCents(value: unknown): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * The order's payments, read through one door.
 *
 * Orders written before the ledger existed carry no `payments`, so one is
 * INFERRED from the fields the single-tender register wrote: a folio sale has
 * `reservationId`, a QR sale has `checkoutSessionId`, and anything else on the
 * POS channel was cash. A pending legacy sale is the QR link still waiting.
 * Online orders paid through Stripe Checkout read as one `card_link` payment.
 * Nothing is written back: this is a reader, never a migration.
 */
export function orderPayments(order: {
  payments?: OrderPayment[] | null
  channel?: string
  status?: string
  totals?: { totalCents?: number; tipCents?: number } | null
  amountCents?: number
  reservationId?: string
  checkoutSessionId?: string
  paymentIntentId?: string
  createdAtMs?: number
}): OrderPayment[] {
  if (Array.isArray(order?.payments)) {
    return order.payments.filter(
      (payment): payment is OrderPayment =>
        Boolean(payment) && typeof payment === 'object' && Boolean(payment.id),
    )
  }
  const totalCents = wholeCents(order?.totals?.totalCents ?? order?.amountCents)
  if (!(totalCents > 0)) return []
  const settled = order?.status !== 'pending' && order?.status !== 'cancelled'
  const atMs = Number(order?.createdAtMs) || 0
  const method: OrderPaymentMethod = order?.reservationId
    ? 'folio'
    : order?.checkoutSessionId || order?.paymentIntentId || order?.channel !== 'pos'
      ? 'card_link'
      : 'cash'
  return [
    {
      id: 'legacy',
      method,
      amountCents: totalCents,
      status: settled ? 'succeeded' : order?.status === 'cancelled' ? 'canceled' : 'pending',
      atMs,
      ...(order?.paymentIntentId ? { paymentIntentId: order.paymentIntentId } : {}),
      ...(order?.checkoutSessionId ? { checkoutSessionId: order.checkoutSessionId } : {}),
      ...(order?.reservationId ? { reservationId: order.reservationId } : {}),
    },
  ]
}

/** Cents put toward the sale by payments that succeeded. */
export function posSettledCents(payments: readonly OrderPayment[]): number {
  return payments
    .filter((payment) => payment.status === 'succeeded')
    .reduce((sum, payment) => sum + wholeCents(payment.amountCents), 0)
}

/**
 * Cents spoken for: succeeded payments plus the ones still in flight. A
 * reader waiting for a tap has claimed its share of the balance, so a second
 * tender cannot be started for the same money.
 */
export function posReservedCents(payments: readonly OrderPayment[]): number {
  return payments
    .filter((payment) => payment.status === 'succeeded' || payment.status === 'pending')
    .reduce((sum, payment) => sum + wholeCents(payment.amountCents), 0)
}

/** What the customer still owes, by settled payments. */
export function posBalanceDueCents(
  totalCents: number,
  payments: readonly OrderPayment[],
): number {
  return Math.max(0, wholeCents(totalCents) - posSettledCents(payments))
}

/** What a NEW payment may still take: the balance less what is in flight. */
export function posTenderableCents(
  totalCents: number,
  payments: readonly OrderPayment[],
): number {
  return Math.max(0, wholeCents(totalCents) - posReservedCents(payments))
}

/** Tips taken across the sale's settled payments. */
export function posTipCents(payments: readonly OrderPayment[]): number {
  return payments
    .filter((payment) => payment.status === 'succeeded')
    .reduce((sum, payment) => sum + wholeCents(payment.tipCents), 0)
}

/**
 * The share of the sale's take a payment of `amountCents` carries.
 *
 * Proportional to the part of the SALE it pays, never to the tip. Card
 * payments carry their share in `application_fee_amount`; whatever the card
 * shares leave is accrued to the invoice at completion
 * ({@link posInvoiceTakeCents}), so the take is exact however the sale was
 * split and however each share rounded.
 */
export function posTakeShareCents(input: {
  takeFeeCents: number
  totalCents: number
  amountCents: number
}): number {
  const take = wholeCents(input.takeFeeCents)
  const total = wholeCents(input.totalCents)
  const amount = Math.min(wholeCents(input.amountCents), total)
  if (!(take > 0) || !(total > 0) || !(amount > 0)) return 0
  return Math.min(take, Math.round((take * amount) / total))
}

/**
 * What of the sale's take was NOT netted from a card payout, and therefore
 * goes on the merchant's invoice: the whole take less every succeeded card
 * payment's share. Never negative.
 */
export function posInvoiceTakeCents(input: {
  takeFeeCents: number
  payments: readonly OrderPayment[]
}): number {
  const netted = input.payments
    .filter(
      (payment) =>
        payment.status === 'succeeded' && isCardPaymentMethod(payment.method),
    )
    .reduce((sum, payment) => sum + wholeCents(payment.takeFeeCents), 0)
  return Math.max(0, wholeCents(input.takeFeeCents) - netted)
}

/** How the sale's fee reaches the platform, from what actually paid it. */
export function posFeeCollection(
  payments: readonly OrderPayment[],
): 'payout' | 'invoice' | 'split' {
  const settled = payments.filter((payment) => payment.status === 'succeeded')
  const card = settled.some((payment) => isCardPaymentMethod(payment.method))
  const other = settled.some((payment) => !isCardPaymentMethod(payment.method))
  if (card && other) return 'split'
  return card ? 'payout' : 'invoice'
}

/** A one-line description of a payment for the register, receipt and timeline. */
export function describeOrderPayment(payment: OrderPayment): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const label = ORDER_PAYMENT_METHOD_LABELS[payment.method] ?? 'Payment'
  const card =
    payment.cardBrand || payment.last4
      ? ` (${[payment.cardBrand, payment.last4 ? `•••• ${payment.last4}` : '']
          .filter(Boolean)
          .join(' ')})`
      : ''
  const tip = wholeCents(payment.tipCents)
    ? ` + ${dollars(wholeCents(payment.tipCents))} tip`
    : ''
  return `${label}${card} ${dollars(wholeCents(payment.amountCents))}${tip}`
}

export const ORDER_PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  cash: 'Cash',
  card_present: 'Card reader',
  card_keyed: 'Typed card',
  card_link: 'Card (QR)',
  gift_card: 'Gift card',
  folio: 'Charged to room',
}

/*==========================================
 * TIPS (AGL-3607).
 *=========================================*/

/** The presets a merchant starts with. */
export const POS_TIP_PERCENTAGES_DEFAULT: readonly number[] = [15, 18, 20, 25]

/**
 * The merchant's tip presets from the plugin setting, a comma list such as
 * `15, 18, 20, 25`. Whole percentages from 1 to 100, at most four, in the order
 * given; anything unreadable falls back to the defaults rather than showing
 * the customer an empty choice.
 */
export function posTipPercentages(raw: unknown): number[] {
  const parsed = String(raw ?? '')
    .split(/[,\s]+/)
    .map((part) => Math.round(Number(part)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 100)
  const unique = [...new Set(parsed)].slice(0, 4)
  return unique.length ? unique : [...POS_TIP_PERCENTAGES_DEFAULT]
}

/** A percentage tip on `baseCents`, rounded to the cent. */
export function posTipFromPercent(baseCents: number, percent: number): number {
  const base = wholeCents(baseCents)
  const pct = Number(percent)
  if (!(base > 0) || !Number.isFinite(pct) || pct <= 0) return 0
  return Math.round((base * pct) / 100)
}

/** The largest tip the register accepts on one payment: the payment itself. */
export function posTipProblem(tipCents: number, amountCents: number): string | null {
  if (!Number.isInteger(tipCents) || tipCents < 0) return 'Enter a tip of $0 or more.'
  if (tipCents > wholeCents(amountCents)) {
    return 'A tip can be at most the amount being paid. Check the amount and try again.'
  }
  return null
}

/*==========================================
 * THE CUSTOMER DISPLAY (AGL-3608).
 *
 * A paired screen facing the customer reads one document per register,
 * `hosts/{hostId}/registers/{registerId}/display/state`, through the
 * `commerce/pos-display` route and its display token. The register writes
 * the prompt; the customer's answer comes back in `response`.
 *=========================================*/

export type PosDisplayMode =
  | 'idle'
  /** The live basket, mirrored as the cashier builds it. */
  | 'cart'
  /** The customer picks a tip. */
  | 'tip'
  /** The customer picks how they want their receipt. */
  | 'receipt'
  /** A card payment is waiting on the reader. */
  | 'processing'
  | 'thanks'

export type PosReceiptChannel = 'email' | 'sms' | 'print' | 'none'

export interface PosDisplayLine {
  name: string
  variantLabel?: string
  quantity: number
  amountCents: number
}

export interface PosDisplayCart {
  lines: PosDisplayLine[]
  itemsCents: number
  discountCents: number
  taxCents: number
  totalCents: number
  /** Taken so far, and what is still due, once payments start. */
  paidCents?: number
  dueCents?: number
  tipCents?: number
}

/** The customer's answer to the current prompt. */
export interface PosDisplayResponse {
  /** The prompt this answers; a stale answer is refused. */
  promptId: string
  tipCents?: number
  tipPercent?: number
  /** `none` when the customer chose no tip. */
  tipChoice?: 'percent' | 'custom' | 'none'
  receiptChannel?: PosReceiptChannel
  email?: string
  phone?: string
  marketingOptIn?: boolean
  atMs: number
}

export interface PosDisplayState {
  mode: PosDisplayMode
  updatedAtMs: number
  /**
   * The ISO currency every amount on the screen is in (`usd`). Stamped by
   * the server from the store's own currency, never taken from the register.
   */
  currency?: string
  /** Changes every time the register asks something new. */
  promptId?: string
  cart?: PosDisplayCart
  tip?: {
    /** What a percentage is taken of: the amount being paid now. */
    baseCents: number
    percentages: number[]
    allowCustom: boolean
  }
  receipt?: {
    channels: PosReceiptChannel[]
    /** Whether to offer the store's marketing opt-in under the email field. */
    offerMarketing: boolean
  }
  processing?: { message: string }
  response?: PosDisplayResponse
}

/** Most lines a display state carries; a longer basket shows its newest. */
export const POS_DISPLAY_MAX_LINES = 60

/** A pairing code lives this long before the register must show a new one. */
export const POS_DISPLAY_PAIRING_TTL_MS = 10 * 60 * 1000

/** A thank-you screen returns to idle on the display after this long. */
export const POS_DISPLAY_THANKS_MS = 8_000

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** An email address as the display may store it, or '' when it is not one. */
export function posDisplayEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase().slice(0, 254)
  return EMAIL_PATTERN.test(email) ? email : ''
}

/** A phone number as digits with an optional leading +, or '' when too short. */
export function posDisplayPhone(value: unknown): string {
  const raw = String(value ?? '').trim()
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length < 7 || digits.length > 15) return ''
  return `${raw.startsWith('+') ? '+' : ''}${digits}`
}

/**
 * The display state as the REGISTER may send it: clamped, typed and stripped
 * of anything the customer screen has no business holding. The register is
 * staff and trusted for intent, not for shape.
 */
export function sanitizePosDisplayState(
  raw: unknown,
  nowMs: number,
): PosDisplayState {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const modes: PosDisplayMode[] = ['idle', 'cart', 'tip', 'receipt', 'processing', 'thanks']
  const mode = modes.includes(input['mode']) ? (input['mode'] as PosDisplayMode) : 'idle'
  const state: PosDisplayState = { mode, updatedAtMs: nowMs }
  const promptId = String(input['promptId'] ?? '').slice(0, 64)
  if (promptId) state.promptId = promptId
  const cart = input['cart']
  if (cart && typeof cart === 'object' && mode !== 'idle') {
    const lines = (Array.isArray(cart.lines) ? cart.lines : [])
      .slice(-POS_DISPLAY_MAX_LINES)
      .map((line: any) => ({
        name: String(line?.name ?? '').slice(0, 120),
        ...(line?.variantLabel
          ? { variantLabel: String(line.variantLabel).slice(0, 80) }
          : {}),
        quantity: Math.max(1, Math.min(999, Math.round(Number(line?.quantity) || 1))),
        amountCents: wholeCents(line?.amountCents),
      }))
    state.cart = {
      lines,
      itemsCents: wholeCents(cart.itemsCents),
      discountCents: wholeCents(cart.discountCents),
      taxCents: wholeCents(cart.taxCents),
      totalCents: wholeCents(cart.totalCents),
      ...(cart.paidCents != null ? { paidCents: wholeCents(cart.paidCents) } : {}),
      ...(cart.dueCents != null ? { dueCents: wholeCents(cart.dueCents) } : {}),
      ...(cart.tipCents != null ? { tipCents: wholeCents(cart.tipCents) } : {}),
    }
  }
  if (mode === 'tip') {
    const tip = input['tip'] ?? {}
    state.tip = {
      baseCents: wholeCents(tip.baseCents),
      percentages: posTipPercentages(
        Array.isArray(tip.percentages) ? tip.percentages.join(',') : tip.percentages,
      ),
      allowCustom: tip.allowCustom !== false,
    }
  }
  if (mode === 'receipt') {
    const receipt = input['receipt'] ?? {}
    const allowed: PosReceiptChannel[] = ['email', 'sms', 'print', 'none']
    const channels = (Array.isArray(receipt.channels) ? receipt.channels : [])
      .filter((channel: unknown): channel is PosReceiptChannel =>
        allowed.includes(channel as PosReceiptChannel),
      )
    state.receipt = {
      channels: channels.length ? [...new Set<PosReceiptChannel>(channels)] : ['print', 'none'],
      offerMarketing: receipt.offerMarketing === true,
    }
  }
  if (mode === 'processing') {
    state.processing = {
      message:
        String(input['processing']?.message ?? '').slice(0, 160) ||
        'Tap, insert or swipe your card on the reader.',
    }
  }
  return state
}

/**
 * The customer's answer as the DISPLAY may send it, checked against the
 * prompt it claims to answer. Returns null when it answers nothing the
 * register asked: a stale screen, a replay, or a mode that takes no answer.
 */
export function sanitizePosDisplayResponse(
  state: PosDisplayState | null | undefined,
  raw: unknown,
  nowMs: number,
): PosDisplayResponse | null {
  if (!state || !state.promptId) return null
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  if (String(input['promptId'] ?? '') !== state.promptId) return null
  const response: PosDisplayResponse = { promptId: state.promptId, atMs: nowMs }
  if (state.mode === 'tip' && state.tip) {
    const choice = input['tipChoice']
    if (choice === 'none') {
      response.tipChoice = 'none'
      response.tipCents = 0
    } else if (choice === 'percent') {
      const percent = Math.round(Number(input['tipPercent']))
      if (!state.tip.percentages.includes(percent)) return null
      response.tipChoice = 'percent'
      response.tipPercent = percent
      response.tipCents = posTipFromPercent(state.tip.baseCents, percent)
    } else if (choice === 'custom' && state.tip.allowCustom) {
      const tipCents = Math.round(Number(input['tipCents']))
      if (posTipProblem(tipCents, state.tip.baseCents)) return null
      response.tipChoice = 'custom'
      response.tipCents = tipCents
    } else {
      return null
    }
    return response
  }
  if (state.mode === 'receipt' && state.receipt) {
    const channel = input['receiptChannel'] as PosReceiptChannel
    if (!state.receipt.channels.includes(channel)) return null
    response.receiptChannel = channel
    if (channel === 'email') {
      const email = posDisplayEmail(input['email'])
      if (!email) return null
      response.email = email
      if (state.receipt.offerMarketing && input['marketingOptIn'] === true) {
        response.marketingOptIn = true
      }
    }
    if (channel === 'sms') {
      const phone = posDisplayPhone(input['phone'])
      if (!phone) return null
      response.phone = phone
    }
    return response
  }
  return null
}

/**
 * The state as the DISPLAY reads it. The customer's own typed address is
 * never echoed back to the screen: once answered, the prompt is done and the
 * screen shows what comes next, so nothing a later customer could read off
 * an unattended tablet is ever sent to it.
 */
export function posDisplayPublicState(
  state: PosDisplayState | null | undefined,
  nowMs: number,
): Omit<PosDisplayState, 'response'> & { answered: boolean } {
  if (!state) return { mode: 'idle', updatedAtMs: nowMs, answered: false }
  const { response, ...rest } = state
  if (rest.mode === 'thanks' && nowMs - rest.updatedAtMs > POS_DISPLAY_THANKS_MS) {
    return { mode: 'idle', updatedAtMs: rest.updatedAtMs, answered: false }
  }
  return {
    ...rest,
    answered: Boolean(response && response.promptId === rest.promptId),
  }
}
