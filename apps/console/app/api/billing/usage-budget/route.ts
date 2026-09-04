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
  isOrgWideMember,
  planMetersInfraOverage,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  BUDGET_GUARD_KEY,
  BUDGET_MAX_THRESHOLDS,
  BUDGET_MAX_USD,
  BUDGET_MIN_USD,
  BUDGET_THRESHOLD_MAX_PCT,
  BUDGET_THRESHOLD_MIN_PCT,
  DEFAULT_BUDGET_THRESHOLD_PCTS,
  normalizeBudgetThresholds,
  orgMonthlySpend,
  publicOrgMonthlySpend,
  resolveUsageBudget,
} from '../../../../utils/usage-budget'

// lockdown-423: exempt — self-serve billing surface, same posture as
// billing/storage-overage and billing/addons. AGL-1501 keeps billing-locked
// sessions alive precisely so members can reach Billing, and a budget is how
// an org watches the spend that got it locked.

/**
 * The org's own USAGE BUDGET — set it, see it, clear it (AGL-1528).
 *
 * A monthly alert threshold on metered spend, in the shape cloud providers
 * use — and reachable from the console, which is the point of this route. A
 * capability with no surface is not a feature: the cron can evaluate a budget
 * that has no form behind it, and would then be alerting on a number nobody
 * could ever have chosen.
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
 * the org document, on the deny-list the rules apply to every client write.
 *
 * That second clause was FALSE until AGL-1881 — the field was named nowhere in
 * the rules, so an org owner or admin could write it straight from the client
 * SDK. It is on the deny-list now. Worth knowing why the guard missed it: the
 * org-write coverage spec derives its universe from `AglynOrgBilling`, the
 * deny-list itself, the entitlement resolvers, and the seed writer — a field
 * that only ever appears in an API route is invisible to all four. That
 * matters less
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
    /*
     * ORG-WIDE, and then the permission.
     *
     * A permission answers WHAT KIND OF ACTION, never WHICH RESOURCES. A site
     * collaborator is an `orgs/{id}/members` document like any other, so a
     * bare `memberHasOrgPermission` reads as though it answered a scope
     * question when it answered only a kind-of-action one — and
     * `resolveOrgPermissions` layers a custom role and per-member overrides
     * over the role default, either of which can put `billing.manage` on a
     * host-scoped document.
     *
     * A budget is org-scoped: it governs the whole organization's invoice, and
     * a collaborator on one site of an agency's account has no claim on it.
     * `email-ceiling` guards the same way, for the same reason.
     */
    if (
      !isStaff &&
      (!isOrgWideMember(actor?.member) ||
        !(await memberHasOrgPermission(orgId, actor?.member, 'billing.manage')))
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
      /*==========================================
       * WHETHER THE BUDGET HAS ALERTED YET (AGL-2239).
       *
       * `usage-alerts` writes `orgs/{id}.usageAlerts.budget = {month,
       * threshold}` as its dedupe guard, and until now nothing read it back
       * to the customer. A budget that shows its ladder but never its events
       * documents an intention rather than reporting one — a customer at 91%
       * of a 90% rule cannot tell whether we told them.
       *
       * SCOPED TO THIS MONTH. A guard from a previous period is not an event
       * about this one, and rendering it would be exactly the mistake this
       * route already refuses one field over: last month's figure under this
       * month's heading.
       *=========================================*/
      const guard = (org?.usageAlerts ?? {})[BUDGET_GUARD_KEY] as
        | { month?: string; threshold?: number }
        | undefined
      const guardThreshold = Number(guard?.threshold)
      const lastAlert =
        guard?.month === month && Number.isFinite(guardThreshold) && guardThreshold > 0
          ? { month, threshold: guardThreshold }
          : null

      return Response.json(
        {
          ...current,
          month,
          /*
           * PROJECTED, never the breakdown itself.
           *
           * `OrgSpendBreakdown.assistUsd` is `assistUsage/{month}.estCostUsd`
           * verbatim — our provider bill at the serving model's list rates.
           * This response reaches an org billing admin's browser, so a dollar
           * figure on it is our unit cost published to a customer, whether or
           * not they are charged a cent of it.
           *
           * `publicOrgMonthlySpend` is the same boundary `publicAssistCredits`
           * holds on `/api/billing/assist-credits` and `publicAssistQuota`
           * holds on the chat route: credits cross, dollars of OUR cost do not.
           * The breakdown stays available to `usage-alerts`, which is cron-run
           * and mails the dollar figures to staff.
           */
          spend: publicOrgMonthlySpend(spend),
          lastAlert,
          /*
            WHETHER THIS PLAN HAS METERED USAGE AT ALL (AGL-2250).

            AGL-2135 made the free tier a hard cap that never bills, so a Free
            org's `billedCents` is 0 every month and a budget it sets can
            never fire. The card said none of that.

            `planMetersInfraOverage` is the predicate the cron and the invoice
            already use — a second opinion computed here is the AGL-1371
            mistake, and this one would be worse than a wrong figure: it would
            be a wrong statement about whether the customer can be charged.
          */
          // The ORG, not `org.plan`: `resolvePlan` also weighs the
          // subscription, so a plan string alone would answer a narrower
          // question than the invoice asks.
          metered: planMetersInfraOverage(org),
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
