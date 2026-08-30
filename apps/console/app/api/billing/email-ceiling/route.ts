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

import { isOrgWideMember, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  deliverableMonthlyCeiling,
  orgHourlyCampaignCeiling,
} from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  readEmailSendRateConfig,
  readOrgEmailSendWindow,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import type { OrgEmailSendCeiling } from '../../../../utils/email-send-ceiling'

// lockdown-423: exempt — read feeding the self-serve billing usage section,
// the same posture as billing/host-usage and billing/usage-config. AGL-1501
// keeps billing-locked sessions alive precisely so a workspace can reach
// Billing, and this is one of the numbers on it.

/**
 * THE HOURLY CAMPAIGN CEILING FOR ONE WORKSPACE.
 *
 * A workspace is paced by a ceiling it could not see. `claimOrgEmailSendBudget`
 * refuses a campaign that would take the org past its share of the platform
 * hour, and the only place that number has ever appeared is the deferral
 * message a merchant reads AFTER pressing Send. The billing page showed the
 * monthly allowance and nothing about the pace, so a customer throttled at 500
 * an hour had no surface that mentioned 500 or an hour.
 *
 * ## Why a route and not a client read
 *
 * Both inputs live in `rateLimits`, which the security rules deny to every
 * client — the collection is shared with the abuse limiter and inherits its
 * deny-all rule. There is no client-readable copy and there should not be one:
 * the platform ramp is an operator control.
 *
 * ## What it costs
 *
 * At most TWO document reads, and usually one. `readEmailSendRateConfig`
 * caches the ceiling for 15s in-process — it sits on every outbound message's
 * path already — so a warm instance pays only for the org's own hourly window
 * document. Nothing is scanned, nothing is summed, and no counter is
 * recomputed: the window document holds the count the claim transaction wrote.
 *
 * ## What it deliberately does NOT return
 *
 * The MONTHLY figures. `emailSendsPerMonth` is resolved on the billing page
 * from the org document merged with its billing subcollection, and the monthly
 * meter reads `orgs/{id}/counters/campaignEmailSends` directly. Answering the
 * month here as well would put a second plan resolution and a second counter
 * read behind one card, and the two could disagree — which is the AGL-2113
 * defect (a readout the gate does not agree with) reintroduced by a route
 * meant to close it. The hour is what only the server can see, so the hour is
 * what it answers.
 */
async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken)
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query['orgId'] ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    /*
     * ORG-WIDE membership, and then `billing.view`.
     *
     * The second clause alone is what every sibling billing route checks, and
     * it is not sufficient on its own for a number about the whole
     * organization. A SITE COLLABORATOR is an `orgs/{id}/members` document
     * like any other — `allHosts: false` plus a `hostAccess` map — so a role
     * check reads as though it answered a scope question when it answered
     * only a kind-of-action one. On the Admin SDK no rule re-checks the scope
     * afterwards. An org-wide send ceiling is not a fact about any one site,
     * and a collaborator scoped to one site has no claim on it.
     */
    if (
      !isStaff &&
      (!isOrgWideMember(actor?.member) ||
        !(await memberHasOrgPermission(orgId, actor?.member, 'billing.view')))
    ) {
      return Response.json({ error: 'billing.view required' }, { status: 403 })
    }

    const config = await readEmailSendRateConfig()
    const window = await readOrgEmailSendWindow({ orgId })
    /*
     * The ceilings, from the LIVE platform ramp rather than a stored per-org
     * number. `orgHourlyCampaignCeiling` is a share of whatever the ceiling
     * currently is, so an operator moving the ramp moves this surface with it
     * and the two can never contradict each other — the property
     * `send-ceilings.ts` exists to maintain.
     */
    const reading: OrgEmailSendCeiling = {
      hourUsed: window.used,
      hourLimit: orgHourlyCampaignCeiling(config.perHour),
      hourResetMs: window.resetMs,
      deliverableMonthly: deliverableMonthlyCeiling(config.perHour),
      perSend: EMAIL_MAX_RECIPIENTS_PER_SEND,
      // The operator kill switch. `claimOrgEmailSendBudget` grants every claim
      // while this is false, so a surface that drew a binding ceiling would be
      // telling a customer to plan around a control that is parked.
      paced: config.enabled,
    }
    return Response.json(reading, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Send ceiling lookup failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
