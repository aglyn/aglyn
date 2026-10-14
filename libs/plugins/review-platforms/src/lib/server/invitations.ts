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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type {
  PluginOrderEmailCopy,
  PluginOrderEmailCopyRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-order-email-copies'
import { REVIEW_PLATFORMS_COLLECTIONS, type ReviewPlatform } from '../constants/bundle-common'
import {
  BCC_MOMENTS,
  invitationOrderRefusal,
  type InvitationOrder,
  type InvitationSkipReason,
  type InvitationView,
  type ReviewPlatformsOrderView,
} from '../model/review-platforms-settings'
import { ReviewPlatformError } from '../providers/http'
import { createTrustpilotInvitation, trustpilotBccDataBlock } from '../providers/trustpilot'
import { sendYotpoOrder, type YotpoOrderLine } from '../providers/yotpo'
import { readReviewPlatformsConfig, type ReviewPlatformsConfig } from './config'
import { buyerMayBeInvited } from './consent'
import { orgRef, reviewPlatformsDb } from './db'
import {
  openTrustpilotApi,
  openYotpo,
  readStoredSettings,
  trustpilotBcc,
  type StoredReviewPlatformsSettings,
} from './settings-store'
import { resolveReviewPlatformsSite } from './site-context'

/**
 * ONE INVITATION PER ORDER, PER SERVICE (AGL-3699).
 *
 * Three doors lead here, and each asks a service to invite one order's
 * buyer to review the store:
 *
 * - Trustpilot BCC: commerce asks core's `core.order-email-copies` seam just
 *   before it sends a buyer email about an order; on the moment the
 *   merchant chose, this answers with the store's Trustpilot invitation
 *   address as a blind copy and the data block Trustpilot reads.
 * - Trustpilot API: `order.fulfilled` (or `order.delivered`, as chosen)
 *   creates an email invitation with the merchant's own key.
 * - Yotpo: `order.fulfilled` sends the order with a successful fulfillment,
 *   so Yotpo sends its review request after the merchant's Yotpo delay.
 *
 * Each is refused for a test-mode, canceled or refunded order, one with no
 * address, and a buyer the site may not market to (`consent.ts`). Each is
 * CLAIMED in a transaction on
 * `orgs/{orgId}/reviewPlatformsInvitations/{hostId}__{recordId}` before
 * anything leaves, so repeated events, a second shipment and an email sent
 * twice invite once. A claim is never taken again once sent; a refusal a
 * retry will not change is recorded and final; any other failure is marked
 * retryable and, for an event, thrown so the bus retries it. A process that
 * dies between a Trustpilot claim and the call leaves it `sending` — at most
 * once, never twice, the side to fail on for mail a buyer did not ask for.
 * Yotpo answers 409 for an order it has, so a stale Yotpo claim is retaken.
 */

export interface StoredInvitationEntry {
  status: InvitationView['status']
  via: 'bcc' | 'api' | null
  atMs: number
  reason?: InvitationSkipReason | null
  error?: string | null
}

export interface StoredInvitations {
  orgId: string
  hostId: string
  recordId: string
  trustpilot?: StoredInvitationEntry
  yotpo?: StoredInvitationEntry
}

export interface OrderEventPayload {
  order: InvitationOrder
}
export interface OrderFulfilledPayload extends OrderEventPayload {
  fulfillment?: { id?: string | null; at?: string | null }
}

/** How long a claim blocks a second delivery before a Yotpo claim is retaken. */
const CLAIM_STALE_MS = 2 * 60 * 1000

/** Marks a failure a later attempt may retry. */
const RETRY = 'retry: '

export function invitationKey(hostId: string, recordId: string): string {
  return `${hostId}__${recordId}`
}

export function invitationRef(orgId: string, hostId: string, recordId: string) {
  return orgRef(orgId).collection(REVIEW_PLATFORMS_COLLECTIONS.invitations).doc(invitationKey(hostId, recordId))
}

interface Context {
  orgId: string
  hostId: string
  org: Record<string, unknown>
  config: ReviewPlatformsConfig
  stored: StoredReviewPlatformsSettings
}

async function contextFor(hostId: string): Promise<Context | null> {
  const site = await resolveReviewPlatformsSite(hostId)
  if (!site) return null
  return {
    orgId: site.orgId,
    hostId,
    org: site.org,
    config: readReviewPlatformsConfig(),
    stored: await readStoredSettings(site.orgId, hostId),
  }
}

type Claim = 'claimed' | 'done' | 'busy'

/** Takes the order's claim for `platform`, in a transaction. */
async function claim(context: Context, recordId: string, platform: ReviewPlatform, via: 'bcc' | 'api'): Promise<Claim> {
  const ref = invitationRef(context.orgId, context.hostId, recordId)
  const nowMs = Date.now()
  return reviewPlatformsDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const entry = (snapshot.data() as StoredInvitations | undefined)?.[platform]
    if (entry?.status === 'sent') return 'done'
    if (entry?.status === 'failed' && !String(entry.error ?? '').startsWith(RETRY)) return 'done'
    if (entry?.status === 'sending') {
      const stale = nowMs - Number(entry.atMs ?? 0) >= CLAIM_STALE_MS
      if (platform !== 'yotpo' || !stale) return stale ? 'done' : 'busy'
    }
    transaction.set(
      ref,
      {
        orgId: context.orgId,
        hostId: context.hostId,
        recordId,
        [platform]: { status: 'sending', via, atMs: nowMs, reason: null, error: null },
      },
      { merge: true },
    )
    return 'claimed'
  })
}

