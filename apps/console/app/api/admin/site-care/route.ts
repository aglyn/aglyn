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

import { isSiteCareMonthKey, pluginRequestFromWeb, siteCareMonthKey } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  addSiteCareGoodwill,
  closeSiteCareRequest,
  correctSiteCareMinutes,
  moveSiteCareRequest,
  orgHasSiteCare,
  readSiteCareMonth,
  readSiteCareOrg,
  readSiteCareRequestPanel,
  recordSiteCareApproval,
  retrySiteCareCharge,
  reverseSiteCareCharge,
  SiteCareError,
  sendSiteCareQuote,
  sendSiteCareStatement,
  startSiteCareTimer,
} from '@aglyn/tenant-data-admin/server/site-care-requests'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * SITE CARE, THE STAFF SIDE (AGL-3959). Staff only.
 *
 * GET `?ticketId` is one request's panel on the support thread: the timer,
 * the prefilled close number, the approval, the charge and the append-only
 * history. GET `?orgId&month` is the workspace's month on its staff page:
 * every request with its minutes, billing, approvals, charges, corrections
 * and emails, and the totals.
 *
 * POST `{ action }` is every change staff make, each one an append-only
 * history row and an `adminAudit` row in the same write:
 *   start          — open the request to work on it; starts the timer once
 *   close          — close with one number, `minutes`; `absorb` closes over
 *                    the included hour with no charge
 *   approve        — record (or, with `reason`, correct) the owner's yes
 *   correctMinutes — change a closed request's minutes, with `reason`
 *   reverseCharge  — void, credit or refund its charge, with `reason`;
 *                    `absorb` also records it as not charged
 *   retryCharge    — re-run a charge that failed or never recorded
 *   goodwill       — add included minutes to `orgId`'s `month`, with `reason`
 *   sendStatement  — email the owner `orgId`'s `month`
 *   sendQuote      — the "bigger than Site Care covers" reply
 *   move           — move an open emailed request to `orgId`, another Site
 *                    Care workspace its sender was recorded in (AGL-4031)
 * A close or correction blocked by the included hour answers 409 with
 * `blocked`, which the panel reads as "Ask the owner first" / "Absorb it".
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    if (decoded['staff'] !== true) return Response.json({ error: 'Staff only' }, { status: 403 })
    const firestore = app.firestore()
    const actor = { uid: decoded.uid, email: decoded.email ?? null }

    if (method === 'GET') {
      const ticketId = String(query['ticketId'] ?? '')
      if (ticketId) {
        return Response.json(await readSiteCareRequestPanel(firestore, ticketId), { status: 200 })
      }
      const orgId = String(query['orgId'] ?? '')
      if (!orgId) return Response.json({ error: 'Missing ticketId or orgId' }, { status: 400 })
      const month = String(query['month'] ?? '') || siteCareMonthKey(Date.now())
      if (!isSiteCareMonthKey(month)) return Response.json({ error: 'Unreadable month' }, { status: 400 })
      const [view, org] = await Promise.all([
        readSiteCareMonth(firestore, { orgId, month }),
        readSiteCareOrg(firestore, orgId),
      ])
      return Response.json({ ...view, siteCare: orgHasSiteCare(org) }, { status: 200 })
    }

    if (method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
    const action = String(body?.action ?? '')
    const ticketId = String(body?.ticketId ?? '')
    const needTicket = () => {
      if (!ticketId) throw new SiteCareError('Missing ticketId', 400)
      return ticketId
    }
    switch (action) {
      case 'start':
        return Response.json({ request: await startSiteCareTimer(firestore, { ticketId: needTicket(), actor }) })
      case 'close':
        return Response.json(
          await closeSiteCareRequest(firestore, {
            ticketId: needTicket(),
            actor,
            minutes: body?.minutes,
            absorb: body?.absorb === true,
          }),
        )
      case 'approve':
        return Response.json({
          approval: await recordSiteCareApproval(firestore, {
            ticketId: needTicket(),
            actor: { uid: decoded.uid, email: decoded.email ?? null },
            approval: (body?.approval ?? {}) as Record<string, unknown>,
          }),
        })
      case 'correctMinutes':
        return Response.json(
          await correctSiteCareMinutes(firestore, {
            ticketId: needTicket(),
            actor,
            minutes: body?.minutes,
            reason: body?.reason,
            ...(typeof body?.absorb === 'boolean' ? { absorb: body.absorb } : {}),
          }),
        )
      case 'reverseCharge':
        return Response.json({
          charge: await reverseSiteCareCharge(firestore, {
            ticketId: needTicket(),
            actor,
            reason: body?.reason,
            absorb: body?.absorb === true,
          }),
        })
      case 'retryCharge':
        return Response.json({ charge: await retrySiteCareCharge(firestore, { ticketId: needTicket(), actor }) })
      case 'goodwill':
        return Response.json(
          await addSiteCareGoodwill(firestore, {
            orgId: String(body?.orgId ?? ''),
            month: body?.month,
            minutes: body?.minutes,
            reason: body?.reason,
            actor,
          }),
        )
      case 'sendStatement': {
        const orgId = String(body?.orgId ?? '')
        const month = String(body?.month ?? '')
        if (!orgId || !isSiteCareMonthKey(month)) throw new SiteCareError('Missing orgId or month', 400)
        const sent = await sendSiteCareStatement(firestore, { orgId, month, actor })
        return Response.json({ sent: sent.sent, to: sent.to, reason: sent.reason ?? null })
      }
      case 'sendQuote': {
        const sent = await sendSiteCareQuote(firestore, {
          ticketId: needTicket(),
          actor,
          amountUsd: body?.amountUsd,
          scope: body?.scope,
        })
        return Response.json({ sent: sent.sent, to: sent.to, reason: sent.reason ?? null })
      }
      case 'move':
        return Response.json(
          await moveSiteCareRequest(firestore, { ticketId: needTicket(), actor, orgId: body?.orgId }),
        )
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (error instanceof SiteCareError) {
      return Response.json({ error: error.message, ...(error.detail ?? {}) }, { status: error.status })
    }
    console.error(error)
    return Response.json({ error: 'Site Care action failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
