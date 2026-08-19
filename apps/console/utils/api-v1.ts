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

/**
 * Auth + gating for the customer REST API (`/api/v1`, AGL-617). Resolves a
 * Bearer API key to its org, enforces the `apiAccess` entitlement and a
 * per-key rate limit, and hands resource handlers a ready `ApiV1Context`.
 * This path is deliberately separate from the console session chokepoint
 * (verifyConsoleIdToken / email-verify) — API keys, not Firebase sessions.
 */
import type { AglynOrganization } from '@aglyn/aglyn'
import {
  apiRequestEnforcementShape,
  checkApiRequestQuota,
  checkEntitlement,
} from '@aglyn/aglyn/server'
import {
  ApiErrors,
  type ApiScope,
  consumeRateLimit,
  firebaseAdmin,
  getOrgDoc,
  lockdownRefusal,
  rateLimitHeaders,
  verifyApiKey,
  withResponseHeaders,
} from '@aglyn/tenant-data-admin'

export interface ApiV1Context {
  orgId: string
  keyId: string
  scopes: ApiScope[]
  org: Partial<AglynOrganization>
  firestore: FirebaseFirestore.Firestore
  /** Rate-limit headers to echo on every response for this request. */
  headers: Record<string, string>
}

/** `Authorization: Bearer <key>` (preferred) or `X-Api-Key: <key>`. */
function extractToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return (request.headers.get('x-api-key') ?? '').trim()
}

/** Current billing month key, `YYYY-MM`, matching the usage rollup. */
export function apiUsageMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Fire-and-forget monthly API-request counter (AGL-635). One increment per
 * authenticated request on `orgs/{orgId}/apiUsage/{YYYY-MM}.count` — the
 * durable meter the monthly rollup reads and bills overage from — a separate
 * concern from the per-minute rate limiter above, which counts requests to
 * refuse them rather than to bill them. Never blocks or fails the request;
 * single-doc contention is fine at the rate-limit volume, sharding is a later
 * option.
 */
