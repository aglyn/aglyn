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

import * as Aglyn from '@aglyn/aglyn/server'
import { pluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import {
  resolveHostToken,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import * as CommerceModel from '../model'
import { mintDownloadToken } from './download'
import { orderStatusUrl } from './order-status-token'

/**
 * Every message a buyer gets about their order, through ONE door (AGL-3610).
 *
 * Before this, the buyer heard about their order once — the online receipt —
 * and never again: a register sale sent nothing, a paid payment link sent
 * nothing, and shipping, delivery, refunds and cancellations were silent
 * (`fulfill-order.ts` said so on purpose). Every path that moves an order now
 * makes one call here, and this decides what that moment owes the buyer:
 *
 *   - whether the store turned the moment off (`buyerNotifications` on the
 *     store settings; ON unless explicitly off — see the model),
 *   - which channels can carry it (email when mail is configured and the
 *     order has an address; a text when the platform's SMS provider is
 *     configured and the order carries the buyer's phone),
 *   - and whether it was already sent.
 *
 * ## ONCE PER MOMENT, PER OCCURRENCE, PER CHANNEL
 *
 * Stripe redelivers webhooks, admins click twice, a lost response is retried.
 * Each message is CLAIMED before it is sent: a transaction reads the order's
 * `buyerNotifications` map and writes a `sending` marker for
 * `event__occurrence__channel` only if none is there. Exactly one of two
 * racing callers wins the claim; the other returns `already`. The occurrence
 * is the shipment id for `shipped` and the refund id for `refunded`, so a
 * second parcel or a second partial refund is a new message, while a
 * redelivered one is not.
 *
 * A send that fails RELEASES its claim so the next attempt can try again. A
 * process that dies between claim and send leaves the marker in `sending` and
 * the message unsent — at most once, never twice, which is the right side to
 * fail on for mail a buyer reads as "did they charge me again?".
 *
 * ## NEVER THROWS
 *
 * Every caller is past its point of no return — money moved, an order
 * shipped — so a mail outage must not turn into a 500 that invites the
 * merchant to do it again. Failures are logged and returned as outcomes.
 *
 * Shared with the order-processing and POS lanes (AGL-3611, AGL-3607): call
 * {@link notifyOrderBuyer} from any new path that moves an order, and
 * {@link sendOrderReceipt} for an explicit, merchant-asked send.
 */

export type OrderBuyerEvent = CommerceModel.BuyerNotificationEvent

export interface OrderRef {
  hostId: string
  orderId: string
}

export interface NotifyOrderBuyerOptions {
  /** `shipped`: which shipment. Absent means the order's latest one. */
  fulfillmentId?: string
  /** `refunded`: the refund's own id (Stripe's), the occurrence key. */
  refundId?: string
  /** `refunded`: what THIS refund moved, in cents. */
  refundCents?: number
  /** `refunded`: the line indexes refunded by name, when any were. */
  refundLineIndexes?: readonly number[]
  /** `refunded`: whether this refund closed the order. */
  fullyRefunded?: boolean
  /**
   * The buyer's address when the order document does not carry it — a POS
   * folio sale attributed to the reservation's guest, a payment link whose
   * payer Stripe named. The order's own `customerEmail` wins when present.
   */
  email?: string | null
  /** Injected in specs. */
  firestore?: FirebaseFirestore.Firestore
}

export type OrderBuyerChannelOutcome =
  | { channel: CommerceModel.BuyerNotificationChannel; outcome: 'sent' }
  | { channel: CommerceModel.BuyerNotificationChannel; outcome: 'already' }
  | {
      channel: CommerceModel.BuyerNotificationChannel
      outcome: 'failed'
      error: string
    }

export type NotifyOrderBuyerOutcome =
  | { outcome: 'disabled' }
  | { outcome: 'no_such_order' }
  /** The moment does not apply to this order (a counter sale "shipping"). */
  | { outcome: 'not_applicable' }
  /** No channel could carry it: no address, no mail or text configured. */
  | { outcome: 'no_recipient' }
  | { outcome: 'handled'; channels: OrderBuyerChannelOutcome[] }

interface StoreContext {
  firestore: FirebaseFirestore.Firestore
  hostRef: FirebaseFirestore.DocumentReference
  host: Record<string, unknown>
  settings: Record<string, unknown>
  currency: string
}

async function readStore(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<StoreContext> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [hostSnapshot, settingsSnapshot] = await Promise.all([
    hostRef.get().catch(() => null),
    hostRef.collection('settings').doc('store').get().catch(() => null),
  ])
  const settings = (settingsSnapshot?.data?.() ?? {}) as Record<string, unknown>
  return {
    firestore,
    hostRef,
    host: (hostSnapshot?.data?.() ?? {}) as Record<string, unknown>,
    settings,
    currency: String(settings['currency'] ?? 'USD') || 'USD',
  }
}

function lineLabel(line: CommerceModel.OrderLineItem): string {
  return `${line.quantity}× ${line.name}${
    line.variantLabel ? ` (${line.variantLabel})` : ''
  }`
}

/** The status link, or the store's home page when no link can be minted. */
function statusLink(store: StoreContext, ref: OrderRef): string {
  return (
    orderStatusUrl(store.host as never, ref.hostId, ref.orderId) ??
    Aglyn.hostPublicOrigin({
      cname: typeof store.host['cname'] === 'string' ? store.host['cname'] : null,
      subdomain:
        typeof store.host['subdomain'] === 'string'
          ? store.host['subdomain']
          : null,
    }) ??
    ''
  )
}

interface ComposedMessage {
  emailKey: string
  /** Tokens for the designed email. */
  tokens: Record<string, string>
  /** Subject when the template renders none. */
  subject: string
  /** Plain-text body when the template renders none. */
  text: string
  /** The text message, kept short: one or two segments. */
  sms: string
  /** The order timeline line recording the send, channel appended. */
  timelineDetail: string
}

/** What the moment says. `null` when it does not apply to this order. */
export function composeOrderBuyerMessage(input: {
  event: OrderBuyerEvent
  order: CommerceModel.HostOrder
  orderId: string
  businessName: string
  currency: string
  statusUrl: string
  receiptFooter?: string
  /** Absolute digital-delivery links for a receipt, by product id. */
  downloadLinks?: Record<string, string>
  options?: NotifyOrderBuyerOptions
}): (ComposedMessage & { occurrence: string }) | null {
  const {
    event,
    order,
    orderId,
    businessName,
    currency,
    statusUrl,
    options = {},
  } = input
  const lines = order.lineItems ?? []
  const number = CommerceModel.formatOrderNumber(order, orderId)
  const money = (cents: number) =>
    CommerceModel.formatOrderMoney(cents, currency)
  const store = businessName || 'The store'
  const base = {
    'order.number': number,
    'order.statusUrl': statusUrl,
    'order.ref': orderId,
  }
  const link = statusUrl ? `\n\nView your order: ${statusUrl}` : ''
  const smsLink = statusUrl ? ` ${statusUrl}` : ''

  if (event === 'receipt') {
    const totalCents =
      order.totals?.totalCents ?? Number(order.amountCents ?? 0)
    const licenseText = Object.entries(
      ((order as { licenseKeys?: Record<string, string[]> }).licenseKeys ??
        {}) as Record<string, string[]>,
    )
      .flatMap(([productId, keys]) => {
        const line = lines.find((item) => item.productId === productId)
        return (keys ?? []).map(
          (key) => `License key (${line?.name ?? 'product'}): ${key}`,
        )
      })
      .join('\n')
    const downloads = Object.entries(input.downloadLinks ?? {})
      .map(([productId, url]) => {
        const line = lines.find((item) => item.productId === productId)
        return `Download ${line?.name ?? 'your file'}: ${url}`
      })
      .join('\n')
    const linesText = lines
      .map(
        (line) =>
          `${lineLabel(line)} — ${money(line.unitAmountCents * line.quantity)}`,
      )
      .join('\n')
    const summary = [linesText, licenseText, downloads]
      .filter(Boolean)
      .join('\n\n')
    const footer = String(input.receiptFooter ?? '')
    return {
      occurrence: 'order',
      emailKey: CommerceModel.BUYER_NOTIFICATION_EMAIL_KEYS.receipt,
      tokens: {
        ...base,
        'order.summary': summary,
        'order.total': money(totalCents),
        'store.receiptFooter': footer,
      },
      subject: 'Receipt for your order',
      text:
        `Thanks for your purchase!\n\n${summary}\n\nTotal: ${money(totalCents)}\n` +
        `Order ${number}` +
        (footer ? `\n\n${footer}` : '') +
        link,
      sms: `${store}: receipt for order ${number}, ${money(totalCents)}.${smsLink}`,
      timelineDetail: 'Receipt sent',
    }
  }

  if (event === 'shipped') {
    const fulfillments = order.fulfillments ?? []
    const fulfillment = options.fulfillmentId
      ? fulfillments.find((entry) => entry.id === options.fulfillmentId)
      : [...fulfillments].sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0))[0]
    if (!fulfillment) return null
    // The units THIS shipment carried (AGL-3611): a partial shipment of a
    // line names its own count, not the line's.
    const shipped = CommerceModel.fulfillmentLineQuantities(order, fulfillment)
      .map((entry) =>
        lines[entry.lineItemId] ? { ...lines[entry.lineItemId], quantity: entry.quantity } : null,
      )
      .filter(Boolean) as CommerceModel.OrderLineItem[]
    const tracking = CommerceModel.fulfillmentTrackingUrl(fulfillment)
    const hasTracking = Boolean(fulfillment.trackingNumber)
    // Nothing physical left the building: a register sale handed over the
    // counter, or a digital-only order the merchant marked fulfilled. A
    // "your order is on its way" email for either is noise at best.
    const physical = shipped.some(
      (line) =>
        line.productType !== 'digital' && line.productType !== 'service',
    )
    if (!hasTracking && (order.channel === 'pos' || !physical)) return null
    // Shippable units still out, over every active shipment (AGL-3611).
    const remainingUnits = CommerceModel.remainingFulfillmentLines(order).reduce(
      (sum, entry) => sum + entry.quantity,
      0,
    )
    const carrier = CommerceModel.carrierLabelFor(fulfillment.carrier)
    const trackingSentence = hasTracking
      ? `Tracking: ${[carrier, fulfillment.trackingNumber]
          .filter(Boolean)
          .join(' ')}${tracking ? ` — ${tracking}` : ''}`
      : ''
    const remainingSentence =
      remainingUnits > 0
        ? `${remainingUnits} more item${remainingUnits === 1 ? '' : 's'} will ship separately.`
        : ''
    const summary = shipped.map(lineLabel).join('\n')
    return {
      occurrence: fulfillment.id,
      emailKey: CommerceModel.BUYER_NOTIFICATION_EMAIL_KEYS.shipped,
      tokens: {
        ...base,
        'shipment.summary': summary,
        'shipment.carrier': carrier,
        'shipment.trackingNumber': String(fulfillment.trackingNumber ?? ''),
        'shipment.tracking': trackingSentence,
        'shipment.remaining': remainingSentence,
      },
      subject: `Your order ${number} has shipped`,
      text:
        `${store} shipped items from order ${number}.\n\n${summary}` +
        (trackingSentence ? `\n\n${trackingSentence}` : '') +
        (remainingSentence ? `\n\n${remainingSentence}` : '') +
        link,
      sms:
        `${store}: order ${number} has shipped.` +
        (tracking ? ` Track it: ${tracking}` : smsLink),
      timelineDetail: 'Shipping confirmation sent',
    }
  }

  if (event === 'delivered') {
    // A counter sale is "delivered" the moment it is handed over.
    if (order.channel === 'pos') return null
    const summary = lines.map(lineLabel).join('\n')
    return {
      occurrence: 'order',
      emailKey: CommerceModel.BUYER_NOTIFICATION_EMAIL_KEYS.delivered,
      tokens: { ...base, 'order.summary': summary },
      subject: `Your order ${number} was delivered`,
      text:
        `${store} marked order ${number} as delivered.\n\n${summary}` + link,
      sms: `${store}: order ${number} was delivered.${smsLink}`,
      timelineDetail: 'Delivery confirmation sent',
    }
  }

  if (event === 'refunded') {
    const refundCents = Math.max(0, Math.round(Number(options.refundCents ?? 0)))
    if (!(refundCents > 0)) return null
    const refundedLines = (options.refundLineIndexes ?? [])
      .map((index) => lines[index])
      .filter(Boolean) as CommerceModel.OrderLineItem[]
    const summary = refundedLines.map(lineLabel).join('\n')
    const note = options.fullyRefunded
      ? 'Your order has been refunded in full.'
      : 'The rest of your order is unchanged.'
    return {
      // The refund's own id is the occurrence; without one, the running
      // total after this refund is (each settled refund raises it).
      occurrence:
        options.refundId ||
        `total-${Number(order.refundedCents ?? 0) || refundCents}`,
      emailKey: CommerceModel.BUYER_NOTIFICATION_EMAIL_KEYS.refunded,
      tokens: {
        ...base,
        'refund.amount': money(refundCents),
        'refund.summary': summary,
        'refund.note': note,
      },
      subject: `Refund for your order ${number}`,
      text:
        `${store} refunded ${money(refundCents)} on order ${number}.` +
        (summary ? `\n\n${summary}` : '') +
        `\n\n${note}\n\nRefunds go back to the original payment method and ` +
        'usually appear within 5 to 10 business days, depending on your bank.' +
        link,
      sms: `${store}: ${money(refundCents)} refunded on order ${number}.${smsLink}`,
      timelineDetail: `Refund confirmation sent (${money(refundCents)})`,
    }
  }

  // cancelled
  const summary = lines.map(lineLabel).join('\n')
  const wasPaid = Boolean(
    order.paymentIntentId ||
      (order.channel === 'pos' && order.status !== 'pending') ||
      (order.timeline ?? []).some((entry) => entry?.event === 'paid'),
  )
  const note = wasPaid
    ? `Questions about a payment? Reply to this email or contact ${store}.`
    : ''
  return {
    occurrence: 'order',
    emailKey: CommerceModel.BUYER_NOTIFICATION_EMAIL_KEYS.cancelled,
    tokens: { ...base, 'order.summary': summary, 'cancel.note': note },
    subject: `Your order ${number} was canceled`,
    text:
      `${store} canceled order ${number}.\n\n${summary}` +
      (note ? `\n\n${note}` : '') +
      link,
    sms: `${store}: order ${number} was canceled.${smsLink}`,
    timelineDetail: 'Cancellation notice sent',
  }
}

