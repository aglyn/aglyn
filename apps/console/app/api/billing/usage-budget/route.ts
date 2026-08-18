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
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  BUDGET_MAX_THRESHOLDS,
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  BUDGET_THRESHOLD_MAX_PCT,
  BUDGET_THRESHOLD_MIN_PCT,
  DEFAULT_BUDGET_THRESHOLD_PCTS,
  normalizeBudgetThresholds,
  orgMonthlySpend,
  resolveUsageBudget,
} from '../../../../utils/usage-budget'

// lockdown-423: exempt — self-serve billing surface, same posture as
// billing/storage-overage and billing/addons. AGL-1501 keeps billing-locked
// sessions alive precisely so members can reach Billing, and a budget is how
// an org watches the spend that got it locked.

/**
 * The org's own USAGE BUDGET — set it, see it, clear it (AGL-1528).
 *
 * Zach, 2026-08-18, verbatim: "*our usage metering, usage alerts, budgets for
 * usage alerts, similar to how google cloud charges*"; and, on the same day,
 * the lens this route exists to satisfy: "*Always make sure features are
 * available in the console and not just that the capability exists.*"
 *
 * A budget the customer cannot SET and SEE is not a feature. The cron can
 * evaluate a budget with no console surface at all — and would then be
 * alerting on a number nobody could ever have chosen.
 *
 *   `get`      → the budget in force, this month's spend against it, and the
 *                bounds the form must respect
 *   `setBudget`→ store the amount and threshold rules the customer chose
 *   `clearBudget` → remove it entirely
 *
 * ## WHY THIS IS NOT `billing/storage-overage`
 *
 * That route owns the customer's hard CAP: past it, uploads are refused. This
 * owns a BUDGET: past it, nothing happens except a notification. They are
 * deliberately separate documents, separate routes and separate cards,
 * because the day they share a field is the day a budget silently starts
 * refusing uploads — the failure mode AGL-1529 rejected on arrival (a cap
 * that takes a site down to save $2).
 *
 * ## Permission
 *
 * `billing.manage`, and admin-SDK-only by construction: `usageBudget` sits on
 * the org document, which the rules deny to every client. That matters less
 * here than it does for the cap — a budget cannot raise or lower an invoice —
 * but the two controls live side by side on one card, and a customer who can
 * edit one and not the other would reasonably assume the difference means
 * something about their money.
 *
 * ## Spend is READ, not computed
 *
 * `orgs/{orgId}/usage/{month}.billedCents` is the invoice's own arithmetic,
 * written daily by `report-usage`. This route reads that document BY ID for
 * the current month rather than taking the latest by `computedAt`: the card
 * must show this month's spend or none, never last month's under this
 * month's heading.
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
  if (!orgId || !['get', 'setBudget', 'clearBudget'].includes(action)) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = (orgSnapshot.data() ?? {}) as any
    const current = resolveUsageBudget(org)
    const month = new Date().toISOString().slice(0, 7)

    if (action === 'get') {
      // BY ID for this month, not the latest by `computedAt` — the card must
      // show this month's spend or none, never last month's under this
      // month's heading. `orgMonthlySpend` compares the two anyway, so a
      // missing document reads as `meteredFresh: false` rather than as $0.
      const [rollup, assist] = await Promise.all([
        orgRef.collection('usage').doc(month).get(),
        orgRef.collection('assistUsage').doc(month).get(),
      ])
      const spend = orgMonthlySpend({
        month,
        rollupBilledCents: rollup.get('billedCents'),
        rollupMonth: rollup.exists ? (rollup.get('month') ?? month) : null,
        assistEstCostUsd: assist.get('estCostUsd'),
        assistBilledFrom: process.env.BILL_ASSIST_TOKENS_FROM,
      })
      return Response.json(
        {
          ...current,
          month,
          spend,
          defaultThresholdPcts: [...DEFAULT_BUDGET_THRESHOLD_PCTS],
          minAmountUsd: BUDGET_MIN_USD,
          maxAmountUsd: BUDGET_MAX_USD,
          minThresholdPct: BUDGET_THRESHOLD_MIN_PCT,
          maxThresholdPct: BUDGET_THRESHOLD_MAX_PCT,
          maxThresholds: BUDGET_MAX_THRESHOLDS,
        },
        { status: 200 },
      )
    }

    if (action === 'clearBudget') {
      // The whole subdocument, so an org that clears its budget is
      // byte-identical to one that never set one — and the dedupe guard is
      // cleared with it, so setting a NEW budget later is not silently
      // suppressed by a threshold recorded against the old amount.
      // `update()`, NOT `set(..., {merge:true})`. Firestore interprets a
      // dotted field path as a nested path ONLY in `update()`; in `set()` it
      // creates a literal top-level field called "usageAlerts.budget", which
      // would leave the real guard in place while looking deleted. `update()`
      // throws NOT_FOUND on a missing document — the 404 above proves this one
      // exists, and a delete racing this write failing loudly is correct.
      await orgRef.update({
        usageBudget: FieldValue.delete(),
        'usageAlerts.budget': FieldValue.delete(),
      })
      return Response.json(
        { ok: true, budgetSet: false, amountUsd: null },
        { status: 200 },
      )
    }

    const requested = Number(body?.amountUsd)
    if (
      !Number.isFinite(requested) ||
      requested < BUDGET_MIN_USD ||
      requested > BUDGET_MAX_USD
    ) {
      return Response.json(
        {
          error:
            `Set a monthly budget between $${BUDGET_MIN_USD} and ` +
            `$${BUDGET_MAX_USD.toLocaleString('en-US')}.`,
          code: 'invalid_amount',
        },
        { status: 400 },
      )
    }
    // Coerced rather than refused: a rule list is a convenience, and rejecting
    // the whole save because one percentage was mistyped would lose the
    // amount — the part that matters — over the part that has a good default.
    const thresholdPcts = normalizeBudgetThresholds(body?.thresholdPcts)

    // The dedupe guard is reset ON EVERY SAVE, and this is not incidental.
    // The guard records "we already told you about 90%", which is a claim
    // about a SPECIFIC amount. Lower the budget from $500 to $50 and the
    // recorded 90 would suppress the alert the new, much closer budget exists
    // to produce — a control that reads as tightened while going quiet.
    // `update()` for the same reason as `clearBudget` above: the nested guard
    // delete is only a nested delete in `update()`. The `usageBudget` map is
    // written whole, replacing the previous one rather than merging into it —
    // so a customer who removes a threshold rule actually loses it instead of
    // keeping a union of every rule they ever set.
    await orgRef.update({
      usageBudget: {
        amountUsd: requested,
        thresholdPcts,
        setAt: FieldValue.serverTimestamp(),
        setBy: decoded.uid,
      },
      'usageAlerts.budget': FieldValue.delete(),
    })
    await firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ?? null,
        action: 'billing.usageBudget.set',
        target: `orgs/${orgId}`,
        before: {
          budgetSet: current.budgetSet,
          amountUsd: current.amountUsd,
          thresholdPcts: current.thresholdPcts,
        },
        after: { budgetSet: true, amountUsd: requested, thresholdPcts },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json(
      { ok: true, budgetSet: true, amountUsd: requested, thresholdPcts },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage budget update failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