function recordApiRequest(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): void {
  const month = apiUsageMonth()
  void firestore
    .collection('orgs')
    .doc(orgId)
    .collection('apiUsage')
    .doc(month)
    .set(
      {
        count: firebaseAdmin.firestore.FieldValue.increment(1),
        month,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => undefined)
}

/**
 * Enforce `checkApiRequestQuota(...).allowed` — the field nobody read
 * (AGL-2163).
 *
 * COSTS A PAYING CUSTOMER NOTHING, AND CANNOT REFUSE ONE. Business, Advanced
 * and Agency carry an `extraApiRequestsUsdPer1k` rate and Enterprise carries
 * an unlimited band, so every plan that has the API at all resolves to
 * `'never-blocks'`: this returns `null` immediately, with no extra read and
 * no possible refusal, and the overage keeps metering onto the invoice
 * exactly as `checkApiRequestQuota`'s docblock promises. Cutting a paying
 * integration off mid-month is the failure this must not introduce, and the
 * shape check is what guarantees it cannot.
 *
 * The other shapes are reachable only through a staff
 * `entitlementOverrides` that grants `apiAccess` without a matching band, and
 * only they pay the one extra read — of the SAME `apiUsage/{month}` document
 * this file already writes on every request, so the count enforced is exactly
 * the count billed.
 */
async function refuseIfApiQuotaExhausted(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: Partial<AglynOrganization>,
  headers: Record<string, string>,
): Promise<Response | null> {
  const shape = apiRequestEnforcementShape(org as never)
  if (shape === 'never-blocks') return null
  if (shape === 'always-blocks') {
    return ApiErrors.planRequired({ headers })
  }
  const usage = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('apiUsage')
    .doc(apiUsageMonth())
    .get()
  const quota = checkApiRequestQuota(org as never, Number(usage.get('count') ?? 0))
  if (quota.allowed) return null
  // 429, not 403: the budget is exhausted for the MONTH, not the plan, and
  // `Retry-After` is the only honest thing to say to an integration — the
  // same posture the per-minute limiter above takes. Seconds to the UTC month
  // boundary, matching the counter's own key.
  const now = new Date()
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return ApiErrors.rateLimited(
    Math.max(1, Math.ceil((nextMonth - now.getTime()) / 1000)),
    headers,
  )
}

/**
 * Authenticate a v1 request. Returns an `ApiV1Context` on success, or an
 * error `Response` (401 unknown key, 403 plan required, 429 rate limited)
 * to return as-is.
 */
export async function authenticateApiV1(
  request: Request,
): Promise<{ context: ApiV1Context } | Response> {
  const token = extractToken(request)
  if (!token) return ApiErrors.unauthorized()

  const verified = await verifyApiKey(token)
  if (!verified) return ApiErrors.unauthorized()

  // From here the key is known, so the rate-limit budget is knowable — and a
  // client that reads it off every response shouldn't lose it on exactly the
  // errors it retries (AGL-900). Consume the budget before the entitlement
  // check so an unentitled key can't poll `plan_required` for free.
  //
  // DURABLE, not the in-process `checkRateLimit` this used to call (AGL-1679).
  // The per-instance counter resets on every cold start and each concurrent
  // instance keeps its own, so the enforced ceiling was `120 × warm instances`
  // — a number that moves with our traffic, not the customer's. That is a
  // billed product surface: `apps/docs/api/rate-limits.md` publishes 120/min
  // per key as the number an integration plans against, and the same key could
  // be throttled at 120 or at 600 depending on how the fleet happened to be
  // scaled. RATE_LIMITING.md's cost objection (a transaction per call) is the
  // right one for an analytics beacon and the wrong one here: every request on
  // this path already does a key lookup, an org read and a usage write, so one
  // more transaction is proportionate to what the request costs anyway.
  //
  // Defaults are DEFAULT_RATE_LIMIT / DEFAULT_RATE_WINDOW_MS — the documented
  // 120 per fixed minute. Namespaced key so a key id can never collide with
  // another durable limiter's bucket.
  //
  // Fails SOFT, deliberately: on a Firestore error this falls back to the same
  // per-instance counter it used to be. A hard failure here would convert one
  // Firestore blip into a simultaneous outage of every customer integration,
  // and the degradation is customer-favourable — the fallback budget starts
  // empty, so a degraded window can only ever allow MORE than 120/min, never
  // fewer. `degraded` is recorded durably by the store itself.
  const rate = await consumeRateLimit(`apiv1:${verified.keyId}`)
  const headers = rateLimitHeaders(rate)
  if (!rate.allowed) {
    return ApiErrors.rateLimited(
      Math.ceil((rate.resetMs - Date.now()) / 1000),
      headers,
    )
  }

  const org = await getOrgDoc(verified.orgId)
  if (!org) return ApiErrors.unauthorized({ headers })
  // Lockdown verdict (AGL-1506) at the one chokepoint every /v1 request
  // passes through, so the whole customer REST API answers a distinct 423
  // under a lock instead of resource-level mystery errors. The org doc is
  // already in hand (no extra read) and the platform read is TTL-cached.
  // An API key is an ORG credential: no uid (no user scope to evaluate)
  // and no staff bypass — staff lift locks with their console session, not
  // with a customer's API key.
  //
  // The refusal itself is built by a helper shared with ~36 console routes
  // and the session mint, none of which have a rate-limit budget to report,
  // so it carries only `Cache-Control` and `Retry-After`. Merge this key's
  // budget back on here rather than teaching that helper about API v1
  // (AGL-1596): the 423 is the response a client is MOST likely to retry on
  // a schedule — it ships a `Retry-After` telling it when — so dropping the
  // budget here is worse than the 401/403 case AGL-900 fixed.
  // READ-ONLY discrimination (AGL-1511) is derived from the METHOD here and
  // nowhere else in v1: this authenticator is the single door every
  // resource handler comes through, and the REST verbs are exactly the
  // signal — a customer's GET keeps working while their POST/PATCH/DELETE
  // gets the 423 with a `Retry-After`, which is the contract an integration
  // can actually back off on. A full lock still refuses both.
  const locked = await lockdownRefusal({ request, org })
  if (locked) return withResponseHeaders(locked, headers)
  if (!checkEntitlement(org, 'apiAccess')) {
    return ApiErrors.planRequired({ headers })
  }

  const firestore = firebaseAdmin.app().firestore()
  // Monthly request quota (AGL-2163). `checkApiRequestQuota(...).allowed`
  // existed, was documented as "plans without API access have `included: 0`
  // and always block", was listed in `free-tier-never-billed.spec.ts` as one
  // of free's runtime braces — and had NO READER anywhere in the platform.
  // The only call site was `/api/billing/report-usage`, which takes
  // `overageMonthlyUsd` and ignores `allowed`. So nothing refused.
  //
  // The `apiAccess` gate above hid it: on every shipping plan, having API
  // access and having a non-zero `apiRequestsPerMonth` are the same fact. A
  // per-org `features.apiAccess` override separates them, and then a key on a
  // plan with a zero band ran unbounded, uncapped and unbilled.
  //
  // This is the same chokepoint the lockdown verdict and the entitlement use,
  // for the same reason: every /v1 request comes through here exactly once.
  // Placed AFTER `apiAccess` so an unentitled key still gets the
  // `plan_required` it always got, and BEFORE `recordApiRequest` so a refused
  // request is not metered — matching that function's own contract.
  const quotaRefusal = await refuseIfApiQuotaExhausted(
    firestore,
    verified.orgId,
    org,
    headers,
  )
  if (quotaRefusal) return quotaRefusal
  // Meter the request for the monthly usage rollup (AGL-635). Fire-and-forget:
  // billing is a background reconcile, so a lost increment never blocks the
  // caller. Counted only after auth + rate-limit pass, so refused requests
  // (401/403/429) are not billed.
  recordApiRequest(firestore, verified.orgId)

  return {
    context: {
      orgId: verified.orgId,
      keyId: verified.keyId,
      scopes: verified.scopes,
      org,
      firestore,
      headers,
    },
  }
}

/** Return a 403 unless the key carries `scope`; otherwise `null` (proceed). */
export function requireScope(
  context: ApiV1Context,
  scope: ApiScope,
): Response | null {
  return context.scopes.includes(scope)
    ? null
    : ApiErrors.insufficientScope(scope, context.headers)
}