/**
 * Claims one message in a transaction. `true` when this caller owns the send;
 * `false` when a marker is already there (sent, or being sent).
 */
async function claimMessage(
  firestore: FirebaseFirestore.Firestore,
  orderRef: FirebaseFirestore.DocumentReference,
  marker: string,
  channel: CommerceModel.BuyerNotificationChannel,
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return false
    const sent = (snapshot.get('buyerNotifications') ?? {}) as Record<
      string,
      unknown
    >
    if (sent[marker]) return false
    transaction.update(orderRef, {
      [`buyerNotifications.${marker}`]: {
        state: 'sending',
        channel,
        atMs: Date.now(),
      },
    })
    return true
  })
}

/** Marks a claimed message sent and records it on the order timeline. */
async function settleMessage(
  firestore: FirebaseFirestore.Firestore,
  orderRef: FirebaseFirestore.DocumentReference,
  marker: string | null,
  channel: CommerceModel.BuyerNotificationChannel,
  detail: string,
): Promise<void> {
  await firestore
    .runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) return
      const order = CommerceModel.liftLegacyOrder(
        (snapshot.data() ?? {}) as never,
      )
      const atMs = Date.now()
      transaction.update(orderRef, {
        ...(marker
          ? {
              [`buyerNotifications.${marker}`]: { state: 'sent', channel, atMs },
            }
          : {}),
        timeline: CommerceModel.appendOrderEvent(
          order,
          'buyer-notified',
          `${detail} by ${channel === 'sms' ? 'text' : 'email'}`,
          atMs,
        ),
      })
    })
    .catch((error) => {
      console.error('[order-notifications] settle failed', marker, error)
    })
}

