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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { readActiveMemberSession, setMemberCookie } from './membership'

/** Subscription statuses that grant access (trialing pays later). */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

/**
 * Is the HOST's org on a plan that includes the content paywall (AGL-481)?
 * `contentGating` is a Business+ feature, but the member paywall used to be
 * enforced on the visitor's purchase alone — so any plan (or a lapsed
 * Business org) could run members-only content. This gates the feature at
 * the org level; a plan-less/lapsed org resolves as `free` and fails
 * closed (gated content is refused, never served open). Re-resolved per
 * request, so a downgrade takes effect within the revalidate window.
 */
export async function hostHasContentGating(hostId: string): Promise<boolean> {
  const org = (await getOrgForHost(hostId))?.org
  return Aglyn.checkEntitlement(org as any, 'contentGating')
}

/**
 * Entitlement check (AGL-309): is the signed-in member entitled to
 * gated content? Entitled = a paid (non-refunded) order containing the
 * product, or a live subscription to it ('any' matches any live
 * subscription). Server-enforced — the gated media endpoints (video
 * AGL-315, downloads AGL-302) call the same logic.
 */
export async function checkMemberEntitlement(
  hostId: string,
  memberEmail: string,
  productId: string | 'any',
): Promise<boolean> {
  // Org-level gate (AGL-481): the paywall feature itself is Business+. If
  // the host's plan doesn't include it, no visitor is "entitled" — fail
  // closed rather than serve gated content on a plan that didn't pay for
  // gating.
  if (!(await hostHasContentGating(hostId))) return false
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const subscriptions = await hostRef
    .collection('subscriptions')
    .where('customerEmail', '==', memberEmail)
    .limit(10)
    .get()
  for (const docSnapshot of subscriptions.docs) {
    if (!LIVE_STATUSES.has(String(docSnapshot.get('status')))) continue
    if (productId === 'any' || docSnapshot.get('productId') === productId) {
      return true
    }
  }
  if (productId === 'any') return false
  const orders = await hostRef
    .collection('orders')
    .where('customerEmail', '==', memberEmail)
    .limit(50)
    .get()
  for (const docSnapshot of orders.docs) {
    const order = CommerceModel.liftLegacyOrder(docSnapshot.data() as any)
    if (['pending', 'cancelled', 'refunded'].includes(order.status)) continue
    const owns =
      (order.lineItems ?? []).some((line) => line.productId === productId) ||
      order.productId === productId
    if (owns) return true
  }
  return false
}

export const gateHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const productId = String(req.query.productId ?? 'any')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  try {
    // This probe answers 200 either way, so the suspension gate
    // (AGL-546/550) maps a suspended member to the signed-out shape —
    // never entitled — and drops the stale cookie so the signed-in
    // shell unwinds on the next paint.
    const session = await readActiveMemberSession(req, hostId)
    if (session.status !== 'active') {
      if (session.status === 'suspended') setMemberCookie(res, hostId, null)
      return res.status(200).json({ entitled: false, signedIn: false })
    }
    const email = String(session.member.get('email') ?? '')
    if (!email) {
      return res.status(200).json({ entitled: false, signedIn: false })
    }
    const entitled = await checkMemberEntitlement(hostId, email, productId)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ entitled, signedIn: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Check failed' })
  }
}
