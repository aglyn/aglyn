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
import type { PluginJobHostGate } from '@aglyn/aglyn/server'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  resolveHostToken,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import {
  loadHostEmailWithTokens,
  renderLoadedHostEmailWithTokens,
  type LoadedHostEmailWithTokens,
} from '@aglyn/tenant-data-admin/server/host-email-tokens'
import {
  isDeferrableSendResult,
  sendEmail,
  sendFailureReason,
} from '@aglyn/shared-util-email'
import * as CommerceModel from '../model'
import { stageReviewTokens } from './review-tokens'

/**
 * The review-request email (AGL-3736).
 *
 * ## When
 *
 * N days (3–30, default 7, per store) after an order is fulfilled. Every door
 * that ships or delivers an order already raises `order.fulfilled` or
 * `order.delivered` (AGL-3611), and an order with nothing to ship raises
 * `order.paid`, so commerce subscribes to its own events and SCHEDULES the
 * request by stamping the order: `reviewRequestDueAtMs` at the earliest
 * possible moment (fulfilment + 3 days) and `reviewRequest.state:
 * 'scheduled'`. The hourly sweep reads the store's CURRENT delay when the
 * stamp comes due and pushes it out if the store asked for longer, so a
 * setting changed after fulfilment still applies.
 *
 * ## Once
 *
 * `reviewRequestDueAtMs` exists only while a request is owed — it is the
 * field the collection-group sweep queries, so a sent or skipped order costs
 * the sweep nothing. Scheduling refuses an order that already has a
 * `reviewRequest`, and the send CLAIMS the order in a transaction that deletes
 * the due field before anything is mailed: two overlapping sweeps cannot both
 * send, and a redelivered event cannot schedule twice.
 *
 * ## What it respects
 *
 * Sent through the marketing seam (no stream), so the suppression lists, the
 * site's unsubscribe link and header, and the per-person frequency ceiling
 * all apply; a frequency or hourly refusal is retried an hour later. A line
 * refunded by name, and a refunded or cancelled order, are never asked about.
 * Register sales and marketplace orders are never asked. The store turns it
 * off on its review settings, and words it under Emails (`review-request`).
 */

export const REVIEW_REQUEST_EMAIL_KEY = 'review-request'

/** How far a deferred send is pushed. */
const RETRY_AFTER_MS = 60 * 60 * 1000

/** What a stamped order carries. */
export interface OrderReviewRequest {
  state: 'scheduled' | 'sending' | 'sent' | 'skipped'
  fulfilledAtMs: number
  atMs?: number
  reason?: string
  productIds?: string[]
}

function ordersRef(firestore: FirebaseFirestore.Firestore, hostId: string) {
  return firestore.collection('hosts').doc(hostId).collection('orders')
}

/**
 * Schedules one order's request, once. Returns whether this call scheduled it.
 */
export async function scheduleReviewRequest(
  input: { hostId: string; orderId: string; fulfilledAtMs: number; onlyIfNothingShips?: boolean },
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<boolean> {
  if (!input.hostId || !input.orderId) return false
  const orderRef = ordersRef(firestore, input.hostId).doc(input.orderId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists) return false
    const data = snapshot.data() ?? {}
    if (data['reviewRequest'] || data['reviewRequestDueAtMs']) return false
    const order = CommerceModel.liftLegacyOrder(data as never)
    if (!CommerceModel.orderTakesReviewRequest(order)) return false
    // `order.paid` schedules only an order with nothing to ship; a shipped
    // order waits for its shipment.
    if (
      input.onlyIfNothingShips &&
      (order.lineItems ?? []).some((line) => CommerceModel.lineRequiresShipping(line))
    ) {
      return false
    }
    const request: OrderReviewRequest = {
      state: 'scheduled',
      fulfilledAtMs: input.fulfilledAtMs,
    }
    transaction.update(orderRef, {
      reviewRequest: request,
      reviewRequestDueAtMs: CommerceModel.reviewRequestEarliestDueAtMs(input.fulfilledAtMs),
    })
    return true
  })
}

/** The `order.fulfilled` / `order.delivered` / `order.paid` subscriber. */
export async function scheduleReviewRequestFromEvent(
  envelope: Pick<PluginDomainEventEnvelope, 'event' | 'hostId' | 'occurredAtMs' | 'payload'>,
  firestore?: FirebaseFirestore.Firestore,
): Promise<void> {
  const order = ((envelope.payload ?? {}) as { order?: { id?: string } }).order
  const orderId = String(order?.id ?? '')
  if (!orderId) return
  await scheduleReviewRequest(
    {
      hostId: envelope.hostId,
      orderId,
      fulfilledAtMs: Number(envelope.occurredAtMs) || Date.now(),
      onlyIfNothingShips: envelope.event === 'order.paid',
    },
    firestore,
  )
}

/** One reviewable product as the email lists it. */
export interface ReviewRequestLine {
  productId: string
  name: string
  url: string
}

