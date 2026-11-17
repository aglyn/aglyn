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
import type { OrgContractTerms } from '@aglyn/aglyn/foundation'
import {
  CONTRACT_ADDITION_RATE_KEYS,
  CONTRACT_USAGE_RATE_KEYS,
  defaultContractRates,
  readOrgContract,
  resolveContractRates,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  checkContractRates,
  describeContractRateFailures,
} from '@aglyn/aglyn/app-utils/full-use-cost'
import { parseContractTerms } from '@aglyn/aglyn/app-utils/contract-terms'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  findPlanItem,
  isMeteredPriceId,
  meteredPriceId,
} from '@aglyn/tenant-data-admin/server/billing-addons'
import { isLiveSubscriptionStatus } from '@aglyn/aglyn/app-utils/org-billing-doc'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { backfillMeteredItem } from '../../../../utils/server/metered-backfill'

/**
 * A Custom contract's RATE CARD (AGL-4233) — the staff door that sets what a
 * Custom deal sells its additions and its usage past the contract at.
 *
 * `get` answers the stored terms, the rates they resolve to (the public Pro
 * rates where the deal negotiated nothing), the contracted amounts, and the
 * guard's verdict. `set` writes `org.entitlements.contract`, refused when any
 * rate is under cost + 30% at full use, with the figures. `remove` deletes
 * it, which returns the workspace to selling nothing and refusing past its
 * bands. Every write is audited to `adminAudit`, like the rest of the staff
 * billing doors.
 *
 * Writes nothing to Stripe except one thing: turning usage billing on
 * attaches the shared metered-usage item to a live subscription that lacks
 * it (`backfillMeteredItem`, priced at $0 until usage is reported), because
 * without it no usage can reach an invoice.
 *
 * Staff only (staff claim).
 */

/** The bands staff contract for, as the panel shows them beside the rates. */
const CONTRACTED_AMOUNT_KEYS = [
  'hostLimit',
  'managersPerOrg',
  'membersPerHost',
  'datasetsPerOrg',
  'posRegisters',
  'storagePerHostMb',
  'bandwidthGb',
  'dataStorageMbPerOrg',
  'apiRequestsPerMonth',
  'emailSendsPerMonth',
  'contactsPerHost',
  'actionRunsPerMonth',
] as const

async function stripeGet(secretKey: string, path: string): Promise<any> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message ?? `Stripe ${path} failed`)
  return payload
}

/**
 * Attach the metered-usage item to the contract's live subscription when it
 * has none. Best effort: the webhook's back-fill runs the same check on every
 * subscription event, so a miss here is retried there.
 */
async function ensureMeteredItem(
  orgId: string,
  customerId: string | undefined,
): Promise<'present' | 'attached' | 'not-attached'> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey || !customerId) return 'not-attached'
  try {
    const list = await stripeGet(
      secretKey,
      `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
    )
    const subscription = (list?.data ?? []).find((candidate: any) =>
      isLiveSubscriptionStatus(candidate?.status),
    )
    if (!subscription) return 'not-attached'
    const items: any[] = subscription?.items?.data ?? []
    if (items.some((item) => isMeteredPriceId(item?.price?.id))) return 'present'
    const interval =
      findPlanItem<any>(items)?.price?.recurring?.interval === 'year' ? 'year' : 'month'
    const priceId = meteredPriceId(interval)
    if (!priceId) return 'not-attached'
    const attached = await backfillMeteredItem({
      secretKey,
      subscriptionId: String(subscription.id),
      priceId,
      orgId,
    })
    return attached ? 'attached' : 'not-attached'
  } catch (error) {
    console.error('[enterprise-contract] metered item check failed', { orgId, error })
    return 'not-attached'
  }
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
  const action = String(body?.action ?? 'get')
  if (!orgId || !['get', 'set', 'remove'].includes(action)) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // The guard costs the AI credit rate off the AI plugin's declared band.
    await registerPluginServerDeclarations()

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnap = await orgRef.get()
    if (!orgSnap.exists) {
      return Response.json({ error: 'No such org' }, { status: 404 })
    }
    const orgData = (orgSnap.data() ?? {}) as any
    const billing = await readOrgBilling(orgId)
    // The org as it bills: the org document with its billing document over it.
    const merged = { ...orgData, ...billing } as any
    const previous = (orgData?.entitlements?.contract ?? null) as OrgContractTerms | null
    const baseMonthlyUsd = Number(billing?.subscription?.customMonthlyUsd ?? 0)

    const contracted = (org: unknown) => {
      const resolved = resolveOrgEntitlements(org as never) as unknown as Record<string, unknown>
      return Object.fromEntries(
        CONTRACTED_AMOUNT_KEYS.map((key) => [key, resolved[key] ?? null]),
      )
    }
    const asContract = (terms: OrgContractTerms | null) => ({
      ...merged,
      plan: 'enterprise',
      entitlements: { ...(merged.entitlements ?? {}), contract: terms ?? {} },
    })

    if (action === 'get') {
      const rates = resolveContractRates(previous?.rates)
      const resolved = readOrgContract(merged)
      return Response.json({
        stored: previous,
        rates,
        defaults: defaultContractRates(),
        additionKeys: CONTRACT_ADDITION_RATE_KEYS,
        usageKeys: CONTRACT_USAGE_RATE_KEYS,
        // Whether the terms are in force: Custom, on a live subscription.
        active: Boolean(resolved),
        usageCeilingMonthlyUsd: resolved?.usageCeilingMonthlyUsd ?? previous?.usageCeilingMonthlyUsd ?? null,
        baseMonthlyUsd: baseMonthlyUsd > 0 ? baseMonthlyUsd : null,
        contracted: contracted(asContract(previous)),
        check: checkContractRates(asContract(previous), rates),
      }, { status: 200 })
    }

    if (action === 'remove') {
      if (!previous) return Response.json({ ok: true, removed: false }, { status: 200 })
      await orgRef.update({
        'entitlements.contract': firebaseAdmin.firestore.FieldValue.delete(),
      })
      await addAdminAudit(firestore, {
        actorUid: decoded.uid,
        action: 'org.enterprise.contract.remove',
        target: `orgs/${orgId}`,
        before: { contract: previous },
        after: { contract: null },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true, removed: true }, { status: 200 })
    }

    const parsed = parseContractTerms(body?.contract ?? {}, {
      previous,
      baseMonthlyUsd,
      setBy: decoded.uid,
    })
    if (!parsed.ok) {
      return Response.json({ error: parsed.error, code: 'invalid_contract' }, { status: 400 })
    }
    // THE GUARD (AGL-4233): every rate clears cost + 30% at full use, on this
    // org's own contracted bands, or nothing is written.
    const check = checkContractRates(asContract(parsed.terms), parsed.rates)
    if (!check.ok) {
      return Response.json(
        {
          error: `These rates are under the contract floor: ${describeContractRateFailures(check)}.`,
          code: 'contract_rate_floor',
          check,
        },
        { status: 400 },
      )
    }

    await orgRef.update({ 'entitlements.contract': parsed.terms })
    const meteredItem = parsed.terms.usageBilling
      ? await ensureMeteredItem(orgId, billing.stripeCustomerId as string | undefined)
      : null
    await addAdminAudit(firestore, {
      actorUid: decoded.uid,
      action: 'org.enterprise.contract',
      target: `orgs/${orgId}`,
      before: { contract: previous },
      after: { contract: parsed.terms },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    return Response.json(
      {
        ok: true,
        stored: parsed.terms,
        rates: parsed.rates,
        check,
        ...(meteredItem ? { meteredItem } : {}),
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Contract request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