async function settle(context: Context, recordId: string, platform: ReviewPlatform, entry: StoredInvitationEntry): Promise<void> {
  await invitationRef(context.orgId, context.hostId, recordId).set(
    { orgId: context.orgId, hostId: context.hostId, recordId, [platform]: entry },
    { merge: true },
  )
}

/** Records why an order was not invited — unless an invitation already went or is going. */
async function recordSkip(context: Context, recordId: string, platform: ReviewPlatform, reason: InvitationSkipReason): Promise<void> {
  const ref = invitationRef(context.orgId, context.hostId, recordId)
  await reviewPlatformsDb().runTransaction(async (transaction) => {
    const entry = ((await transaction.get(ref)).data() as StoredInvitations | undefined)?.[platform]
    if (entry && entry.status !== 'skipped') return
    transaction.set(
      ref,
      {
        orgId: context.orgId,
        hostId: context.hostId,
        recordId,
        [platform]: { status: 'skipped', via: null, atMs: Date.now(), reason, error: null },
      },
      { merge: true },
    )
  })
}

/**
 * Why this order's buyer may not be invited, or `null`. Consent is read
 * last, and a list that cannot be read throws.
 */
async function refusal(context: Context, order: InvitationOrder, email: string): Promise<InvitationSkipReason | null> {
  const onOrder = invitationOrderRefusal(order)
  if (onOrder) return onOrder
  const allowed = await buyerMayBeInvited({ hostId: context.hostId, orgId: context.orgId, org: context.org, email })
  return allowed ? null : 'no_consent'
}

function refusalText(error: unknown): string {
  if (error instanceof ReviewPlatformError) {
    return error.status ? `${error.vendor} refused it (${error.status}).` : `${error.message}.`
  }
  return 'The service refused it.'
}

const isPermanent = (error: unknown) => error instanceof ReviewPlatformError && error.permanent

function buyerName(order: InvitationOrder, email: string): string {
  const name = String(order.customerName ?? '').trim()
  return name || email.split('@')[0]
}

function referenceOf(order: InvitationOrder): string {
  return order.number ? String(order.number) : order.id
}

/**
 * The Trustpilot BCC copy for one buyer email, or `null`. Registered on
 * core's order-email copies seam. Never throws into the seller: a list that
 * cannot be read adds no copy.
 */
export async function trustpilotEmailCopy(request: PluginOrderEmailCopyRequest): Promise<PluginOrderEmailCopy | null> {
  const context = await contextFor(request.hostId)
  if (!context) return null
  const bcc = trustpilotBcc(context.stored, context.config)
  if (!bcc || !BCC_MOMENTS[bcc.sendOn].includes(request.moment)) return null
  const order = { ...(request.order as unknown as InvitationOrder), id: request.recordId }
  const email = String(request.recipient ?? '').trim()
  let reason: InvitationSkipReason | null
  try {
    reason = await refusal(context, { ...order, customerEmail: email }, email)
  } catch (error) {
    console.error(`[review-platforms] consent could not be read for ${request.hostId}/${request.recordId}`, error)
    return null
  }
  if (reason) {
    await recordSkip(context, request.recordId, 'trustpilot', reason)
    return null
  }
  if ((await claim(context, request.recordId, 'trustpilot', 'bcc')) !== 'claimed') return null
  return {
    bcc: [bcc.address],
    dataBlocks: [trustpilotBccDataBlock({ name: buyerName(order, email), email, referenceId: referenceOf(order) })],
    settle: async (sent) => {
      await settle(context, request.recordId, 'trustpilot', {
        status: sent ? 'sent' : 'failed',
        via: 'bcc',
        atMs: Date.now(),
        reason: null,
        // An email that did not leave carried no copy: the next one may.
        error: sent ? null : `${RETRY}The order email did not send.`,
      })
    },
  }
}

/**
 * `order.fulfilled` / `order.delivered` → a Trustpilot invitation through
 * the merchant's own API key, on the moment the merchant chose.
 */