/** The email's words. Pure. */
export function composeReviewRequest(input: {
  businessName: string
  orderNumber: string
  lines: ReviewRequestLine[]
}): { subject: string; text: string; tokens: Record<string, string> } {
  const store = input.businessName || 'the store'
  const list = input.lines.map((line) => `${line.name}: ${line.url}`).join('\n')
  const first = input.lines[0]
  return {
    subject:
      input.lines.length === 1 && first
        ? `How is your ${first.name}?`
        : `How was your order from ${store}?`,
    text:
      `Thanks again for your order ${input.orderNumber} from ${store}. ` +
      'Would you tell other shoppers what you think? Each link opens the ' +
      `product page with a review form, and works once, for 60 days.\n\n${list}`,
    tokens: {
      'order.number': input.orderNumber,
      'review.products': list,
      'review.url': first?.url ?? '',
      'review.productName': first?.name ?? '',
    },
  }
}

export interface ReviewRequestScanResult {
  scanned: number
  sent: number
  skipped: number
  deferred: number
  skippedLocked: number
}

interface HostContext {
  entitled: boolean
  settings: CommerceModel.ReviewSettings
  hasProductPage: boolean
  origin: string
  businessName: string
  fromName?: string
  consentGroup: Aglyn.ConsentGroup
  template: LoadedHostEmailWithTokens | null | undefined
}

/**
 * One pass over the requests that have come due. Bounded (100) and
 * idempotent; registered on the hourly plugin-job beat in `server.ts`.
 */
export async function scanReviewRequests(
  gate: PluginJobHostGate,
  options: { firestore?: FirebaseFirestore.Firestore; nowMs?: number } = {},
): Promise<ReviewRequestScanResult> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const now = options.nowMs ?? Date.now()
  const due = await firestore
    .collectionGroup('orders')
    .where('reviewRequestDueAtMs', '<=', now)
    .orderBy('reviewRequestDueAtMs', 'asc')
    .limit(100)
    .get()
  const result: ReviewRequestScanResult = {
    scanned: due.size,
    sent: 0,
    skipped: 0,
    deferred: 0,
    skippedLocked: 0,
  }
  const hosts = new Map<string, HostContext>()
  const identityByHost = new Map<string, Awaited<ReturnType<typeof hostSendingIdentity>>>()

  for (const docSnapshot of due.docs) {
    const hostId = docSnapshot.ref.parent.parent?.id
    if (!hostId) continue
    // Lockdown first: everything below writes for this host. Skipped, not
    // dropped — the due stamp stays, so the first beat after the lift sends.
    if (await gate.isLocked(hostId)) {
      result.skippedLocked += 1
      continue
    }
    const host = hosts.get(hostId) ?? (await readHostContext(firestore, hostId))
    hosts.set(hostId, host)
    const data = docSnapshot.data() ?? {}
    const order = CommerceModel.liftLegacyOrder(data as never)
    const request = (data['reviewRequest'] ?? {}) as Partial<OrderReviewRequest>
    const fulfilledAtMs = Number(request.fulfilledAtMs) || Number(data['reviewRequestDueAtMs']) || now

    const finish = async (state: 'skipped', reason: string) => {
      await docSnapshot.ref
        .update({
          reviewRequestDueAtMs: firebaseAdmin.firestore.FieldValue.delete(),
          reviewRequest: { ...request, fulfilledAtMs, state, reason, atMs: now },
        })
        .catch(() => undefined)
      result.skipped += 1
    }

    if (!host.entitled) {
      await finish('skipped', 'not_entitled')
      continue
    }
    if (!host.settings.requestEmail) {
      await finish('skipped', 'disabled')
      continue
    }
    const dueAtMs = CommerceModel.reviewRequestDueAtMs(fulfilledAtMs, host.settings.requestDelayDays)
    if (dueAtMs > now) {
      // The store asks for more days than the earliest stamp: wait.
      await docSnapshot.ref.update({ reviewRequestDueAtMs: dueAtMs }).catch(() => undefined)
      continue
    }
    if (!CommerceModel.orderTakesReviewRequest(order)) {
      await finish('skipped', 'not_applicable')
      continue
    }
    const email = String(order.customerEmail ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await finish('skipped', 'no_email')
      continue
    }
    if (!host.hasProductPage || !host.origin) {
      await finish('skipped', 'no_product_page')
      continue
    }
    const products = await reviewableProducts(firestore, hostId, order)
    if (!products.length) {
      await finish('skipped', 'nothing_to_review')
      continue
    }

    // CLAIM: whoever deletes the due stamp sends.
    const claimed = await firestore
      .runTransaction(async (transaction) => {
        const fresh = await transaction.get(docSnapshot.ref)
        if (!fresh.exists || !fresh.get('reviewRequestDueAtMs')) return false
        transaction.update(docSnapshot.ref, {
          reviewRequestDueAtMs: firebaseAdmin.firestore.FieldValue.delete(),
          reviewRequest: { ...request, fulfilledAtMs, state: 'sending', atMs: now },
        })
        return true
      })
      .catch(() => false)
    if (!claimed) continue

    const batch = firestore.batch()
    const tokens = stageReviewTokens(firestore, batch, {
      hostId,
      orderId: docSnapshot.id,
      email,
      productIds: products.map((product) => product.id),
      nowMs: now,
    })
    await batch.commit()
    const lines: ReviewRequestLine[] = products.map((product) => ({
      productId: product.id,
      name: product.name,
      url: `${host.origin}/products/${encodeURIComponent(product.slug)}?review=${tokens[product.id]}`,
    }))
    const message = composeReviewRequest({
      businessName: host.businessName,
      orderNumber: CommerceModel.formatOrderNumber(order, docSnapshot.id),
      lines,
    })
    if (host.template === undefined) {
      host.template = await loadHostEmailWithTokens(firestore, hostId, REVIEW_REQUEST_EMAIL_KEY).catch(
        () => null,
      )
    }
    const designed = host.template
      ? renderLoadedHostEmailWithTokens(host.template, message.tokens)
      : null
    const sent = await sendEmail({
      to: email,
      subject: designed?.subject ?? message.subject,
      text: designed?.text || message.text,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: host.fromName,
      sendingIdentity: await hostSendingIdentity(hostId, identityByHost),
      audience: 'tenant',
      context: 'review request',
      priority: 'bulk',
      // Through the marketing seam with NO stream: the suppression lists,
      // the unsubscribe link and header and the frequency ceiling apply, and
      // leaving "Promotions and offers" does not stop it.
      marketing: {
        hostId,
        siteBase: host.origin,
        consentHostIds: host.consentGroup.hostIds,
        consentAwaitsConfirmation: host.consentGroup.awaitsConfirmation,
      },
    }).catch((error) => {
      console.error('[review-requests] send failed', hostId, docSnapshot.id, error)
      return null
    })

    if (!sent || isDeferrableSendResult(sent)) {
      // Not this hour: put the stamp back. The minted links are unspent and
      // expire on their own.
      await docSnapshot.ref
        .update({
          reviewRequestDueAtMs: now + RETRY_AFTER_MS,
          reviewRequest: { ...request, fulfilledAtMs, state: 'scheduled' },
        })
        .catch(() => undefined)
      result.deferred += 1
      continue
    }
    if (sent.sent) {
      await meterHostEmail(hostId)
      await docSnapshot.ref
        .update({
          reviewRequest: {
            ...request,
            fulfilledAtMs,
            state: 'sent',
            atMs: now,
            productIds: products.map((product) => product.id),
          },
          timeline: CommerceModel.appendOrderEvent(order, 'buyer-notified', 'Review request sent by email', now),
        })
        .catch(() => undefined)
      result.sent += 1
    } else {
      await docSnapshot.ref
        .update({
          reviewRequest: {
            ...request,
            fulfilledAtMs,
            state: 'skipped',
            reason: sendFailureReason(sent) ?? 'refused',
            atMs: now,
          },
        })
        .catch(() => undefined)
      result.skipped += 1
    }
  }
  return result
}

