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
  publicAssistCredits,
  resolveAssistBudgetUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — a READ-ONLY billing surface that writes nothing,
// same posture as billing/usage-budget beside it. AGL-1501 keeps
// billing-locked sessions alive so members can reach Billing, and a
// locked org needs its usage readouts more than an unlocked one does.

/**
 * This month's Aglyn Assist credit standing for one org — the odometer beside
 * the band on Billing → Usage.
 *
 * ## Why a route at all
 *
 * Every other meter on that page reads its counter straight from Firestore in
 * the browser. This one cannot: `orgs/{id}/assistUsage` is deliberately absent
 * from the rules file and therefore default-deny for every client, because the
 * assist subcollections sit beside the exchange prose and are reached only
 * through the Admin SDK. A client read would fail silently and the meter would
 * sit at "not yet metered" forever — a surface that looks like a readout and
 * is not one, which is worse than no meter at all.
 *
 * ## Why it answers in CREDITS
 *
 * The stored figure is `estCostUsd`: our provider bill for the month at the
 * serving model's list rates. Publishing it would put our model choice and our
 * margin on a billing page, and it would move under the customer every time
 * the model is swapped. `publicAssistCredits` is the one conversion, and no
 * dollar figure crosses this boundary.
 *
 * `credits: null` is the honest answer for a plan that sells no assist band —
 * Free and Starter. It is not "0 of 0"; there is no band to be a fraction of,
 * and the page renders no meter rather than an empty one.
 *
 * Membership alone, not `billing.manage`: this is a capacity readout of the
 * kind every other meter on the page shows to anyone who can see the page, and
 * it carries no money. The spend view that DOES carry money is
 * `/api/billing/usage-budget`, which gates on `billing.manage`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const orgId = String((query as Record<string, unknown>)?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Bad request' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!isStaff && !actor?.member) {
      return Response.json({ error: 'Not a member' }, { status: 403 })
    }
    const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const budgetUsd = resolveAssistBudgetUsd(orgSnapshot.data() as never)
    if (budgetUsd === null) return Response.json({ credits: null })
    const month = new Date().toISOString().slice(0, 7)
    const usage = await orgRef.collection('assistUsage').doc(month).get()
    const costUsd = Number(usage.get('estCostUsd') ?? 0)
    return Response.json({
      credits: publicAssistCredits(
        Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
        budgetUsd,
      ),
    })
  } catch (error) {
    console.error('[assist-credits] read failed', orgId, error)
    // The meter's "not yet metered" state, not a zero — a failed read must
    // not render as "you have used none of your credits".
    return Response.json({ error: 'Assist credits unavailable' }, { status: 500 })
  }
}

export const GET = handler
