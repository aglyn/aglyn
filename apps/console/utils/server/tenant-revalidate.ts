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
 * The one place the console asks a tenant deployment to drop cached pages
 * (AGL-2462).
 *
 * Extracted rather than copied. `POST /v1/sites/{siteId}/publish` needs the
 * exact request `/api/screens/revalidate` already sends — same secret header,
 * same `{ host, hostId, paths }` body, same timeout — and a second hand-rolled
 * copy is how the two would come to disagree about the field that matters.
 * `hostId` is that field: it is what busts `tenant-data:{hostId}`, and a caller
 * that forgets it gets pages that faithfully regenerate from the cached
 * datasets, routing map and version pointers the publish just replaced
 * (AGL-1302). Making it a required parameter here means no caller can omit it
 * by accident.
 *
 * The tenant treats this secret as a cache hint rather than an authorization
 * boundary — its own docblock says so, and bounds what the call can do to one
 * host's cached HTML. Both callers therefore do the real authorization check
 * BEFORE reaching here: the console route with `mayRevalidate` (host role
 * `admin`/`editor`), the API with the `sites:publish` scope plus an org-owns-
 * host check.
 */

/**
 * The apex comes from `TENANT_APEX`, never re-derived here (AGL-2195).
 *
 * `TENANT_APEX` is the one reader of `NEXT_PUBLIC_TENANT_DOMAIN`. Reading that
 * variable again here, with our own apex as the literal default, is how the
 * four hand-rolled copies the ratchet exists to prevent got in — and the
 * extraction this module IS carried one across from the console route it
 * replaced. A self-hoster who sets the variable must not end up with a console
 * that posts its revalidation at OUR apex: that is a cache-drop which never
 * lands on their pages, and an unsolicited request to a host they do not own.
 */
import { TENANT_APEX, screenRoutePathToUrl } from '@aglyn/aglyn/server'
import type { Firestore } from 'firebase-admin/firestore'

/** A publish should feel instant; a slow tenant must not hold the caller. */
const TIMEOUT_MS = 5000

/**
 * ONE attempt was the whole propagation guarantee, and that is what broke
 * (AGL-2573).
 *
 * From 2026-08-21 to 2026-09-01 the tenant's bot protection answered this call
 * with 429 before the route ran, so every publish on the platform waited out
 * the document TTL — an hour — for eleven days. A firewall bypass rule closed
 * that particular door, but the shape of the defect is not the firewall: it is
 * that a single transient refusal ended the only mechanism that makes a
 * publish visible. 429 and 5xx are the definition of "ask again in a moment",
 * and this asked once.
 *
 * Retried under a TOTAL deadline rather than a per-attempt count, because the
 * failure that matters is a tenant that is slow rather than one that answers
 * quickly: three 5s timeouts back to back would hold the publish response for
 * fifteen seconds, which trades one visible failure for a worse one. The
 * budget bounds the whole exchange, both calls of a custom-domain drop
 * included, and an attempt is simply not started once it has run out.
 */
const MAX_ATTEMPTS = 3

/** Backoff before attempts 2 and 3. Short: a person is waiting on this. */
const RETRY_BACKOFF_MS = [150, 400]

/**
 * The ceiling on everything `postTenantRevalidate` does. Chosen against the
 * publish response it sits inside: long enough for two retries of a tenant
 * that is briefly refusing, short enough that a tenant that is genuinely down
 * costs the editor a noticeable pause rather than a hang.
 */
const TOTAL_BUDGET_MS = 8000

/**
 * Worth asking again, or not.
 *
 * Deliberately narrow. A 401 means the secret is wrong and a 400 means the
 * payload is, and retrying either just spends the budget arriving at the same
 * answer three times. 429 is the outage that motivated this; 5xx and the two
 * timeout-shaped 4xx are the same "ask again" class.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

interface RevalidateAttempt {
  ok: boolean
  /** 0 when no response was received at all (network error or timeout). */
  status: number
  body: { revalidated?: unknown; truncated?: unknown } | null
  /** How many requests were actually sent, for the telemetry line. */
  attempts: number
}

