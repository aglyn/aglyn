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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  resolveHostToken,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { verifyOrderStatusToken } from './order-status-token'
import { resolvePluginTrackingPages } from '@aglyn/aglyn/plugin-manager/plugin-tracking-pages'

/** How long the page waits for a tracking service's own page link (AGL-3635). */
export const TRACKING_PAGE_TIMEOUT_MS = 1_500

/** Status lookups one address may make per site, per ten minutes. */
export const ORDER_STATUS_LOOKUPS_PER_WINDOW = 60
export const ORDER_STATUS_WINDOW_MS = 10 * 60_000

/**
 * Adds buyer actions to the status page (AGL-3610) — the typed extension
 * point for "Request a return", which the order-processing work (AGL-3611)
 * owns. A provider sees the verified order and answers the actions that apply
 * to it (none, usually); the page draws each as a button to its `url`. Kept
 * inside commerce: returns are this plugin's, so no cross-plugin seam is
 * needed, and a provider that throws costs the page its buttons, not the page.
 */
export type OrderStatusActionsProvider = (input: {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
  /** The verified status token, for a provider building a signed follow-up link. */
  token: string
}) => CommerceModel.OrderStatusAction[] | Promise<CommerceModel.OrderStatusAction[]>

const actionProviders: OrderStatusActionsProvider[] = []

export function registerOrderStatusActions(provider: OrderStatusActionsProvider): void {
  if (!actionProviders.includes(provider)) actionProviders.push(provider)
}

/** Specs only. */
export function clearOrderStatusActions(): void {
  actionProviders.length = 0
}

async function actionsFor(
  input: Parameters<OrderStatusActionsProvider>[0],
): Promise<CommerceModel.OrderStatusAction[]> {
  const answers = await Promise.all(
    actionProviders.map(async (provider) => {
      try {
        return (await provider(input)) ?? []
      } catch (error) {
        console.error('[order-status] actions provider failed', error)
        return []
      }
    }),
  )
  return answers
    .flat()
    .filter(
      (action) =>
        action && action.id && action.label && /^(https:\/\/|\/)/.test(String(action.url)),
    )
}

/**
 * The guest order-status page's data (AGL-3610): `GET
 * /api/commerce/order-status?hostId=…&o=<orderId>&t=<token>` on the store.
 *
 * The token is the whole credential — `verifyOrderStatusToken`, constant
 * time — and a wrong one answers exactly as a missing order does (404), so
 * the route cannot be used to learn which order ids exist. Rate-limited per
 * address per site, durable, BEFORE the token check so guessing costs the
 * same as looking. The answer is `buildOrderStatusView`, an allow-listed
 * projection, never the order document; `Cache-Control: private, no-store`
 * and `X-Robots-Tag: noindex` keep it out of shared caches and search.
 *
 * Registered as a `recipientLink` route: an emailed link has to keep working
 * for the buyer it was sent to, so the per-site enablement gates do not
 * stand between them and their order.
 */
export const orderStatusHandler: PluginApiHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query.hostId ?? '')
  const orderId = String(req.query.o ?? '').slice(0, 200)
  const token = String(req.query.t ?? '').slice(0, 200)
  if (!hostId || !orderId || !token || /^__.*__$/.test(hostId) || /^__.*__$/.test(orderId) || orderId.includes('/')) {
    return res.status(400).json({ error: 'This link is incomplete.' })
  }
  const ip =
    readClientIp(req.headers, { remoteAddress: req.socket?.remoteAddress }) ??
    'no-address'
  const rate = await consumeRateLimit(`commerce-order-status:${hostId}:${ip}`, {
    limit: ORDER_STATUS_LOOKUPS_PER_WINDOW,
    windowMs: ORDER_STATUS_WINDOW_MS,
  })
  if (!rate.allowed) {
    res.setHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000))),
    )
    return res.status(429).json({ error: 'Too many lookups. Try again in a few minutes.' })
  }
  const notFound = () =>
    res.status(404).json({ error: 'We could not find that order. Check the link in your email.' })
  if (!verifyOrderStatusToken(hostId, orderId, token)) return notFound()
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, settingsSnapshot, orderSnapshot] = await Promise.all([
      hostRef.get(),
      hostRef.collection('settings').doc('store').get(),
      hostRef.collection('orders').doc(orderId).get(),
    ])
    if (!hostSnapshot.exists || !orderSnapshot.exists) return notFound()
    const order = CommerceModel.liftLegacyOrder((orderSnapshot.data() ?? {}) as never)
    const view = CommerceModel.buildOrderStatusView({
      order,
      orderId,
      storeName: String(
        resolveHostToken('businessName', hostSnapshot.data() as HostTokenSource) ?? '',
      ),
      currency: String(settingsSnapshot.get('currency') ?? 'USD'),
      number: CommerceModel.formatOrderNumber(order, orderId),
      actions: await actionsFor({ hostId, orderId, order, token }),
    })
    // A tracking service's own page for each parcel, where the merchant
    // follows them through one (AGL-3635); the carrier's link otherwise.
    const pages = await resolvePluginTrackingPages(
      view.shipments
        .filter((shipment) => shipment.trackingNumber)
        .map((shipment) => ({
          hostId,
          recordId: orderId,
          carrier: shipment.carrier,
          trackingNumber: String(shipment.trackingNumber),
        })),
      { timeoutMs: TRACKING_PAGE_TIMEOUT_MS },
    )
    for (const shipment of view.shipments) {
      const page = shipment.trackingNumber ? pages.get(shipment.trackingNumber) : undefined
      if (page) shipment.trackingUrl = page
    }
    return res.status(200).json(view)
  } catch (error) {
    console.error('orderStatus failed', error)
    return res.status(500).json({ error: 'Your order could not be loaded. Try again.' })
  }
}
