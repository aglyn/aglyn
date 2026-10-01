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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type {
  MarketplaceStaffOverview,
  ReversalRecoveryRow,
  StaffPurchaseRow,
} from '../model/staff-overview'

/**
 * The marketplace's share of the staff overview (AGL-3080): recent paid
 * purchases with the platform fee, and the refund-reversal recovery queue
 * (AGL-2309). Drawn in the overview's `staffOverview` zone by this plugin's
 * widget; the overview route itself reads no marketplace collection.
 *
 * Staff-gated exactly like the overview — the `staff` custom claim, the same
 * trust anchor as the Firestore rules, which deny `marketplacePurchases` to
 * every client — and a GET with no subject, so it is a plain `web:` route
 * like the report and review queues.
 */

const PURCHASES = 'marketplacePurchases'

const millis = (value: unknown): number | null =>
  (value as { toMillis?: () => number })?.toMillis?.() ?? null

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const [purchasesSnapshot, reversalSnapshot] = await Promise.all([
      firestore
        .collection(PURCHASES)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
        // Purchases written before `createdAt` existed still list.
        .catch(() => firestore.collection(PURCHASES).limit(50).get()),
      // The recovery queue (AGL-2309). `billing-webhook.ts` stamps
      // `reversalFailedAt` / `reversalFailedReason` / `reversalOwedCents`
      // when Stripe DEFINITIVELY refuses to pull the publisher's share back
      // after a buyer refund — a 400 like `balance_insufficient`, which
      // neither throws nor redelivers — and names this clause as the queue.
      // A single-field inequality: the automatic index covers it, so no
      // composite; ordering is done below for the same reason.
      firestore.collection(PURCHASES).where('reversalFailedAt', '!=', null).limit(50).get(),
    ])

    const purchases: StaffPurchaseRow[] = purchasesSnapshot.docs.slice(0, 50).map((doc) => {
      const data = doc.data()
      return {
        $id: doc.id,
        listingId: data['listingId'] ?? null,
        buyerUid: data['buyerUid'] ?? null,
        sellerOrgId: data['sellerOrgId'] ?? null,
        amountCents: data['amountCents'] ?? 0,
        feeCents: data['feeCents'] ?? 0,
        createdAt: millis(data['createdAt']),
      }
    })

    /*
     * A staff reader recognizes a customer by name, never by document id: the
     * queue names the counterparty a staff member is about to go and collect
     * money from. One read per distinct seller on the queue — it is short by
     * nature, and capped at 50 rows.
     */
    const sellerIds = [
      ...new Set(
        reversalSnapshot.docs
          .map((doc) => doc.get('sellerOrgId'))
          .filter((id): id is string => typeof id === 'string' && Boolean(id)),
      ),
    ]
    const labels = new Map<string, string>()
    await Promise.all(
      sellerIds.map(async (orgId) => {
        const org = await firestore.collection('orgs').doc(orgId).get()
        if (!org.exists) return
        const label = String(org.get('name') || org.get('slug') || '') || orgId
        labels.set(orgId, label)
      }),
    )

    /*
     * `owedCents` is projected from the document rather than recomputed: the
     * webhook knew what it failed to reverse at the moment of the refusal, and
     * the ledger cannot re-derive it afterwards, because `sentToStripeCents`
     * deliberately subtracts only the reversal that ACTUALLY happened. Zero
     * for a refusal whose amount was unknown — the `no-charge-on-cause` and
     * `no-transfer` branches settle without one — and those rows still belong
     * on the queue, because the reason is the actionable part.
     */
    const reversalRecovery: ReversalRecoveryRow[] = reversalSnapshot.docs
      .map((doc) => {
        const data = doc.data()
        const sellerOrgId = data['sellerOrgId'] ? String(data['sellerOrgId']) : null
        return {
          $id: doc.id,
          listingId: data['listingId'] ?? null,
          sellerOrgId,
          sellerOrgLabel: sellerOrgId ? (labels.get(sellerOrgId) ?? null) : null,
          buyerUid: data['buyerUid'] ?? null,
          owedCents: Number(data['reversalOwedCents'] ?? 0),
          reason: data['reversalFailedReason'] ?? null,
          cause: data['reversalFailedCause'] ?? null,
          failedAt: millis(data['reversalFailedAt']),
        }
      })
      .sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))

    const body: MarketplaceStaffOverview = {
      purchases,
      reversalRecovery,
      reversalOwedCents: reversalRecovery.reduce((total, row) => total + row.owedCents, 0),
    }
    return Response.json(body)
  } catch (error) {
    const refused = invalidIdTokenResponse(error)
    if (refused) return refused
    console.error('[marketplace] staff overview failed', error)
    return Response.json({ error: 'Overview failed' }, { status: 500 })
  }
}

export { handler as marketplaceAdminOverview }