async function releaseMessage(
  orderRef: FirebaseFirestore.DocumentReference,
  marker: string,
): Promise<void> {
  await orderRef
    .update({
      [`buyerNotifications.${marker}`]:
        firebaseAdmin.firestore.FieldValue.delete(),
    })
    .catch(() => undefined)
}

async function deliverEmail(
  store: StoreContext,
  ref: OrderRef,
  to: string,
  message: ComposedMessage,
  context: string,
): Promise<void> {
  const designed = await renderHostEmailWithTokens(
    store.firestore,
    ref.hostId,
    message.emailKey,
    message.tokens,
  )
  const org = await getOrgForHost(ref.hostId).catch(() => null)
  await sendEmail({
    to,
    subject: designed?.subject ?? message.subject,
    text: designed?.text || message.text,
    ...(designed?.html ? { html: designed.html } : {}),
    fromName: Aglyn.resolveBrandingProfile(org?.org as never).fromName,
    sendingIdentity: await hostSendingIdentity(ref.hostId),
    audience: 'tenant',
    context,
    // Owed to the recipient by their own order: the phishing screen's soft
    // rules never hold it (AGL-3356).
    owedFor: 'order',
  })
  // Cost meter (AGL-1438), as every transactional store email.
  await meterHostEmail(ref.hostId)
}

