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
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import {
  checkSiteCareProjectPayments,
  createSiteCareProject,
  editSiteCareProject,
  launchSiteCareProject,
  readSiteCareProjects,
  recordSiteCareProjectAcceptance,
  resendSiteCareProjectInvoice,
  retrySiteCareProjectInvoice,
  reverseSiteCareProjectInvoice,
  sendSiteCareProjectInvoice,
} from '@aglyn/tenant-data-admin/server/site-care-projects'
import { SiteCareError } from '@aglyn/tenant-data-admin/server/site-care-requests'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * "CHARGE FOR WORK", THE STAFF SIDE (AGL-3970). Staff only.
 *
 * GET `?orgId` is the workspace's flat-quoted projects for its staff page:
 * each with its scope, quote, the owner's recorded yes, every invoice (and
 * its pay link) and the append-only history, plus whether the workspace has
 * a Stripe customer to invoice.
 *
 * POST `{ action, orgId, projectId? }` is every change staff make, each one
 * an append-only history row and an `adminAudit` row in the same write:
 *   create        — quote a project: `title`, `scope`, `kind`, `estimatedHours`,
 *                   optional `priceUsd` (only ever above the computed price)
 *   edit          — the same fields, with `reason`; refused once an invoice is sent
 *   accept        — record (or, on the current quote, correct with `reason`)
 *                   how and when the owner said yes; emails the confirmation
 *   sendInvoice   — raise the next invoice (whole price, or the deposit) and
 *                   email the pay link
 *   launch        — mark launched; a half-and-half project raises its balance
 *   retryInvoice  — re-run invoice `seq` that failed or never recorded
 *   resendInvoice — email invoice `seq`'s pay link again
 *   reverse       — `void`, `credit` or `refund` invoice `seq`, with `reason`
 *   checkPayments — read the unpaid invoices from Stripe and record any paid
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
    const orgId = String(query['orgId'] ?? body?.orgId ?? '')
    if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

    if (method === 'GET') {
      const [projects, billing] = await Promise.all([readSiteCareProjects(firestore, orgId), readOrgBilling(orgId)])
      const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
      return Response.json({ projects, canInvoice: Boolean(customerId) }, { status: 200 })
    }

    if (method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
    const action = String(body?.action ?? '')
    const projectId = String(body?.projectId ?? '')
    const needProject = () => {
      if (!projectId) throw new SiteCareError('Missing projectId', 400)
      return projectId
    }
    const seq = () => {
      const value = Number(body?.seq)
      if (!Number.isInteger(value) || value < 1) throw new SiteCareError('Missing invoice seq', 400)
      return value
    }
    const quote = {
      title: body?.title,
      scope: body?.scope,
      kind: body?.kind,
      estimatedHours: body?.estimatedHours,
      priceUsd: body?.priceUsd,
    }
    switch (action) {
      case 'create':
        return Response.json(await createSiteCareProject(firestore, { orgId, actor, ...quote }))
      case 'edit':
        return Response.json({
          project: await editSiteCareProject(firestore, {
            orgId,
            projectId: needProject(),
            actor,
            reason: body?.reason,
            ...quote,
          }),
        })
      case 'accept':
        return Response.json({
          acceptance: await recordSiteCareProjectAcceptance(firestore, {
            orgId,
            projectId: needProject(),
            actor: { uid: decoded.uid, email: decoded.email ?? null },
            acceptance: (body?.acceptance ?? {}) as Record<string, unknown>,
          }),
        })
      case 'sendInvoice':
        return Response.json({
          invoice: await sendSiteCareProjectInvoice(firestore, { orgId, projectId: needProject(), actor }),
        })
      case 'launch':
        return Response.json(await launchSiteCareProject(firestore, { orgId, projectId: needProject(), actor }))
      case 'retryInvoice':
        return Response.json({
          invoice: await retrySiteCareProjectInvoice(firestore, { orgId, projectId: needProject(), seq: seq(), actor }),
        })
      case 'resendInvoice': {
        const sent = await resendSiteCareProjectInvoice(firestore, {
          orgId,
          projectId: needProject(),
          seq: seq(),
          actor,
        })
        return Response.json({ sent: sent.sent, to: sent.to, reason: sent.reason ?? null })
      }
      case 'reverse':
        return Response.json({
          invoice: await reverseSiteCareProjectInvoice(firestore, {
            orgId,
            projectId: needProject(),
            seq: seq(),
            actor,
            action: body?.reversal,
            reason: body?.reason,
          }),
        })
      case 'checkPayments':
        return Response.json(await checkSiteCareProjectPayments(firestore, { orgId, projectId: needProject() }))
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
    return Response.json({ error: 'Project action failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
