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
import { recordAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { assistUsageMonth } from '../usage/assist-usage'
import {
  AI_BILLING_STANDING_DOC,
  AI_BILLING_SUBCOLLECTION,
  AI_OVERAGE_CHARGES_SUBCOLLECTION,
  readAiOverageMonthLedger,
} from '../billing/ai-overage-ledger'
import {
  AI_OVERAGE_CEILING_LADDER_USD,
  AI_OVERAGE_STAFF_CEILING_MAX_USD,
  AI_OVERAGE_STAFF_CEILING_MIN_USD,
  AI_OVERAGE_THRESHOLD_USD,
  AI_OVERAGE_UNPAID_LIMIT_USD,
  aiOverageCardOnFile,
  aiOverageEffectiveCeilingUsd,
  aiOverageStandingCeilingUsd,
  aiOverageStep,
  readAiOverageStanding,
} from '../billing/ai-overage-standing'
import {
  resetAiOverageStep,
  resumeAiOverage,
  setAiOverageStaffOverride,
} from '../billing/ai-overage-standing-writes'
import { aiOverageBillsByInvoice } from '../billing/ai-overage-cutover'

/**
 * STAFF'S CONTROLS OVER ONE WORKSPACE'S OVERAGE STANDING (AGL-3011).
 *
 * The ladder rises on payment history and a dispute takes it back to the
 * bottom. Both are rules, and a rule that nobody can override is a rule that
 * strands the customer it gets wrong: an enterprise-shaped workspace on its
 * first month, a dispute that turns out to be fraud on the cardholder rather
 * than by them, a failed charge whose cause was ours.
 *
 * So four acts, staff-only, every one of them audited:
 *
 *   `get`           the standing in full, with the month's charges
 *   `setCeiling`    a ceiling that outranks the ladder, with a reason and an
 *                   optional expiry
 *   `liftPause`     resume accrual, with a reason — the ONLY way a dispute
 *                   pause comes off
 *   `resetStep`     put the workspace back at the bottom of the ladder
 *
 * A reason is required on every act that changes something, because the
 * question a month later is never "what was the ceiling" — the document says
 * that — but "why did someone raise it".
 *
 * The emergency stop is not here and does not change: Lockdown, scoped to
 * the organization, which stops AI along with everything else.
 */

/** How many of the month's charge rows the card lists. */
const CHARGES_LISTED = 20

/** The longest a staff reason may be, so a paste cannot fill the document. */
const REASON_MAX = 500

function badRequest(error: string, code: string): Response {
  return Response.json({ error, code }, { status: 400 })
}

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
  const actions = ['get', 'setCeiling', 'liftPause', 'resetStep']
  if (!orgId || !actions.includes(action)) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // The staff claim, the same test `ai/admin/org` makes. Not a permission
    // on the workspace: these controls are Aglyn's side of the relationship,
    // and a workspace admin raising their own ceiling is the thing the
    // ladder exists to prevent.
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const now = new Date()
    const month = assistUsageMonth(now)
    const db = firebaseAdmin.app().firestore()
    const orgRef = db.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'No such organization' }, { status: 404 })
    }
    const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
    const reason = String(body?.reason ?? '').trim().slice(0, REASON_MAX)

    if (action === 'setCeiling') {
      const clearing = body?.ceilingUsd === null
      const ceilingUsd = Number(body?.ceilingUsd)
      if (!reason) {
        return badRequest('Say why the ceiling is being changed', 'reason_required')
      }
      if (
        !clearing &&
        (!Number.isFinite(ceilingUsd) ||
          ceilingUsd < AI_OVERAGE_STAFF_CEILING_MIN_USD ||
          ceilingUsd > AI_OVERAGE_STAFF_CEILING_MAX_USD)
      ) {
        return badRequest(
          `Set a ceiling between $${AI_OVERAGE_STAFF_CEILING_MIN_USD} and ` +
            `$${AI_OVERAGE_STAFF_CEILING_MAX_USD.toLocaleString('en-US')}, or clear it.`,
          'invalid_ceiling',
        )
      }
      // An expiry that does not parse is refused rather than dropped: a
      // ceiling meant to last a week and stored with no end is the failure
      // this field exists to avoid.
      const rawExpiry = body?.expiresAt
      const expiresAt =
        rawExpiry === null || rawExpiry === undefined ? null : String(rawExpiry)
      if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) {
        return badRequest('The expiry is not a date', 'invalid_expiry')
      }
      await setAiOverageStaffOverride(
        db,
        orgId,
        clearing
          ? null
          : { ceilingUsd, reason, setBy: decoded.uid, expiresAt },
        now,
      )
      await recordAdminAudit({
        actorUid: decoded.uid,
        action: clearing
          ? 'ai.overage.clearCeiling'
          : 'ai.overage.setCeiling',
        target: `orgs/${orgId}/${AI_BILLING_SUBCOLLECTION}/${AI_BILLING_STANDING_DOC}`,
        note: clearing
          ? reason
          : `${reason} — ceiling $${ceilingUsd}${expiresAt ? `, until ${expiresAt}` : ''}`,
      })
    }

    if (action === 'liftPause') {
      if (!reason) {
        return badRequest('Say why the pause is being lifted', 'reason_required')
      }
      // `force`, because staff lifting a pause is the one path a DISPUTE
      // pause has out. Every other pause lifts on its own when the payment
      // that set it succeeds.
      await resumeAiOverage(db, orgId, { force: true })
      await recordAdminAudit({
        actorUid: decoded.uid,
        action: 'ai.overage.liftPause',
        target: `orgs/${orgId}/${AI_BILLING_SUBCOLLECTION}/${AI_BILLING_STANDING_DOC}`,
        note: reason,
      })
    }

    if (action === 'resetStep') {
      if (!reason) {
        return badRequest('Say why the step is being reset', 'reason_required')
      }
      await resetAiOverageStep(db, orgId)
      await recordAdminAudit({
        actorUid: decoded.uid,
        action: 'ai.overage.resetStep',
        target: `orgs/${orgId}/${AI_BILLING_SUBCOLLECTION}/${AI_BILLING_STANDING_DOC}`,
        note: reason,
      })
    }

    // Read AFTER any write, so the answer is the state the act produced
    // rather than the state it found — a staff card that showed the old
    // ceiling after raising it would be read as the raise having failed.
    const [standingSnapshot, usageSnapshot, chargesSnapshot] = await Promise.all([
      orgRef.collection(AI_BILLING_SUBCOLLECTION).doc(AI_BILLING_STANDING_DOC).get(),
      orgRef.collection('assistUsage').doc(month).get(),
      orgRef
        .collection(AI_OVERAGE_CHARGES_SUBCOLLECTION)
        .where('month', '==', month)
        .limit(CHARGES_LISTED)
        .get(),
    ])
    const standing = readAiOverageStanding(
      standingSnapshot.exists ? (standingSnapshot.data() ?? null) : null,
    )
    const ledger = readAiOverageMonthLedger(
      usageSnapshot.exists ? (usageSnapshot.data() ?? null) : null,
    )
    return Response.json(
      {
        month,
        // Whether any of this is live yet. Staff looking at a standing that
        // nothing consults should be told so rather than left to infer it
        // from a ceiling that never refuses.
        billsByInvoice: aiOverageBillsByInvoice(month),
        standing: {
          paymentMethodType: standing.paymentMethodType ?? null,
          cardOnFile: aiOverageCardOnFile(standing) ?? null,
          firstPaidMonth: standing.firstPaidMonth,
          qualifyingMonths: standing.qualifyingMonths,
          step: aiOverageStep(standing),
          staffOverride: standing.staffOverride,
          pause: standing.pause,
          lastDisputeAt: standing.lastDisputeAt,
        },
        ceiling: {
          ladderUsd: [...AI_OVERAGE_CEILING_LADDER_USD],
          standingUsd: aiOverageStandingCeilingUsd(standing, now),
          effectiveUsd: aiOverageEffectiveCeilingUsd(org as never, standing, now),
          thresholdUsd: AI_OVERAGE_THRESHOLD_USD,
          unpaidLimitUsd: AI_OVERAGE_UNPAID_LIMIT_USD,
        },
        ledger,
        charges: chargesSnapshot.docs.map((doc) => ({
          chargeId: doc.id,
          kind: doc.get('kind') ?? null,
          amountUsd: Number(doc.get('amountUsd') ?? 0),
          credits: Number(doc.get('credits') ?? 0),
          invoiceId: doc.get('invoiceId') ?? null,
          status: doc.get('status') ?? null,
        })),
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'AI overage standing failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