/**
 * What a text attempt came to: `refused` names why nothing went (null when it
 * went), and `scheduledForMs` says it was held for the buyer's morning.
 */
interface SmsDelivery {
  refused: string | null
  scheduledForMs?: number
}

/**
 * Sends one order text. A receipt goes at once — the buyer is at the counter
 * or the checkout waiting for it. Every later moment (shipped, delivered,
 * refunded, canceled) can fire at any hour, from a carrier scan or a late
 * packing shift, so it asks the provider to keep quiet hours in the STORE's
 * zone: the best stand-in the platform has for a buyer whose own zone it was
 * never told, and right for the local and regional stores most texts come
 * from. Held texts arrive at 8 AM there.
 */
async function deliverSms(
  ref: OrderRef,
  to: string,
  message: ComposedMessage,
  context: string,
  quiet: { host: Record<string, unknown> } | null,
): Promise<SmsDelivery> {
  const sms = pluginSmsMessaging()
  if (!sms?.isConfigured()) return { refused: 'Text messages are not configured' }
  let timeZone: string | null = null
  if (quiet) {
    const owner = await getOrgForHost(ref.hostId).catch(() => null)
    timeZone = resolveSiteTimeZone(
      (owner?.org ?? null) as { timeZone?: string } | null,
      quiet.host as { timeZone?: string },
    )
  }
  const outcome = await sms.send({
    to,
    body: message.sms,
    hostId: ref.hostId,
    purpose: 'transactional',
    context,
    ...(timeZone ? { quietHours: { timeZone } } : {}),
  })
  if (outcome.status !== 'sent') return { refused: outcome.status }
  return {
    refused: null,
    ...(outcome.scheduledForMs ? { scheduledForMs: outcome.scheduledForMs } : {}),
  }
}

