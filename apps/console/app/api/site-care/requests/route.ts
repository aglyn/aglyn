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

import {
  formatSiteCareDate,
  isSiteCareMonthKey,
  pluginRequestFromWeb,
  siteCareChargeWords,
  siteCareMonthKey,
  siteCareMonthSentence,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  openSiteCareRequest,
  orgHasSiteCare,
  readSiteCareMonth,
  readSiteCareOrg,
  SiteCareError,
  siteCareStatementLine,
} from '@aglyn/tenant-data-admin/server/site-care-requests'
import { readSiteCareProjects } from '@aglyn/tenant-data-admin/server/site-care-projects'
import {
  SITE_CARE_PROJECT_STATUS_LABELS,
  siteCareProjectInvoiceLine,
  siteCareProjectSplitSentence,
} from '@aglyn/aglyn/app-utils/site-care-project'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — a Site Care request is a support ticket, and support must stay
// reachable under a lock (the lockdown notice itself says "contact support"); the
// statement read is the billing surface a billing-locked owner needs.

/**
 * SITE CARE, THE OWNER'S SIDE (AGL-3959).
 *
 * `POST` opens a request from the console's "Request a change" — the same
 * tagged ticket a member's email to the support address opens. Any member of the
 * workspace may ask; the workspace must have Site Care, and the button says
 * so before the click.
 *
 * `GET ?orgId&view=status` says whether the workspace has Site Care, for
 * the button's prerequisite; any member may ask.
 *
 * `GET ?orgId&month` is the month's statement for the Site Care card on
 * Billing: the requests, the minutes used of the included hour, the extra
 * time billed and every recorded row in plain words. Needs `billing.view`.
 *
 * `GET ?orgId&view=projects` is the workspace's flat-quoted projects
 * (AGL-3970) for Billing, as past charges: what each covers, its price and
 * split, where it stands, each invoice (with its pay link while unpaid) and
 * every recorded row in the owner's words. Needs `billing.view`, with or
 * without Site Care: a project is billed whether or not the add-on is on.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query['orgId'] ?? body?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!membership && decoded['staff'] !== true) {
      return Response.json({ error: 'Not a member of this workspace' }, { status: 403 })
    }
    const firestore = app.firestore()
    const org = await readSiteCareOrg(firestore, orgId)
    if (!org) return Response.json({ error: 'Unknown workspace' }, { status: 404 })

    if (method === 'POST') {
      if (!orgHasSiteCare(org)) {
        return Response.json(
          { error: 'Site Care is not on this workspace. Add it on Billing to have changes made for you.' },
          { status: 403 },
        )
      }
      const hostId = typeof body?.hostId === 'string' && body.hostId ? body.hostId : null
      const opened = await openSiteCareRequest(firestore, {
        orgId,
        org,
        hostId,
        subject: String(body?.subject ?? ''),
        body: String(body?.body ?? ''),
        requester: { uid: decoded.uid, email: decoded.email ?? null },
        source: 'console',
      })
      return Response.json(
        { ticketId: opened.ticketId, dueAt: formatSiteCareDate(opened.dueAtMs) },
        { status: 200 },
      )
    }

    // Whether the workspace has Site Care, for "Request a change": any member
    // may ask, since any member may request a change.
    if (method === 'GET' && String(query['view'] ?? '') === 'status') {
      return Response.json({ siteCare: orgHasSiteCare(org) }, { status: 200 })
    }

    if (method === 'GET' && String(query['view'] ?? '') === 'projects') {
      if (
        decoded['staff'] !== true &&
        !(await memberHasOrgPermission(orgId, membership?.member, 'billing.view'))
      ) {
        return Response.json({ error: 'You need permission to view billing' }, { status: 403 })
      }
      const projects = await readSiteCareProjects(firestore, orgId)
      // The owner's telling: never a staff member's address or a Stripe id,
      // and only invoices that reached them.
      return Response.json(
        {
          projects: projects.map(({ projectId, project, history }) => ({
            projectId,
            title: project.title,
            scope: project.scope,
            priceUsd: project.quote.priceUsd,
            split: siteCareProjectSplitSentence(project.quote),
            status: project.status,
            statusLabel: SITE_CARE_PROJECT_STATUS_LABELS[project.status],
            createdAtMs: project.createdAtMs,
            invoices: project.invoices
              .filter((invoice) => invoice.status !== 'creating' && invoice.status !== 'failed')
              .map((invoice) => ({
                seq: invoice.seq,
                line: siteCareProjectInvoiceLine(invoice),
                number: invoice.number,
                payUrl: invoice.status === 'open' ? invoice.hostedInvoiceUrl : null,
              })),
            history: history
              .filter((row) => row.kind !== 'email.notSent' && row.kind !== 'invoice.failed')
              .filter((row) => !row.kind.endsWith('Requested') && row.kind !== 'invoice.requested')
              .map((row) => ({ atMs: row.atMs, summary: row.summary, reason: row.reason })),
          })),
        },
        { status: 200 },
      )
    }

    if (method === 'GET') {
      if (
        decoded['staff'] !== true &&
        !(await memberHasOrgPermission(orgId, membership?.member, 'billing.view'))
      ) {
        return Response.json({ error: 'You need permission to view billing' }, { status: 403 })
      }
      const month = String(query['month'] ?? '') || siteCareMonthKey(Date.now())
      if (!isSiteCareMonthKey(month)) return Response.json({ error: 'Unreadable month' }, { status: 400 })
      const view = await readSiteCareMonth(firestore, { orgId, month })
      // The owner's telling: their own words for every row, never a staff
      // member's address or a Stripe id.
      const history = [...view.monthHistory, ...view.requests.flatMap((r) => r.history)]
        .sort((a, b) => a.atMs - b.atMs)
        .filter((row) => row.kind !== 'email.notSent' && row.kind !== 'statement.notSent')
        .map((row) => ({ atMs: row.atMs, summary: row.summary, reason: row.reason }))
      return Response.json(
        {
          siteCare: orgHasSiteCare(org),
          statement: view.statement,
          sentence: siteCareMonthSentence(view.statement),
          requests: view.requests.map((r) => ({
            ticketId: r.ticketId,
            title: r.subject,
            state: r.request.state,
            closedAtMs: r.request.closedAtMs,
            minutesLogged: r.request.minutesLogged,
            includedMinutesUsed: r.request.includedMinutesUsed,
            billedHours: r.request.billedHours,
            charge: r.request.billedHours > 0 ? siteCareChargeWords(r.request.charge?.status ?? null) : null,
            line: siteCareStatementLine(r),
          })),
          history,
        },
        { status: 200 },
      )
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (error instanceof SiteCareError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return Response.json({ error: 'Site Care request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
