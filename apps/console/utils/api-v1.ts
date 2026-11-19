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
 * Bearer API key — or a connector's access token (AGL-4225) — to its org,
 * enforces the `apiAccess` entitlement and a per-credential rate limit, and
 * hands resource handlers a ready `ApiV1Context`. This path is deliberately
 * separate from the console session chokepoint (verifyConsoleIdToken /
 * email-verify) — API credentials, not Firebase sessions.
 */
import type { AglynOrganization } from '@aglyn/aglyn'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import {
  apiRequestEnforcementShape,
  checkApiRequestQuota,
  checkEntitlement,
} from '@aglyn/aglyn/server'
// The two AGL-4226 readers, from their module: the pipeline's specs stand
// `@aglyn/aglyn/server` in with a hand-picked subset, and these answer from
// the catalog with no I/O, so there is nothing for a spec to stand in for.
import {
  apiMonthlyRefusalMessage,
  apiRequestBillingUnits,
  apiWorkspaceRateLimitPerMinute,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  ApiErrors,
  type ApiScope,
  checkRateLimit,
  consumeRateLimit,
  firebaseAdmin,
  getOrgDoc,
  isValidApiKeyFormat,
  lockdownRefusal,
  peekRateLimit,
  type RateLimitState,
  rateLimitHeaders,
  verifyApiKey,
  withResponseHeaders,
} from '@aglyn/tenant-data-admin'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'
// By module path rather than the barrel: the connector door is resolved
// beside the key door here, and the specs that stand the barrel in for
// `/api/v1` name only the key half.
import {
  CONNECTOR_ACCESS_TOKEN_PREFIX,
  isConnectorAccessTokenFormat,
} from '@aglyn/tenant-data-admin/server/connector-oauth'
import {
  CONNECTOR_TOKEN_UNAVAILABLE,
  verifyConnectorAccessToken,
} from '@aglyn/tenant-data-admin/server/connector-oauth-store'
import { isValidApiKeyFormat as isApiKeyShaped } from '@aglyn/tenant-data-admin/server/api-keys'
import { createHash } from 'node:crypto'

/**
 * What the pipeline resolved for one request, and the scope check every
 * handler asks — the data layer's (AGL-3080), where a plugin's `/v1`
 * resource reaches them too.
 */
export { type ApiV1Context, requireScope } from '@aglyn/tenant-data-admin/server/api-v1-kit'

/** What either credential resolves to before the shared gates run. */
interface VerifiedCredential {
  orgId: string
  keyId: string
  scopes: ApiScope[]
  name: string
  /**
   * The person a connector acts for (AGL-4225), so the user-scope lockdown
   * applies to their calls. Absent for an API key, which is an organization
   * credential with no person behind it.
   */
  uid?: string
}

/**
 * Resolve a bearer credential: an API key (`aglyn_sk_…`) or a connector's
 * hourly access token (`aglyn_at_…`, AGL-4225).
 *
 * The ONLY place the two differ. Everything after this — the pre-auth budget
 * charge, the per-credential rate limit, the lockdown verdict, the plan, the
 * monthly quota and the usage meter — runs once, below, for whichever one
 * arrived. `lookedUp()` says whether a Firestore read was spent, which is
 * what the pre-auth budget charges for; a malformed token of either kind is
 * free. Asked only on a refusal, as the format check always was.
 */
async function verifyCredential(token: string): Promise<{
  verified: VerifiedCredential | null
  lookedUp: () => boolean
  /** A read failed: nothing is known about the credential either way. */
  unavailable?: boolean
}> {
  if (token.startsWith(CONNECTOR_ACCESS_TOKEN_PREFIX)) {
    const answer = await verifyConnectorAccessToken(token)
    if (answer === CONNECTOR_TOKEN_UNAVAILABLE) {
      return { verified: null, lookedUp: () => false, unavailable: true }
    }
    return { verified: answer, lookedUp: () => isConnectorAccessTokenFormat(token) }
  }
  return { verified: await verifyApiKey(token), lookedUp: () => isValidApiKeyFormat(token) }
}