export async function inviteThroughTrustpilotApi(envelope: PluginDomainEventEnvelope<OrderEventPayload>): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const api = openTrustpilotApi(context.stored, context.config)
  if (!api) return
  const wanted = api.sendOn === 'delivered' ? 'order.delivered' : 'order.fulfilled'
  if (envelope.event !== wanted) return
  const email = String(order.customerEmail ?? '').trim()
  const reason = await refusal(context, order, email)
  if (reason) {
    await recordSkip(context, order.id, 'trustpilot', reason)
    return
  }
  if ((await claim(context, order.id, 'trustpilot', 'api')) !== 'claimed') return
  try {
    await createTrustpilotInvitation(
      { apiKey: api.apiKey, apiSecret: api.apiSecret, fetchImpl: context.config.fetchImpl },
      {
        businessUnitId: api.businessUnitId,
        businessUserId: api.businessUserId,
        consumerEmail: email,
        consumerName: buyerName(order, email),
        referenceNumber: referenceOf(order),
        locale: api.locale,
        templateId: api.templateId,
        senderName: null,
      },
    )
  } catch (error) {
    const permanent = isPermanent(error)
    await settle(context, order.id, 'trustpilot', {
      status: 'failed',
      via: 'api',
      atMs: Date.now(),
      reason: null,
      error: permanent ? refusalText(error) : `${RETRY}${refusalText(error)}`,
    })
    if (permanent) return
    throw error
  }
  await settle(context, order.id, 'trustpilot', { status: 'sent', via: 'api', atMs: Date.now(), reason: null, error: null })
}

function yotpoLines(order: InvitationOrder): YotpoOrderLine[] {
  const raw = Array.isArray(order.lineItems) ? (order.lineItems as Array<Record<string, unknown>>) : []
  return raw
    .map((line) => ({
      productId: String(line?.['productId'] ?? '').trim(),
      name: String(line?.['name'] ?? 'Item'),
      sku: typeof line?.['sku'] === 'string' && line['sku'] ? (line['sku'] as string) : null,
      quantity: Math.max(0, Math.round(Number(line?.['quantity']) || 0)),
      unitCents: Math.max(0, Math.round(Number(line?.['unitAmountCents']) || 0)),
    }))
    .filter((line) => line.productId && line.quantity > 0)
}

function isoOf(value: unknown, fallbackMs: number): string {
  const parsed = Date.parse(String(value ?? ''))
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString()
}

/** `order.fulfilled` → Yotpo has the order, fulfilled, and asks its buyer for a review. */
export async function sendOrderToYotpo(envelope: PluginDomainEventEnvelope<OrderFulfilledPayload>): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const yotpo = openYotpo(context.stored, context.config)
  if (!yotpo) return
  const email = String(order.customerEmail ?? '').trim()
  const reason = await refusal(context, order, email)
  if (reason) {
    await recordSkip(context, order.id, 'yotpo', reason)
    return
  }
  const lines = yotpoLines(order)
  if (!lines.length) return
  if ((await claim(context, order.id, 'yotpo', 'api')) !== 'claimed') return
  const [first, ...rest] = buyerName(order, email).split(/\s+/)
  const fulfillment = envelope.payload?.fulfillment
  try {
    await sendYotpoOrder(
      { appKey: yotpo.appKey, secretKey: yotpo.secretKey, fetchImpl: context.config.fetchImpl },
      {
        externalId: order.id,
        orderDateIso: isoOf(order.created, envelope.occurredAtMs),
        currency: String(order.currency || 'usd'),
        totalCents: Number(order.totals?.totalCents ?? 0) || 0,
        customer: { email, firstName: first, lastName: rest.join(' ') || first },
        lines,
        fulfillment: {
          externalId: String(fulfillment?.id || `${order.id}-fulfillment`),
          dateIso: isoOf(fulfillment?.at, envelope.occurredAtMs),
        },
      },
    )
  } catch (error) {
    const permanent = isPermanent(error)
    await settle(context, order.id, 'yotpo', {
      status: 'failed',
      via: 'api',
      atMs: Date.now(),
      reason: null,
      error: permanent ? refusalText(error) : `${RETRY}${refusalText(error)}`,
    })
    if (permanent) return
    throw error
  }
  await settle(context, order.id, 'yotpo', { status: 'sent', via: 'api', atMs: Date.now(), reason: null, error: null })
}

function entryView(entry: StoredInvitationEntry | undefined): InvitationView | null {
  if (!entry) return null
  return {
    status: entry.status,
    via: entry.via ?? null,
    atMs: Number(entry.atMs) || 0,
    reason: entry.reason ?? null,
    error: entry.error ? String(entry.error).replace(/^retry: /, '') : null,
  }
}

/** The order widget's view of one order. */
export function toOrderView(state: StoredInvitations | undefined): ReviewPlatformsOrderView {
  return { trustpilot: entryView(state?.trustpilot), yotpo: entryView(state?.yotpo) }
}