/** Absolute download links for a receipt's digital lines. */
function downloadLinksFor(
  store: StoreContext,
  ref: OrderRef,
  order: CommerceModel.HostOrder,
): Record<string, string> {
  const origin = Aglyn.hostPublicOrigin({
    cname: typeof store.host['cname'] === 'string' ? store.host['cname'] : null,
    subdomain:
      typeof store.host['subdomain'] === 'string' ? store.host['subdomain'] : null,
  })
  const digital = (order.lineItems ?? []).filter(
    (line) => line.productType === 'digital',
  )
  if (!origin || !digital.length) return {}
  let token: string
  try {
    token = mintDownloadToken(ref.hostId, ref.orderId)
  } catch {
    return {}
  }
  return Object.fromEntries(
    digital.map((line) => [
      line.productId,
      `${origin}/api/commerce/download?hostId=${encodeURIComponent(ref.hostId)}` +
        `&orderId=${encodeURIComponent(ref.orderId)}` +
        `&productId=${encodeURIComponent(line.productId)}&token=${token}`,
    ]),
  )
}

async function readOrder(
  firestore: FirebaseFirestore.Firestore,
  ref: OrderRef,
): Promise<{
  orderRef: FirebaseFirestore.DocumentReference
  order: CommerceModel.HostOrder | null
}> {
  const orderRef = firestore
    .collection('hosts')
    .doc(ref.hostId)
    .collection('orders')
    .doc(ref.orderId)
  const snapshot = await orderRef.get()
  return {
    orderRef,
    order: snapshot.exists
      ? CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
      : null,
  }
}

