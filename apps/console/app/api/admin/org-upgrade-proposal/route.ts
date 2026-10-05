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
  proposeOrgUpgrade,
  UpgradeProposalError,
  withdrawOrgUpgrade,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Staff ask a workspace to upgrade (AGL-3466), or withdraw the ask.
 *
 * The separate step after a handoff: a client who was handed a workspace
 * evaluates it first, on whatever it already has, and is asked to buy a plan
 * only once staff decide the evaluation is done. `propose` records the plan
 * on the org, audits it and emails the owner; while it stands with no live
 * subscription, the workspace's billing managers see it on the org home and
 * on Billing with the plan preselected. `withdraw` removes it. A live
 * subscription removes it on its own, from the Stripe webhook.
 *
 * Staff only, and written through the Admin SDK: the rules deny
 * `upgradeProposal` to every client, staff included, so this route and the
 * webhook are its only writers and both leave an `adminAudit` row.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (decoded['staff'] !== true) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const actor = { uid: decoded.uid, email: decoded.email ?? null }

    if (action === 'propose') {
      const origin = headers.origin ?? `https://${headers.host}`
      const { proposal, emailed } = await proposeOrgUpgrade({
        orgId,
        plan: body?.plan,
        note: body?.note,
        actor,
        origin,
      })
      return Response.json({ ok: true, proposal, emailed }, { status: 200 })
    }

    if (action === 'withdraw') {
      const withdrawn = await withdrawOrgUpgrade({ orgId, actor })
      return Response.json({ ok: true, withdrawn }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (error instanceof UpgradeProposalError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return Response.json({ error: 'Upgrade proposal failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
