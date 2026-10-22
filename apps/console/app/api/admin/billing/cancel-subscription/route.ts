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
  notifyRiskEvent,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import {
  isSubscriptionCancelWhen,
  normalizeSubscriptionCancelReason,
} from '../../../../../constants/subscription-cancel'
import {
  auditOrgSubscriptionCancel,
  cancellationComment,
  cancelOrgSubscriptions,
  findOrgSubscriptions,
  isCancelableOrgId,
} from '../../../../../utils/server/org-subscription-cancel'

/**
 * Staff cancellation of a workspace's subscriptions (AGL-3359).
 *
 *   GET  ?orgId=…                          → every subscription Stripe holds
 *                                            for the workspace (any staff role)
 *   POST { orgId, when, reason, note? }    → cancel them (super only)
 *
 * `when` is `now` (deleted immediately, `invoice_now=false`, `prorate=false`)
 * or `period_end` (`cancel_at_period_end=true`). Neither refunds anything.
 * The reason lands in Stripe's `cancellation_details.comment` and on an
 * `adminAudit` row, and the answer is a fresh read-back of each subscription
 * with `confirmed` stating whether it matches the intent — the lockdown
 * route's post-condition pattern (AGL-1571).
 *
 * Idempotent: a subscription that is already over, or already ending at the
 * period end when that is asked, is reported and not written again.
 *
 * Super-only for the same reason locking is: a cancellation ends a paying
 * customer's plan, and lifting a lock does not bring it back. The helper is
 * shared with `/api/admin/lockdown`, which calls it after a lock when asked.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, query, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // The lockdown route's bar, and its fail-closed default (AGL-495): a
    // token without the claim is the least-privileged role.
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (method === 'POST' && actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }

    const orgId = String(
      (method === 'GET' ? (query as any)?.orgId : body?.orgId) ?? '',
    ).trim()
    if (!isCancelableOrgId(orgId)) {
      return Response.json({ error: 'Missing or malformed orgId' }, { status: 400 })
    }

    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      // 501: "billing is not wired up here" is not "the cancel failed".
      return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const org = await firestore.collection('orgs').doc(orgId).get()
    if (!org.exists) {
      return Response.json({ error: 'No such workspace' }, { status: 404 })
    }

    if (method === 'GET') {
      const found = await findOrgSubscriptions({ orgId, secretKey })
      return Response.json(
        { orgId, configured: true, ...found, readAtMs: Date.now() },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const when = body?.when
    if (!isSubscriptionCancelWhen(when)) {
      return Response.json(
        { error: "when must be 'now' or 'period_end'" },
        { status: 400 },
      )
    }
    // Refused before Stripe is touched: the reason is what the audit row and
    // Stripe's own record are worth, and neither can be amended afterwards.
    const reason = normalizeSubscriptionCancelReason(body?.reason, body?.note)
    if (!reason) {
      return Response.json(
        {
          error:
            'Pick a reason for the cancellation. "Other" also needs a note ' +
            'saying what.',
        },
        { status: 400 },
      )
    }

    const result = await cancelOrgSubscriptions({
      orgId,
      when,
      secretKey,
      comment: cancellationComment({
        reason: reason.reason,
        note: reason.note,
        actorUid: decoded.uid,
        via: 'staff-console',
      }),
    })
    await auditOrgSubscriptionCancel(firestore, {
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
      reason: reason.reason,
      note: reason.note || null,
      via: 'staff-console',
      result,
    })
    // The owners and admins are told (AGL-3368), from the platform's sender:
    // what changes, and how to reach support. Never the reason or the note,
    // which are staff's record. Only when something was actually canceled.
    const ownerNotice =
      result.changed > 0
        ? await notifyRiskEvent({
            kind: 'subscription-canceled',
            orgId,
            item: { label: 'your subscription', path: '/org/billing' },
            lock: {
              // A canceled workspace is on the Free plan (the billing
              // webhook mirrors `plan: 'free'`): nothing is deleted.
              affected:
                when === 'now'
                  ? 'The subscription ended now, with no refund, and the workspace is on the Free plan. Your sites and data stay; paid features stop.'
                  : 'The subscription stays active until the end of the current billing period, with no refund. Then the workspace moves to the Free plan: your sites and data stay, and paid features stop.',
            },
          })
        : null
    return Response.json(
      {
        ok: true,
        ...result,
        ownerNotice: ownerNotice
          ? {
              recipients: ownerNotice.owners.recipients,
              emailed: ownerNotice.owners.emailed,
              emailFailed: ownerNotice.owners.emailFailed,
              error: ownerNotice.error,
            }
          : null,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/billing/cancel-subscription] failed', error)
    return Response.json(
      { error: 'Subscription cancellation failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