/**
 * POST one drop to the tenant, retrying a retryable refusal until the shared
 * deadline. Never throws: a cache hint that could not be sent must not make a
 * completed publish look failed.
 */
async function sendRevalidate(options: {
  subdomain: string
  secret: string
  body: Record<string, unknown>
  deadline: number
}): Promise<RevalidateAttempt> {
  const { subdomain, secret, body, deadline } = options
  let last: RevalidateAttempt = { ok: false, status: 0, body: null, attempts: 0 }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadline - Date.now()
    // Out of budget: stop rather than send a request that cannot finish. The
    // first attempt is exempt so a caller can never end up sending nothing.
    if (attempt > 0 && remaining <= 0) break
    try {
      const response = await fetch(
        `https://${subdomain}.${TENANT_APEX}/api/revalidate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-revalidate-secret': secret,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(
            attempt === 0 ? TIMEOUT_MS : Math.max(1, Math.min(TIMEOUT_MS, remaining)),
          ),
        },
      )
      const parsed = (await response.json().catch(() => null)) as
        | RevalidateAttempt['body']
        | null
      last = {
        ok: response.ok,
        status: response.status,
        body: parsed,
        attempts: attempt + 1,
      }
      if (response.ok || !isRetryableStatus(response.status)) return last
    } catch (error) {
      // A network error and a timeout are both "no answer", which is exactly
      // the class worth asking again about.
      console.error('[tenant-revalidate] request failed', error)
      last = { ok: false, status: 0, body: null, attempts: attempt + 1 }
    }
    const backoff = RETRY_BACKOFF_MS[attempt]
    if (backoff === undefined) break
    if (Date.now() + backoff >= deadline) break
    await sleep(backoff)
  }
  return last
}

/**
 * ONE line per announce, on SUCCESS as well as failure (AGL-2573).
 *
 * Every other record this module keeps is a `console.error` on a failure
 * branch, which means a successful drop says nothing at all — and a log
 * search that finds nothing cannot tell "every publish worked" apart from
 * "the call never happened". That ambiguity is precisely how the eleven-day
 * outage went unnoticed: the evidence of health and the evidence of absence
 * were the same empty result.
 *
 * So the line is emitted unconditionally and carries `reason`, making the
 * volume itself the signal — a publish rate with no matching lines is a
 * broken hop, and a rising share of non-`ok` reasons is the outage starting.
 * One line per publish is a rate nobody has to budget for.
 */
function announceTelemetry(fields: {
  host: string
  hostId: string
  paths: number
  reason: TenantRevalidateResult['reason']
  attempts: number
  startedAt: number
  revalidated?: number
  pathsDropped?: number
}): void {
  const { startedAt, ...rest } = fields
  console.log(
    JSON.stringify({
      tag: 'AGL-2573:tenant-revalidate',
      ...rest,
      durationMs: Date.now() - startedAt,
    }),
  )
}

export interface TenantRevalidateResult {
  /** Cache keys the tenant reported dropping. */
  revalidated: string[]
  /**
   * Why the drop is not a plain success, or `'ok'`.
   *
   * `'not-configured'` when `REVALIDATE_SECRET` is unset — said out loud
   * rather than reported as a fast publish that is still slow, which is the
   * confusing half of the original bug (AGL-1150).
   */
  reason: 'ok' | 'not-configured' | `tenant-${number}` | 'error'
  /** The tenant's own `MAX_PATHS` overflow (AGL-1161), 0 when it took them all. */
  pathsDropped: number
}

/**
 * Ask the tenant deployment serving `subdomain` to drop `paths` and bust the
 * host's document-cache tag.
 *
 * Never throws and never returns a failed promise: a cache hint that could not
 * be sent must not make a completed publish look failed, and the ISR window is
 * still underneath it as the backstop.
 */
/**
 * A CUSTOM DOMAIN IS A SECOND CACHE KEY, and publishes were missing it
 * (AGL-1152).
 *
 * The tenant middleware rewrites `https://{host}{path}` to `/{tenantHost}{path}`
 * and THAT is what Next stores the page under. For a platform subdomain
 * `tenantHost` is the label (`acme`); for an attached custom domain it is the
 * `cname--acme.com` sentinel. The two are different keys for the same page.
 *
 * This helper only ever sent the subdomain, so on a site with a domain
 * attached a publish dropped `/acme/pricing` — a URL nobody visits — and left
 * `/cname--acme.com/pricing`, the one everybody does, serving the old page
 * until its ISR window expired on its own. Observed on `aglyn.com`: a
 * component published at 09:20 was still absent from the live page minutes
 * later, while the parent document already carried the change.
 *
 * The tag bust is unaffected either way — `tenant-data:{hostId}` is keyed on
 * the host id, which no domain changes — so the DATA was always fresh. It was
 * the HTML that was not, which is why the page looked stale while every
 * document behind it was correct.
 */
function cnameCacheHost(cname: string | undefined): string | undefined {
  const value = (cname ?? '').trim().toLowerCase()
  // The sentinel the middleware builds, and it must match byte for byte or the
  // drop lands on a key nothing reads.
  return value ? `cname--${value}` : undefined
}

export async function postTenantRevalidate(options: {
  /** The site's subdomain — the tenant keys its cache on it, not on `hostId`. */
  subdomain: string
  /** Required: without it no `tenant-data:{hostId}` tag is busted. */
  hostId: string
  /** Site-absolute paths (`/`, `/menu`). The tenant caps them at 250. */
  paths: string[]
  /**
   * The site's attached custom domain, when it has one. Pages served on it
   * live under a DIFFERENT cache key and are dropped by a second call — see
   * `cnameCacheHost`. Omitted for a site with no domain, which costs nothing.
   */
  cname?: string
}): Promise<TenantRevalidateResult> {
  const { subdomain, hostId, paths } = options
  const secret = process.env['REVALIDATE_SECRET']
  const startedAt = Date.now()
  if (!secret) {
    announceTelemetry({
      host: subdomain,
      hostId,
      paths: paths.length,
      reason: 'not-configured',
      attempts: 0,
      startedAt,
    })
    return { revalidated: [], reason: 'not-configured', pathsDropped: 0 }
  }

  // ONE budget for the whole announce, shared by both calls of a
  // custom-domain drop — see TOTAL_BUDGET_MS. Retrying each call against its
  // own budget would let a site with a domain attached hold the publish for
  // twice as long as one without.
  const deadline = startedAt + TOTAL_BUDGET_MS
  const primary = await sendRevalidate({
    subdomain,
    secret,
    body: { host: subdomain, hostId, paths },
    deadline,
  })
  if (!primary.ok) {
    // `status: 0` is "no answer at all" — a network error or a timeout, which
    // has no status to report and is therefore the generic failure.
    const reason: TenantRevalidateResult['reason'] = primary.status
      ? (`tenant-${primary.status}` as TenantRevalidateResult['reason'])
      : 'error'
    console.error(
      '[tenant-revalidate] tenant refused',
      primary.status,
      primary.body,
    )
    announceTelemetry({
      host: subdomain,
      hostId,
      paths: paths.length,
      reason,
      attempts: primary.attempts,
      startedAt,
    })
    return { revalidated: [], reason, pathsDropped: 0 }
  }
  // The same paths again under the custom domain's key. Sequential rather
  // than parallel: the second call is only worth making if the first was
  // accepted, and a site with no domain never makes it at all.
  const cnameHost = cnameCacheHost(options.cname)
  let cnameRevalidated: string[] = []
  let cnameAttempts = 0
  if (cnameHost) {
    const second = await sendRevalidate({
      subdomain,
      secret,
      body: { host: cnameHost, hostId, paths },
      deadline,
    })
    cnameAttempts = second.attempts
    if (second.ok && Array.isArray(second.body?.revalidated)) {
      cnameRevalidated = second.body.revalidated as string[]
    } else if (!second.ok) {
      // Reported, never silent: the subdomain drop succeeded, so the
      // publish is not a failure — but the domain everybody actually
      // visits is still serving the old page and somebody should know.
      console.error(
        '[tenant-revalidate] custom-domain drop refused',
        second.status,
        cnameHost,
      )
    }
  }
  const revalidated = [
    ...(Array.isArray(primary.body?.revalidated)
      ? (primary.body.revalidated as string[])
      : []),
    ...cnameRevalidated,
  ]
  const pathsDropped = Number(primary.body?.truncated ?? 0) || 0
  announceTelemetry({
    host: subdomain,
    hostId,
    paths: paths.length,
    reason: 'ok',
    attempts: primary.attempts + cnameAttempts,
    startedAt,
    revalidated: revalidated.length,
    pathsDropped,
  })
  return { revalidated, reason: 'ok', pathsDropped }
}

export default postTenantRevalidate

/**
 * Matches the tenant's own `MAX_PATHS`; more would be dropped there anyway.
 */
const MAX_WHOLE_HOST_PATHS = 250

export interface WholeHostRevalidateResult extends TenantRevalidateResult {
  hostId: string
  /** True when the drop was actually attempted against a resolved subdomain. */
  attempted: boolean
}

/**
 * Drop EVERY routed page of one host, plus its root (AGL-1152).
 *
 * ## Why this is not just `postTenantRevalidate` with a path list
 *
 * A publish knows which pages it changed. The callers here do not: a plugin
 * revocation and a plan change alter what EVERY page of a site renders, and
 * neither has a path list to send. So the paths come from the host document's
 * own `screens` map, which is the same source `/api/screens/revalidate` walks.
 *
 * ## Why these callers need it at all
 *
 * Anything that changes WITHOUT a publish reaches a live page only when that
 * page happens to re-render. Three things are in that category — a plan change,
 * a plugin revocation, and a lockdown flip — and until this existed only the
 * lockdown had a bust, so the other two waited out the page's ISR window.
 *
 * That window was 60s, which made the gap easy to miss and easy to
 * under-rate: on a low-traffic site a page is not requested every minute, so
 * "at most 60s" was already "until somebody visits twice". Raising the window
 * to the hour-long backstop (AGL-1152) makes the gap plain rather than
 * creating it, and this is what pays for the raise.
 *
 * BEST EFFORT, and deliberately so: enforcement never depends on a cache drop.
 * A revoked plugin is refused by the tenant's own render-time revocation read,
 * and a suspended org by the middleware verdict — this only shrinks the window
 * in which already-cached HTML still shows the old answer. It never throws;
 * callers report the result rather than failing the operation that triggered it.
 */
/**
 * Expire the alias→hostId cache for every name a host answered to.
 *
 * The alias cache is the tenant's single most amplified read — the middleware
 * resolves it on EVERY request, including ones an ISR-cached page then serves
 * without touching Firestore again. It used to be held 60s, which meant the
 * entry expired between one uptime check and the next and was therefore paid
 * for in full, forever, by traffic that never changed anything.
 *
 * It is held for an hour now, and this is the other half of that trade. Two of
 * the three events that change what a name resolves to have to say so:
 *
 *  - DETACH, and a rename of the subdomain. Both leave a stale POSITIVE — the
 *    old name still resolving to the host that just released it. That is the
 *    security-relevant one, and at 60s it was already wrong for up to a minute;
 *    busting here closes the window rather than widening it.
 *  - ATTACH needs nothing: `get-host` stores only non-null results, so a name
 *    that did not resolve before has no entry to go stale, and a newly
 *    connected domain is live on the next request. It is sent anyway, because a
 *    re-attach onto a DIFFERENT host is an attach that follows a detach, and
 *    paying one request to not depend on that ordering is worth it.
 *
 * Best-effort by design, exactly like `postTenantRevalidate`: a failure here
 * degrades to the TTL, which is the behavior this replaced.
 */
export async function revalidateHostAliases(options: {
  /** Bare subdomain label (`demo`), which is what `normalizeHostAlias` yields. */
  subdomain: string
  /** Required, or no `tenant-data:{hostId}` tag is busted alongside. */
  hostId: string
  /** The custom domain being connected or released, when there is one. */
  cname?: string
  /**
   * Any OTHER alias this host has stopped answering to — in practice the
   * PREVIOUS subdomain after a rename. Pass bare labels, the form
   * `normalizeHostAlias` yields; `cname--` sentinels are built from `cname`.
   */
  aliases?: string[]
}): Promise<boolean> {
  const { subdomain, hostId } = options
  const secret = process.env['REVALIDATE_SECRET']
  if (!secret || !subdomain) return false

  // The subdomain form is expired by `host`; the `cname--` sentinel is a
  // SEPARATE cache entry and has to be named explicitly — it is the one a
  // detached domain would otherwise keep resolving through.
  const aliases = Array.from(
    new Set(
      [cnameCacheHost(options.cname), ...(options.aliases ?? [])]
        .map((alias) => (alias ?? '').trim().toLowerCase())
        // The URL host is expired by `host`; re-sending it would be a no-op
        // that still costs a tag write.
        .filter((alias) => alias && alias !== subdomain.toLowerCase()),
    ),
  )

  try {
    const response = await fetch(
      `https://${subdomain}.${TENANT_APEX}/api/revalidate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ host: subdomain, hostId, paths: [], aliases }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    return response.ok
  } catch (error) {
    console.error('AGL-1152:alias-revalidate-failed', error)
    return false
  }
}

export async function revalidateEntireHost(
  firestore: Firestore,
  hostId: string,
): Promise<WholeHostRevalidateResult> {
  const miss = (reason: TenantRevalidateResult['reason']) => ({
    hostId,
    attempted: false,
    revalidated: [],
    reason,
    pathsDropped: 0,
  })
  try {
    const snapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!snapshot.exists) return miss('error')
    const subdomain = String(snapshot.get('subdomain') ?? '')
    if (!subdomain) return miss('error')
    const screens = (snapshot.get('screens') ?? {}) as Record<string, string>
    const paths = [
      ...new Set([
        '/',
        ...Object.values(screens).map((path) => screenRoutePathToUrl(path)),
      ]),
    ].slice(0, MAX_WHOLE_HOST_PATHS)
    const result = await postTenantRevalidate({
      subdomain,
      hostId,
      paths,
      // Whole-host drops need the custom domain too — a locked or revoked
      // site serving its old pages on the domain visitors actually use is the
      // failure these callers exist to prevent.
      cname: String(snapshot.get('cname') ?? '') || undefined,
    })
    return { hostId, attempted: true, ...result }
  } catch (error) {
    console.error('[tenant-revalidate] whole-host drop failed', hostId, error)
    return miss('error')
  }
}

/**
 * Cap on how many hosts one revocation fans out to.
 *
 * A revocation is rare and its blast radius is "every site running the code
 * we just killed", so this is set high enough that ordinary use never reaches
 * it. When it does bite it is REPORTED, never silently truncated: a caller
 * that thinks it dropped every affected page and did not is the failure this
 * whole mechanism exists to avoid.
 */
const MAX_REVOKE_FANOUT_HOSTS = 200
/** Concurrent tenant round trips. Bounded so a wide fan-out is not a burst. */
const FANOUT_CONCURRENCY = 10

export interface PluginFanoutResult {
  hosts: WholeHostRevalidateResult[]
  /** Install pins matched by the collection-group query. */
  installsFound: number
  /** Affected hosts NOT dropped because the cap bit — 0 in the normal case. */
  hostsDropped: number
}

/**
 * Drop the cached pages of every host running a given plugin (AGL-1152).
 *
 * ## Why a revocation needs this
 *
 * The tenant stamps each `marketplacePlugin` node with its pinned install and
 * its kill-switch state AT COMPOSE TIME, so a page cached before a revocation
 * goes on serving the pre-revocation answer until it re-renders. The
 * per-install revocation read is deliberately kept on a short TTL as a
 * security bound — but that bound is only consulted DURING a render, so on a
 * page nobody is requesting it bounds nothing at all. This is what actually
 * makes a kill switch take effect on already-cached HTML.
 *
 * ## Scope
 *
 * Installs live at BOTH `orgs/{orgId}/installs/{listingId}` (org-tier, applies
 * to every host in the org — AGL-237) and `hosts/{hostId}/installs/{listingId}`,
 * so the collection-group query finds both and org hits are expanded to their
 * hosts. Backed by the `installs.listingId` COLLECTION_GROUP field override;
 * Firestore auto-creates single-field indexes at COLLECTION scope only.
 *
 * BEST EFFORT, like everything else here: the tenant still refuses a revoked
 * plugin at render time. This only shrinks the window in which cached HTML
 * shows the old answer. Never throws.
 */
export async function revalidateHostsWithPlugin(
  firestore: Firestore,
  listingId: string,
): Promise<PluginFanoutResult> {
  const empty: PluginFanoutResult = {
    hosts: [],
    installsFound: 0,
    hostsDropped: 0,
  }
  if (!listingId) return empty
  try {
    const installs = await firestore
      .collectionGroup('installs')
      .where('listingId', '==', listingId)
      .get()
    if (installs.empty) return empty

    const hostIds = new Set<string>()
    const orgIds = new Set<string>()
    for (const doc of installs.docs) {
      const owner = doc.ref.parent.parent
      if (!owner) continue
      if (owner.parent.id === 'hosts') hostIds.add(owner.id)
      else if (owner.parent.id === 'orgs') orgIds.add(owner.id)
    }
    // An org-tier pin applies to every host in the org, so it is the org's
    // hosts that hold the cached HTML — the org itself renders nothing.
    await Promise.all(
      [...orgIds].map(async (orgId) => {
        const hosts = await firestore
          .collection('hosts')
          .where('orgId', '==', orgId)
          .get()
        for (const host of hosts.docs) hostIds.add(host.id)
      }),
    )

    const all = [...hostIds]
    const targets = all.slice(0, MAX_REVOKE_FANOUT_HOSTS)
    const hostsDropped = all.length - targets.length
    if (hostsDropped > 0) {
      // Said out loud, for the same reason the tenant logs its own path cap
      // (AGL-1161): the only record that some sites were left serving the
      // revoked bundle on purpose.
      console.warn(
        JSON.stringify({
          tag: 'AGL-1152:revoke-fanout-truncated',
          listingId,
          affected: all.length,
          cap: MAX_REVOKE_FANOUT_HOSTS,
          dropped: hostsDropped,
        }),
      )
    }

    const results: WholeHostRevalidateResult[] = []
    for (let i = 0; i < targets.length; i += FANOUT_CONCURRENCY) {
      const batch = targets.slice(i, i + FANOUT_CONCURRENCY)
      results.push(
        ...(await Promise.all(
          batch.map((hostId) => revalidateEntireHost(firestore, hostId)),
        )),
      )
    }
    return { hosts: results, installsFound: installs.size, hostsDropped }
  } catch (error) {
    console.error('[tenant-revalidate] plugin fan-out failed', listingId, error)
    return empty
  }
}

/**
 * Drop the cached pages of every host in one org (AGL-1152).
 *
 * ## Why a plan change needs this
 *
 * Entitlements resolve from `org.plan` AT RENDER TIME, and the most visible
 * one is the free-tier branding badge: `showBranding` is computed inside the
 * tenant loader from the org doc. Nothing busts a tenant page when a plan
 * changes — a plan change happens in Stripe and the console, neither of which
 * publishes — so an upgrade left the badge on every cached page until that page
 * next re-rendered on its own. A customer who has just paid to remove the badge
 * is the least good audience for an ISR window.
 *
 * Caller decides WHEN: this fires on a plan transition, not on every billing
 * write, because a seat-addon change or a customer-id stamp alters nothing a
 * visitor can see and a site-wide cache drop is not free.
 *
 * BEST EFFORT and never throws, like the rest of this module.
 */
export async function revalidateOrgHosts(
  firestore: Firestore,
  orgId: string,
): Promise<WholeHostRevalidateResult[]> {
  if (!orgId) return []
  try {
    const hosts = await firestore
      .collection('hosts')
      .where('orgId', '==', orgId)
      .get()
    const results: WholeHostRevalidateResult[] = []
    for (let i = 0; i < hosts.docs.length; i += FANOUT_CONCURRENCY) {
      const batch = hosts.docs.slice(i, i + FANOUT_CONCURRENCY)
      results.push(
        ...(await Promise.all(
          batch.map((doc) => revalidateEntireHost(firestore, doc.id)),
        )),
      )
    }
    return results
  } catch (error) {
    console.error('[tenant-revalidate] org fan-out failed', orgId, error)
    return []
  }
}