function emailOf(value: unknown): string {
  const email = String(value ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

/**
 * Tells the buyer about one moment in their order's life, once. See the
 * module header. Never throws.
 */
export async function notifyOrderBuyer(
  ref: OrderRef,
  event: OrderBuyerEvent,
  options: NotifyOrderBuyerOptions = {},
): Promise<NotifyOrderBuyerOutcome> {
  try {
    if (!ref.hostId || !ref.orderId) return { outcome: 'no_such_order' }
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const store = await readStore(firestore, ref.hostId)
    const toggles = store.settings['buyerNotifications']
    if (!CommerceModel.buyerNotificationEnabled(toggles, event)) {
      return { outcome: 'disabled' }
    }
    const { orderRef, order } = await readOrder(firestore, ref)
    if (!order) return { outcome: 'no_such_order' }
    const message = composeOrderBuyerMessage({
      event,
      order,
      orderId: ref.orderId,
      businessName: String(
        resolveHostToken('businessName', store.host as HostTokenSource) ?? '',
      ),
      currency: store.currency,
      statusUrl: statusLink(store, ref),
      receiptFooter: String(store.settings['receiptFooter'] ?? ''),
      downloadLinks:
        event === 'receipt' ? downloadLinksFor(store, ref, order) : undefined,
      options,
    })
    if (!message) return { outcome: 'not_applicable' }

    const email = emailOf(order.customerEmail) || emailOf(options.email)
    const phone = String(order.customerPhone ?? '').trim()
    const targets: {
      channel: CommerceModel.BuyerNotificationChannel
      to: string
    }[] = []
    if (email && isEmailConfigured()) targets.push({ channel: 'email', to: email })
    if (
      phone &&
      CommerceModel.buyerNotificationEnabled(toggles, 'texts') &&
      pluginSmsMessaging()?.isConfigured()
    ) {
      targets.push({ channel: 'sms', to: phone })
    }
    if (!targets.length) return { outcome: 'no_recipient' }

    const channels: OrderBuyerChannelOutcome[] = []
    for (const target of targets) {
      const marker = CommerceModel.buyerNotificationMarker(
        event,
        message.occurrence,
        target.channel,
      )
      const claimed = await claimMessage(
        firestore,
        orderRef,
        marker,
        target.channel,
      ).catch((error) => {
        console.error('[order-notifications] claim failed', marker, error)
        return false
      })
      if (!claimed) {
        channels.push({ channel: target.channel, outcome: 'already' })
        continue
      }
      const context = message.emailKey
      let held: number | null = null
      try {
        if (target.channel === 'email') {
          await deliverEmail(store, ref, target.to, message, context)
        } else {
          const sent = await deliverSms(
            ref,
            target.to,
            message,
            context,
            event === 'receipt' ? null : { host: store.host },
          )
          if (sent.refused) throw new Error(sent.refused)
          held = sent.scheduledForMs ?? null
        }
        await settleMessage(
          firestore,
          orderRef,
          marker,
          target.channel,
          held
            ? `${message.timelineDetail} (held for the morning)`
            : message.timelineDetail,
        )
        channels.push({ channel: target.channel, outcome: 'sent' })
      } catch (error) {
        await releaseMessage(orderRef, marker)
        console.error('[order-notifications] send failed', {
          hostId: ref.hostId,
          orderId: ref.orderId,
          event,
          channel: target.channel,
          error,
        })
        channels.push({
          channel: target.channel,
          outcome: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { outcome: 'handled', channels }
  } catch (error) {
    console.error('[order-notifications] notify failed', ref, event, error)
    return { outcome: 'handled', channels: [] }
  }
}

export type SendOrderReceiptOutcome =
  | { outcome: 'sent'; channel: CommerceModel.BuyerNotificationChannel }
  | { outcome: 'no_such_order' }
  | { outcome: 'not_configured' }
  | { outcome: 'invalid_recipient' }
  | { outcome: 'failed'; error: string }

/**
 * Sends the receipt again, on the merchant's say-so, to the address or number
 * they gave (AGL-3610) — the order dialog's "Resend receipt".
 *
 * NOT idempotent, on purpose: a resend IS the second send. The route in front
 * of it is rate-limited instead, and the send is recorded on the timeline so
 * the merchant can see it went. It does not consult the store's moment
 * switches either — a merchant who turned automatic receipts off can still
 * hand one to a customer who asks.
 */
export async function sendOrderReceipt(
  ref: OrderRef,
  input: {
    channel: CommerceModel.BuyerNotificationChannel
    to: string
    firestore?: FirebaseFirestore.Firestore
  },
): Promise<SendOrderReceiptOutcome> {
  try {
    const firestore = input.firestore ?? firebaseAdmin.app().firestore()
    const { orderRef, order } = await readOrder(firestore, ref)
    if (!order) return { outcome: 'no_such_order' }
    if (input.channel === 'email') {
      if (!isEmailConfigured()) return { outcome: 'not_configured' }
      if (!emailOf(input.to)) return { outcome: 'invalid_recipient' }
    } else {
      if (!pluginSmsMessaging()?.isConfigured()) {
        return { outcome: 'not_configured' }
      }
      if (!Aglyn.normalizePhone(input.to)) {
        return { outcome: 'invalid_recipient' }
      }
    }
    const store = await readStore(firestore, ref.hostId)
    const message = composeOrderBuyerMessage({
      event: 'receipt',
      order,
      orderId: ref.orderId,
      businessName: String(
        resolveHostToken('businessName', store.host as HostTokenSource) ?? '',
      ),
      currency: store.currency,
      statusUrl: statusLink(store, ref),
      receiptFooter: String(store.settings['receiptFooter'] ?? ''),
      downloadLinks: downloadLinksFor(store, ref, order),
    })
    if (!message) return { outcome: 'failed', error: 'Nothing to send' }
    if (input.channel === 'email') {
      await deliverEmail(store, ref, emailOf(input.to), message, 'order-receipt')
    } else {
      const sent = await deliverSms(ref, input.to, message, 'order-receipt', null)
      if (sent.refused) return { outcome: 'failed', error: sent.refused }
    }
    await settleMessage(firestore, orderRef, null, input.channel, 'Receipt re-sent')
    return { outcome: 'sent', channel: input.channel }
  } catch (error) {
    console.error('[order-notifications] receipt send failed', ref, error)
    return {
      outcome: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * What the online receipt sends needs from this module (AGL-3610): whether
 * the store left receipts on, and the `order.number` / `order.statusUrl`
 * tokens. The cart and buy-now receipts compose their own summary (license
 * keys and download links built from the Stripe session) inside the
 * webhook's redelivery guard, so they ask here rather than route through
 * {@link notifyOrderBuyer}.
 */
export async function onlineReceiptExtras(
  hostId: string,
  orderId: string,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<{ enabled: boolean; tokens: Record<string, string> }> {
  try {
    const store = await readStore(firestore, hostId)
    const { order } = await readOrder(firestore, { hostId, orderId })
    return {
      enabled: CommerceModel.buyerNotificationEnabled(
        store.settings['buyerNotifications'],
        'receipt',
      ),
      tokens: {
        'order.number': CommerceModel.formatOrderNumber(order ?? {}, orderId),
        'order.statusUrl': statusLink(store, { hostId, orderId }),
      },
    }
  } catch (error) {
    console.error('[order-notifications] receipt extras failed', error)
    return { enabled: true, tokens: { 'order.number': '', 'order.statusUrl': '' } }
  }
}
