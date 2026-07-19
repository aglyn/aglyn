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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { mintDownloadToken } from './download'
import { requireActiveMember } from './membership'

export interface AccountOrderView {
  id: string
  number: string
  status: CommerceModel.OrderStatus
  totalCents: number
  createdAtMs: number
  itemsSummary: string
  tracking?: { carrier?: string; trackingNumber?: string }
}

/**
 * Member account (AGL-294): profile + address book + order history for
 * the signed-in site member (AGL-109 session cookie). Orders match by
 * the member's email — guest purchases made with the same address show
 * up too, which is what buyers expect.
 */
export const membershipAccountHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(
    (req.method === 'GET' ? req.query.hostId : req.body?.hostId) ?? '',
  )
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    // Suspension gate (AGL-546/550): the shared guard 401s stale
    // sessions and 403s suspended members with the cookie cleared, so
    // the site stops presenting a signed-in shell; the account block
    // treats any non-OK response as signed-out, the graceful path here.
    const auth = await requireActiveMember(req, res, hostId)
    if (!auth) return
    const { memberId, member: memberSnapshot } = auth
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const memberRef = hostRef.collection('siteMembers').doc(memberId)

    if (req.method === 'POST') {
      const displayName = String(req.body?.displayName ?? '').slice(0, 80)
      const addresses = Array.isArray(req.body?.addresses)
        ? (req.body.addresses as CommerceModel.OrderAddress[]).slice(0, 5).map(
            (address) => ({
              name: String(address.name ?? '').slice(0, 80),
              line1: String(address.line1 ?? '').slice(0, 120),
              line2: String(address.line2 ?? '').slice(0, 120),
              city: String(address.city ?? '').slice(0, 80),
              state: String(address.state ?? '').slice(0, 40),
              postalCode: String(address.postalCode ?? '').slice(0, 20),
              country: String(address.country ?? '').slice(0, 2).toUpperCase(),
            }),
          )
        : undefined
      await memberRef.set(
        {
          ...(displayName ? { displayName } : {}),
          ...(addresses ? { addresses } : {}),
        },
        { merge: true },
      )
    }

    const email = String(memberSnapshot.get('email') ?? '')
    const ordersSnapshot = await hostRef
      .collection('orders')
      .where('customerEmail', '==', email)
      .limit(25)
      .get()
    const orders: AccountOrderView[] = ordersSnapshot.docs
      .map((docSnapshot) => {
        const order = CommerceModel.liftLegacyOrder(docSnapshot.data() as any)
        const latestFulfillment = (order.fulfillments ?? []).slice(-1)[0]
        return {
          id: docSnapshot.id,
          number: CommerceModel.formatOrderNumber(order, docSnapshot.id),
          status: order.status,
          totalCents:
            order.totals?.totalCents ?? Number(order.amountCents ?? 0),
          createdAtMs:
            order.createdAtMs ??
            ((docSnapshot.get('createdAt')?.seconds ?? 0) * 1000 || 0),
          itemsSummary: (order.lineItems ?? [])
            .map((line) => `${line.quantity}× ${line.name}`)
            .join(', ')
            .slice(0, 140),
          ...(latestFulfillment?.trackingNumber
            ? {
                tracking: {
                  carrier: latestFulfillment.carrier,
                  trackingNumber: latestFulfillment.trackingNumber,
                },
              }
            : {}),
        }
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)

    // Digital downloads (AGL-302): tokened links for digital lines on
    // paid orders; files resolve to the product's current list.
    const downloads: Array<{
      orderId: string
      productId: string
      productName: string
      url: string
      licenseKeys?: string[]
    }> = []
    for (const docSnapshot of ordersSnapshot.docs) {
      const order = CommerceModel.liftLegacyOrder(docSnapshot.data() as any)
      if (['pending', 'cancelled', 'refunded'].includes(order.status)) continue
      const orderKeys = (docSnapshot.get('licenseKeys') ?? {}) as Record<
        string,
        string[]
      >
      for (const line of order.lineItems ?? []) {
        if (line.productType !== 'digital') continue
        downloads.push({
          orderId: docSnapshot.id,
          productId: line.productId,
          productName: line.name,
          ...(orderKeys[line.productId]?.length
            ? { licenseKeys: orderKeys[line.productId] }
            : {}),
          url:
            `/api/commerce/download?hostId=${encodeURIComponent(hostId)}` +
            `&orderId=${encodeURIComponent(docSnapshot.id)}` +
            `&productId=${encodeURIComponent(line.productId)}` +
            `&token=${mintDownloadToken(hostId, docSnapshot.id)}`,
        })
      }
    }

    // Storefront subscriptions (AGL-303) with product names resolved.
    const subscriptionsSnapshot = await hostRef
      .collection('subscriptions')
      .where('customerEmail', '==', email)
      .limit(10)
      .get()
    const subscriptions = await Promise.all(
      subscriptionsSnapshot.docs.map(async (docSnapshot) => {
        const productSnapshot = await hostRef
          .collection('products')
          .doc(String(docSnapshot.get('productId') ?? ''))
          .get()
        return {
          id: docSnapshot.id,
          productName: String(productSnapshot.get('name') ?? 'Subscription'),
          status: String(docSnapshot.get('status') ?? 'active'),
          currentPeriodEndMs: docSnapshot.get('currentPeriodEndMs') ?? null,
        }
      }),
    )

    return res.status(200).json({
      member: {
        email,
        displayName: memberSnapshot.get('displayName') ?? '',
        addresses: memberSnapshot.get('addresses') ?? [],
      },
      orders,
      downloads,
      subscriptions,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Account unavailable' })
  }
}