/**
 * What this instance has already learned about credentials, by hash
 * (AGL-4225). Memory only, bounded, and short-lived.
 *
 * The pre-auth budget is per client ADDRESS, and an app such as Claude calls
 * from a provider's shared egress addresses — so without these, one tenant's
 * integration retrying a dead token could spend the budget every other
 * tenant behind the same address needs. They change who PAYS, never what is
 * read:
 *
 *  - A credential that resolved to nothing is refused again for free — no
 *    read, no charge — so a client hammering one dead token cannot drain the
 *    shared budget. Dead stays dead: a revoked, expired or ended credential
 *    never comes back, and a token cannot be minted to a chosen hash.
 *  - A credential that resolved on this instance is not refused by an
 *    exhausted budget; it is still looked up and checked on every call, and
 *    the first time it fails it moves to the dead set. That lookup is
 *    bounded by credentials that were once valid, so it is no amplifier.
 *
 * A read that FAILED teaches nothing and lands in neither set.
 */
const CREDENTIAL_MEMORY_LIMIT = 5_000
const CREDENTIAL_MEMORY_TTL_MS = 10 * 60_000
const knownGoodCredentials = new Map<string, number>()
const knownDeadCredentials = new Map<string, number>()

function remember(memory: Map<string, number>, hash: string, now = Date.now()): void {
  memory.delete(hash)
  memory.set(hash, now + CREDENTIAL_MEMORY_TTL_MS)
  while (memory.size > CREDENTIAL_MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

function recalls(memory: Map<string, number>, hash: string | null, now = Date.now()): boolean {
  if (!hash) return false
  const until = memory.get(hash)
  if (until === undefined) return false
  if (until <= now) {
    memory.delete(hash)
    return false
  }
  return true
}

/** The memory key for a credential; `null` for one no lookup would be spent on. */
function credentialHash(token: string): string | null {
  const lookable = token.startsWith(CONNECTOR_ACCESS_TOKEN_PREFIX)
    ? isConnectorAccessTokenFormat(token)
    : isApiKeyShaped(token)
  return lookable ? createHash('sha256').update(token).digest('hex') : null
}

/** `Authorization: Bearer <key>` (preferred) or `X-Api-Key: <key>`. */
function extractToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return (request.headers.get('x-api-key') ?? '').trim()
}

/**
 * How many *unproductive* key lookups one client IP may spend per window
 * (AGL-2414).
 *
 * ## What was uncapped
 *
 * `verifyApiKey` short-circuits on `isValidApiKeyFormat` before touching
 * Firestore, so junk is genuinely free. But the token prefix is published in
 * the docs and the suffix is any 24+ `[A-Za-z0-9_-]`, so anyone can mint an
 * unlimited supply of tokens that *look* like keys — and each one cost one
 * Firestore document read, unauthenticated, from anywhere, with nothing in
 * front of it. The per-key `consumeRateLimit` below cannot help: it needs an
 * identity to key on, and the whole point of these requests is that they
 * resolve to none. The route is `force-dynamic`, so there is no edge cache
 * either. Measured 401 latency was flat across a burst — no throttling at any
 * layer.
 *
 * ## Why the budget only charges FAILURES
 *
 * Charging every pre-auth request would put a second, IP-shaped cap in front
 * of a billed product surface, and `apps/docs/api/rate-limits.md` promises
 * exactly one: 120/min *per key*. Two integrations behind one corporate NAT
 * would then throttle each other on a limit neither can see in any header.
 * Charging only the lookups that came back EMPTY makes this budget mean one
 * narrow thing — "wasted Firestore reads from this IP" — which is the defect
 * AGL-2414 describes and nothing else. A healthy integration's keys resolve,
 * so it contributes zero and can never be refused by its own traffic.
 *
 * ## The number
 *
 * 60 per minute is one wasted read per second, sustained, per IP. Above that
 * an IP is either attacking or has a client looping on a key that no longer
 * exists, and a `429` with `Retry-After` is the right answer to both. The
 * residual cost, stated plainly: while an IP is over budget, a request from
 * that same IP carrying a VALID key is refused too, because the only way to
 * know it was valid is the read this is declining to spend. Confined to that
 * IP and to the remainder of a fixed 60-second window.
 *
 * ## Per-instance ON PURPOSE — the opposite call to AGL-1679
 *
 * AGL-1679 moved the per-key limit to a durable counter because a
 * per-instance cap is not a real ceiling. That reasoning does not transfer:
 * the durable counter costs a Firestore write plus a read, so spending one to
 * avoid a single read would make this a *net amplifier* of the exact cost it
 * exists to bound. `checkRateLimit` for volume, `consumeRateLimit` for
 * consequence — this is volume. The bound is therefore per instance, and a
 * caller wide enough to be answered by many instances gets `60 × instances`.
 * That is still a bound where there was none, and it holds without spending
 * anything on the unauthenticated path.
 */
export const PREAUTH_LOOKUP_LIMIT = 60

/** Window for {@link PREAUTH_LOOKUP_LIMIT}, fixed, matching the per-key one. */
export const PREAUTH_LOOKUP_WINDOW_MS = 60_000

/**
 * Per-instance store for the pre-auth budget. Module-scoped and private: it
 * must never share the module-level default store with `checkRateLimit`'s
 * other callers, or an `errors:{ip}` bucket and an `apiv1-preauth:{ip}`
 * bucket could be made to collide.
 */
const preAuthLookups = new Map<string, RateLimitState>()

/** Test seam: forget this instance's pre-auth budget. */
export function resetPreAuthLookupBudgetForTests(): void {
  preAuthLookups.clear()
  knownGoodCredentials.clear()
  knownDeadCredentials.clear()
}

/**
 * The pre-auth budget's key: the shared client-address reader, so this
 * control keys on the same hop every limiter in the product does and is
 * exactly as trustworthy as they are rather than a new assumption.
 *
 * Falls back to the no-address bucket rather than being skipped. This budget
 * bounds READ AMPLIFICATION — work a stranger can cause before anyone has
 * authenticated — so leaving it off where no address is readable would remove
 * the bound on precisely the deployment that could not name its callers.
 * Sharing one bucket over-counts (refuses sooner) rather than handing each
 * caller a fresh budget, which is the safe direction to be wrong in. It is
 * reached only when no source produced an address at all.
 */
function clientIpKey(request: Request): string {
  return readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
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
  units = 1,
): void {
  const month = apiUsageMonth()
  void firestore
    .collection('orgs')
    .doc(orgId)
    .collection('apiUsage')
    .doc(month)
    .set(
      {
        count: firebaseAdmin.firestore.FieldValue.increment(units),
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
  //
  // The body names WHICH monthly limit refused (AGL-4226): Starter's ceiling
  // (`monthly_request_ceiling`, and the plan without one), or the band of a
  // plan that sells nothing past it (`monthly_request_quota`).
  return ApiErrors.rateLimited(
    Math.max(1, Math.ceil((nextMonth - now.getTime()) / 1000)),
    headers,
    {
      code:
        quota.refusedBy === 'ceiling'
          ? 'monthly_request_ceiling'
          : 'monthly_request_quota',
      message: apiMonthlyRefusalMessage(org as never, quota),
    },
  )
}

/** The `X-RateLimit-Scope` a response's `RateLimit-*` headers describe (AGL-4226). */
const RATE_LIMIT_SCOPE_HEADER = 'X-RateLimit-Scope'

/** The workspace's per-minute budget, beside the key's (AGL-4226). */
function workspaceRateLimitHeaders(
  result: { limit: number; remaining: number; resetMs: number },
): Record<string, string> {
  return {
    'X-Workspace-RateLimit-Limit': String(result.limit),
    'X-Workspace-RateLimit-Remaining': String(result.remaining),
    'X-Workspace-RateLimit-Reset': String(Math.ceil(result.resetMs / 1000)),
  }
}

/**
 * The WORKSPACE's per-minute limit (AGL-4226), across every key and every
 * connection — `/v1` and `/api/mcp` both come through `authenticateApiV1`.
 *
 * The per-key 120/min was the only bound, and creating a key costs nothing,
 * so one workspace could hold N keys and make N × 120 requests a minute. This
 * is the ceiling over all of them, sized by plan
 * (`apiWorkspaceRateLimitPerMinute`: Starter 120, Pro 600, Custom by
 * agreement) — and it is an upgrade reason, so it is an entitlement rather
 * than a constant.
 *
 * DURABLE, like the per-key limiter and for its reason: a per-instance count
 * multiplies by the warm fleet. Fails soft the same way. An `UNLIMITED`
 * workspace spends no transaction at all.
 *
 * Returns the headers to merge onto every response, and the refusal when the
 * workspace is over. A refusal's `RateLimit-*` describe THIS budget, and
 * `X-RateLimit-Scope: workspace` says so — the key's budget is not what
 * refused, and reporting it would tell the client it had room it does not.
 */
async function consumeWorkspaceRateLimit(
  orgId: string,
  org: Partial<AglynOrganization>,
  keyHeaders: Record<string, string>,
): Promise<{ headers: Record<string, string>; refusal: Response | null }> {
  const limit = apiWorkspaceRateLimitPerMinute(org as never)
  if (!Number.isFinite(limit)) return { headers: {}, refusal: null }
  const rate = await consumeRateLimit(`apiv1-org:${orgId}`, { limit })
  const headers = workspaceRateLimitHeaders(rate)
  if (rate.allowed) return { headers, refusal: null }
  return {
    headers,
    refusal: ApiErrors.rateLimited(
      Math.ceil((rate.resetMs - Date.now()) / 1000),
      {
        ...keyHeaders,
        ...rateLimitHeaders(rate),
        ...headers,
        [RATE_LIMIT_SCOPE_HEADER]: 'workspace',
      },
      {
        code: 'workspace_rate_limit',
        message:
          `This workspace has made ${limit} API requests in the last minute across all of ` +
          'its keys, the most its plan allows.',
      },
    ),
  }
}

/**
 * Charge one MORE request to an already-authenticated credential (AGL-4225).
 *
 * `authenticateApiV1` charges a request once: one rate-limit unit, one usage
 * count. An MCP batch is one HTTP request that can carry many `tools/call`
 * messages, each a full `/v1` dispatch, so every call after the first is
 * charged here as its own request — the same per-credential limit, the same
 * monthly quota, the same meter — and refused, as itself, when the budget is
 * spent. Answers the refusal to report for that one call, or `null`, and the
 * rate-limit headers as they stand after this charge.
 */
export async function chargeApiV1Call(
  context: ApiV1Context,
): Promise<{ refusal: Response | null; headers: Record<string, string> }> {
  const rate = await consumeRateLimit(`apiv1:${context.keyId}`)
  // The same two per-minute limits and the same scoped headers and codes as
  // `authenticateApiV1` (AGL-4226): the key's, then the WORKSPACE's, so a
  // batch of tool calls cannot go round the workspace ceiling.
  let headers: Record<string, string> = {
    ...rateLimitHeaders(rate),
    [RATE_LIMIT_SCOPE_HEADER]: 'key',
  }
  if (!rate.allowed) {
    return {
      refusal: ApiErrors.rateLimited(Math.ceil((rate.resetMs - Date.now()) / 1000), headers, {
        code: 'key_rate_limit',
        message: `This API key has made ${rate.limit} requests in the last minute.`,
      }),
      headers,
    }
  }
  const workspace = await consumeWorkspaceRateLimit(context.orgId, context.org, headers)
  if (workspace.refusal) return { refusal: workspace.refusal, headers }
  headers = { ...headers, ...workspace.headers }
  const quotaRefusal = await refuseIfApiQuotaExhausted(context.firestore, context.orgId, context.org, headers)
  if (quotaRefusal) return { refusal: quotaRefusal, headers }
  recordApiRequest(context.firestore, context.orgId)
  return { refusal: null, headers }
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

  // AGL-2414: bound the read amplification BEFORE spending the read. See
  // PREAUTH_LOOKUP_LIMIT for why this budget is IP-keyed, per-instance, and
  // charged only on lookups that resolve to nothing.
  const budgetKey = `apiv1-preauth:${clientIpKey(request)}`
  const budgetOptions = {
    limit: PREAUTH_LOOKUP_LIMIT,
    windowMs: PREAUTH_LOOKUP_WINDOW_MS,
    store: preAuthLookups,
  }
  const budget = peekRateLimit(budgetKey, budgetOptions)
  // See `knownGoodCredentials` for why recalling a credential is safe.
  const hash = token ? credentialHash(token) : null
  if (recalls(knownDeadCredentials, hash)) {
    return ApiErrors.unauthorized({ headers: rateLimitHeaders(budget) })
  }
  if (!budget.allowed && !recalls(knownGoodCredentials, hash)) {
    /*
      The headers describe THIS budget — the per-IP lookup budget — and not the
      120/min of a key we declined to identify (AGL-2727).

      That distinction is the whole of it. Publishing a per-key budget on an
      anonymous refusal would be a number about nobody, which is why this
      carried nothing at all for a long time. But the caller IS being limited,
      by a real limit, on a counter its own requests moved — and telling it
      "you are rate limited" while withholding the budget that says so leaves
      it guessing at exactly the moment it wanted to back off.
    */
    return ApiErrors.rateLimited(
      Math.max(1, Math.ceil((budget.resetMs - Date.now()) / 1000)),
      rateLimitHeaders(budget),
    )
  }

  /*
    No credential at all spends no lookup — there is nothing to look up — so
    this is refused without charging the budget. It still REPORTS the budget:
    the limit applies to this caller the moment it sends a real key, and a
    client discovering the API is exactly the one that benefits from learning
    the shape of the limit before it starts guessing.
  */
  if (!token) {
    return ApiErrors.unauthorized({ headers: rateLimitHeaders(budget) })
  }

  const { verified, lookedUp, unavailable } = await verifyCredential(token)
  if (unavailable) {
    // A read failed while resolving the credential (AGL-4225). Not a 401 —
    // nothing says the credential is bad, and a 401 would send the client
    // off to sign in again — and not charged to the address either.
    return ApiErrors.unavailable(5, rateLimitHeaders(budget))
  }
  if (!verified) {
    if (hash) {
      knownGoodCredentials.delete(hash)
      remember(knownDeadCredentials, hash)
    }
    // `lookedUp` is the same format predicate the verifier short-circuits
    // on, so this charges the budget when — and only when — a Firestore read
    // was actually spent. A malformed token cost nothing and is charged
    // nothing; making it free is what keeps this budget a truthful count of
    // reads rather than a second, undocumented request cap.
    if (lookedUp()) checkRateLimit(budgetKey, budgetOptions)
    /*
      Peeked AFTER the charge above, so `remaining` is what the caller has
      left rather than what it had on arrival — a budget read that ignores the
      request reporting it is off by one at precisely the moment it matters.
      Again the per-IP budget, never the per-key one.
    */
    return ApiErrors.unauthorized({
      headers: rateLimitHeaders(peekRateLimit(budgetKey, budgetOptions)),
    })
  }

  if (hash) remember(knownGoodCredentials, hash)

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
  // `X-RateLimit-Scope` (AGL-4226): the `RateLimit-*` headers describe the
  // KEY's budget on every response but a workspace refusal.
  let headers: Record<string, string> = {
    ...rateLimitHeaders(rate),
    [RATE_LIMIT_SCOPE_HEADER]: 'key',
  }
  if (!rate.allowed) {
    return ApiErrors.rateLimited(
      Math.ceil((rate.resetMs - Date.now()) / 1000),
      headers,
      { code: 'key_rate_limit', message: `This API key has made ${rate.limit} requests in the last minute.` },
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
  //
  // A connector DOES act for a person (AGL-4225), so its uid rides along and
  // a lock on that person refuses their app exactly as it refuses their
  // console. Still no staff bypass: a connection is never a staff session.
  const locked = await lockdownRefusal({
    request,
    org,
    ...(verified.uid ? { uid: verified.uid } : {}),
  })
  if (locked) return withResponseHeaders(locked, headers)
  if (!checkEntitlement(org, 'apiAccess')) {
    return ApiErrors.planRequired({ headers })
  }

  // The workspace's own per-minute limit (AGL-4226), after the entitlement so
  // a workspace without the API spends no transaction on it, and before the
  // monthly quota and the meter so a refused request is neither read against
  // the month nor billed.
  const workspace = await consumeWorkspaceRateLimit(verified.orgId, org, headers)
  if (workspace.refusal) return workspace.refusal
  headers = { ...headers, ...workspace.headers }

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
      keyName: verified.name || null,
      // Only a connection carries a person (AGL-4225).
      credential: verified.uid ? 'connected_app' : 'api_key',
      // The person that connection acts for (AGL-4235), which a site's own
      // permissions and lock are read against. An API key has none.
      ...(verified.uid ? { uid: verified.uid } : {}),
      scopes: verified.scopes,
      org,
      firestore,
      headers,
      // Imported on first use: the loader builds the console's plugin
      // manifest, which only a write against a custom field type needs.
      loadPluginSurfaces: async () => {
        const { serverPluginLoader } = await import('./server-plugin-loader')
        await serverPluginLoader.ensureAll(['consoleApi'])
      },
    },
  }
}


/** The header that says how many billed units a response was charged (AGL-4227). */
export const API_BILLING_UNITS_HEADER = 'X-Api-Billing-Units'

/**
 * The byte length of a request's body, read WITHOUT consuming it (AGL-4227):
 * `Content-Length` when the client sent a valid one, otherwise the body
 * itself, read from a clone. A method without a body is 0.
 */
export async function apiRequestBodyBytes(request: Request): Promise<number> {
  if (request.method === 'GET' || request.method === 'HEAD') return 0
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared >= 0 && request.headers.has('content-length')) {
    return declared
  }
  try {
    return (await request.clone().arrayBuffer()).byteLength
  } catch {
    return 0
  }
}

/** A response body's byte length, read from a clone so the body still streams. */
export async function apiResponseBodyBytes(response: Response): Promise<number> {
  if (!response.body) return 0
  try {
    return (await response.clone().arrayBuffer()).byteLength
  } catch {
    return 0
  }
}

/**
 * Charge a served request its SIZE (AGL-4227): one billed unit per started
 * 256 KB of the larger of its request and response body
 * (`apiRequestBillingUnits`). The pipeline already counted the call's first
 * unit before the handler ran, so only the units past it are added — onto the
 * same monthly counter the invoice, the ceiling and the usage meter read. The
 * per-minute limits are not touched: they count calls.
 *
 * `alreadyCharged` is how many of this request's units are on the counter
 * already: 1 for a REST call; for an MCP batch, 1 for the first tool call and
 * 0 for every one after it, since the POST carrying them counted once.
 *
 * Returns the units the request came to, for the response header.
 */
export function chargeApiRequestSize(
  context: Pick<ApiV1Context, 'firestore' | 'orgId'>,
  requestBytes: number,
  responseBytes: number,
  alreadyCharged = 1,
): number {
  const units = apiRequestBillingUnits(requestBytes, responseBytes)
  const extra = units - Math.max(0, alreadyCharged)
  if (extra > 0) recordApiRequest(context.firestore, context.orgId, extra)
  return units
}