async function readHostContext(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<HostContext> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [org, hostSnapshot, settingsSnapshot] = await Promise.all([
    getOrgForHost(hostId).catch(() => null),
    hostRef.get().catch(() => null),
    hostRef.collection('settings').doc('store').get().catch(() => null),
  ])
  const host = (hostSnapshot?.data?.() ?? {}) as Record<string, unknown>
  const settings = (settingsSnapshot?.data?.() ?? {}) as Record<string, unknown>
  const orgDoc = (org?.org as Record<string, unknown> | undefined) ?? null
  return {
    entitled: Aglyn.checkEntitlement(org?.org as never, 'productReviews'),
    settings: CommerceModel.reviewSettingsFrom(settings),
    hasProductPage: Boolean(settings['pdpScreenId']),
    origin:
      Aglyn.hostPublicOrigin({
        cname: typeof host['cname'] === 'string' ? host['cname'] : null,
        subdomain: typeof host['subdomain'] === 'string' ? host['subdomain'] : null,
      }) ?? '',
    businessName: String(resolveHostToken('businessName', host as HostTokenSource) ?? ''),
    fromName: Aglyn.resolveBrandingProfile(org?.org as never).fromName,
    consentGroup: Aglyn.consentGroupForHost(orgDoc, hostId),
    template: undefined,
  }
}

/** The order's reviewable products that are still on sale, with their slugs. */
async function reviewableProducts(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  order: CommerceModel.HostOrder,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const ids = CommerceModel.reviewableProductIds(order).slice(0, 10)
  if (!ids.length) return []
  const productsRef = firestore.collection('hosts').doc(hostId).collection('products')
  const snapshots = await firestore.getAll(...ids.map((id) => productsRef.doc(id)))
  const products: Array<{ id: string; name: string; slug: string }> = []
  for (const snapshot of snapshots) {
    const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
    if (!data || data['deletedAt'] || data['status'] !== 'active' || !data['slug']) continue
    products.push({ id: snapshot.id, name: String(data['name'] ?? 'Your item'), slug: String(data['slug']) })
  }
  return products
}
