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

// lockdown-423: exempt — this IS the verdict. The edge middleware cannot read
// Firestore, so it asks this Node route whether a host is locked; a route that
// refused while locked would make the lock unobservable and the middleware would
// fail open on every request. Deliberately unauthenticated and disclosure-free —
// the body is a boolean about a public website, with no actor and no target ids.

/**
 * Is this host locked down? (AGL-1501)
 *
 * The middleware's Firestore proxy: the edge runtime cannot read the host
 * or org docs, so it asks this Node route and memoizes the answer for 30s.
 * Unauthenticated by design — the answer is a boolean about a PUBLIC
 * website's availability, already observable by loading it, and the caller
 * whose sessions a lockdown revoked must still be able to reach the notice.
 * The body carries no actor, no rationale, no target ids.
 *
 * Reads ride the same tagged caches the render path uses (`getHost`,
 * `getOrgBilling`), so the lockdown route's revalidation fan-out — which
 * busts `tenant-data:{hostId}` — makes THIS answer fresh at the same
 * moment it drops the cached pages.
 *
 * Scope note: no `user` scope and no staff bypass here on purpose. A
 * locked HOST is locked for every visitor including staff (this is the
 * public site, not the console), and a visitor's identity plays no part in
 * whether a website serves.
 *
 * ## It also answers `attribution` (AGL-2088)
 *
 * A SECOND boolean rides along on the same response: may this host's
 * responses carry `x-powered-by: Aglyn`? It lives here rather than in a
 * route of its own for one reason — this route already loads the host and
 * the org doc the answer needs, so the middleware pays nothing for it,
 * while a second verdict route would double the edge round trip on every
 * request of every published site to decide a header.
 *
 * Same disclosure posture as `locked`: it is a boolean about a public
 * website, derived from a plan, and the site's own HTML already carries the
 * matching `<meta name="generator">`. Nothing about the org's plan, its
 * identity or its entitlements is in the body.
 *
 * ⚠️ Every early return below answers `attribution: false`. Unknown host,
 * thrown error, missing org — all suppress. `showsPlatformAttribution`
 * enforces the same rule on the org it is handed; these are the branches
 * that never reach it. A verdict route that fails open on THIS field would
 * put the header on a white-labelled site during a Firestore blip.
 */

import {
  bandwidthCapEngaged,
  isLockdownActive,
  lockdownMode,
  lockdownNotice,
  lockdownRetryAfterSeconds,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  resolveLockdown,
  showsPlatformAttribution,
  type LockdownState,
} from '@aglyn/aglyn/server'
// THE LEAF MODULE, NOT THE `/server` BARREL (AGL-1289). Imported from the
// barrel, `TENANT_APEX` typechecked and then resolved `undefined` at runtime —
// this route is reachable through the barrel itself, so the cycle left the
// binding unset and the handler threw `TENANT_APEX is not defined` on every
// request under `nx serve tenant`. It is the same shape `site-page-hooks.ts`
// documents, and the same fix: reach past the barrel to the module that
// declares it.
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import {
  getDomainLockdown,
  getPlatformLockdown,
} from '@aglyn/tenant-data-admin'
import { CNAME_HOST_PREFIX, getHost } from '../../../utils/get-host'
import { getOrgBilling } from '../../../utils/get-org-billing'

export const dynamic = 'force-dynamic'

/**
 * The locked answer, shared by the attached-host path and the domain-locked
 * unknown-host path (AGL-1513).
 *
 * READ-ONLY (AGL-1511): the site keeps serving. The verdict still says
 * `locked: true` — it is describing the LOCK, not the middleware's action —
 * and reports the mode so the caller decides. Answering `locked: false`
 * instead would have been the shorter change and the wrong one: this route is
 * also how a staff probe and any future reader learns a site is in read-only,
 * and a lock that reports itself as absent is a lock nobody can verify is
 * engaged.
 */
function lockedVerdict(
  state: LockdownState,
  facts: {
    attribution: boolean
    overQuota: boolean
    approvedImageHosts?: string[]
    approvedMediaHosts?: string[]
    approvedFontHosts?: string[]
    approvedFormActions?: string[]
    runsMeasurement?: boolean
    siteOrigins?: string[]
  },
): Response {
  const notice = lockdownNotice(state)
  const retryAfter = lockdownRetryAfterSeconds(state, Date.now())
  return Response.json(
    {
      locked: true,
      attribution: facts.attribution,
      overQuota: facts.overQuota,
      approvedImageHosts: facts.approvedImageHosts ?? [],
      approvedMediaHosts: facts.approvedMediaHosts ?? [],
      approvedFontHosts: facts.approvedFontHosts ?? [],
      approvedFormActions: facts.approvedFormActions ?? [],
      runsMeasurement: facts.runsMeasurement ?? false,
      siteOrigins: facts.siteOrigins ?? [],
      mode: lockdownMode(state),
      reason: state.reason,
      title: notice.title,
      message: notice.body,
      ...(notice.contact ? { contact: notice.contact } : {}),
      ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    },
  )
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.searchParams.get('host') ?? ''
  if (!host || host.includes('/')) {
    return Response.json({ error: 'Missing host' }, { status: 400 })
  }
  try {
    // DOMAIN scope (AGL-1513): lock ONE attached name while the same site
    // keeps serving on its `*.aglyn.app` subdomain. `host` arrives here as
    // `cname--{hostname}` for an attached custom domain and as a bare label
    // for a platform subdomain — the discriminator the middleware already
    // computed, and the only signal the edge can carry since the edge runtime
    // cannot reach Firestore. A platform subdomain is never domain-locked:
    // that address is ours, and taking it down is what the HOST scope is for.
    //
    // Read BEFORE the unknown-host return on purpose. The incidents this
    // scope exists for are the ones where the name is not (or is no longer)
    // attached to anything: a disputed domain is usually parked mid-dispute,
    // and a hijacked one gets detached and re-attached elsewhere. A lock that
    // only answered for currently-attached names would go quiet at exactly
    // the moment the dispute is live.
    const domain = host.startsWith(CNAME_HOST_PREFIX)
      ? await getDomainLockdown(host.slice(CNAME_HOST_PREFIX.length))
      : null

    const hostRes = await getHost({ host })
    if (!hostRes.host) {
      // Unknown host: the normal 404 flow owns this case — UNLESS the name
      // itself is locked, which is a thing we can assert without any host.
      // No org either way, so no attribution; there is nothing here to
      // fingerprint.
      if (!domain || !isLockdownActive(domain, Date.now())) {
        return Response.json(
          {
            locked: false,
            attribution: false,
            overQuota: false,
            approvedImageHosts: [],
            approvedMediaHosts: [],
            approvedFontHosts: [],
            approvedFormActions: [],
          },
          { status: 200 },
        )
      }
      return lockedVerdict(domain, {
        attribution: false,
        overQuota: false,
        approvedImageHosts: [],
        approvedMediaHosts: [],
        approvedFontHosts: [],
        approvedFormActions: [],
      })
    }
    const orgRes = await getOrgBilling({ hostId: hostRes.host.$id })
    const attribution = showsPlatformAttribution(orgRes.org)
    // The free plan's bandwidth cap (AGL-1967/2070/2155) — a THIRD answer on
    // the same verdict, for the same reason `attribution` rides here: this
    // route already holds the org doc the answer needs, so the middleware pays
    // nothing for it, and a cap evaluated only in the loader would be a cap
    // that CACHED pages sail straight past. The egress the cap exists to stop
    // is served by the cache, not by the renderer.
    //
    // Same disclosure posture as the other two: a boolean about a public
    // website, derived from a plan. No usage figure, no plan name, no band —
    // nothing here that is not already implied by the notice the visitor is
    // about to read.
    const overQuota = bandwidthCapEngaged(orgRes.org)
    /**
     * The site's owner-approved image hosts (AGL-1152) — a FOURTH answer on
     * this verdict, riding here for the reason the other three do: the route
     * already holds the host doc, so the middleware pays no extra edge round
     * trip, and only the middleware runs ahead of the ISR cache where the
     * header has to be set.
     *
     * Sent RAW, exactly as stored. The parse that decides what is admissible
     * lives in `security-origins.js` and runs in the middleware, so there is
     * one implementation of it rather than one here and one there — and an
     * entry this route silently dropped would be an entry the console's
     * editor warning still believed in.
     *
     * Disclosure posture matches the other three: this is a list the site
     * owner typed, describing hosts their own public pages already load. It
     * says nothing a visitor could not learn by viewing source.
     */
    const stringList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : []
    const approvedImageHosts = stringList(hostRes.host.approvedImageHosts)
    /**
     * The other three owner-widenable directives (AGL-1152). Same disclosure
     * posture as images: a list the owner typed, describing hosts their own
     * public pages already load, so it says nothing a visitor could not learn
     * by viewing source. Sent even while the directives they feed are
     * report-only — the header has to carry the owner's list from the first
     * report, or the reports describe a policy nobody is going to ship.
     */
    const approvedMediaHosts = stringList(
      (hostRes.host as { approvedMediaHosts?: unknown }).approvedMediaHosts,
    )
    const approvedFontHosts = stringList(
      (hostRes.host as { approvedFontHosts?: unknown }).approvedFontHosts,
    )
    const approvedFormActions = stringList(
      (hostRes.host as { approvedFormActions?: unknown }).approvedFormActions,
    )
    /**
     * Does this site run measurement tags (AGL-1152)?
     *
     * Decides whether `img-src` admits the analytics and ad-network beacons.
     * A GTM container counts on its own and is the broader of the two: a
     * container carries whatever tags the operator put in it — Meta's pixel
     * most often — so a site with one needs the vendor beacons even with no
     * GA id of its own.
     *
     * Gated rather than always-on because a site with no analytics has no
     * reason to permit an ad network's beacon, and permitting one anyway
     * would make the policy describe our convenience instead of the site.
     */
    /**
     * The site's OWN addresses (AGL-1152).
     *
     * `'self'` covers only the origin a page was served from, and a site with
     * a custom domain attached has two. Sent from here because this route
     * already holds the host doc, and derived from `TENANT_APEX` rather than
     * a literal so a self-host install names its own apex (AGL-2195).
     *
     * The `www.` form rides along because `liveCustomDomain` treats the two as
     * one site, so an author can legitimately have referenced either.
     */
    const subdomain = String(hostRes.host.subdomain ?? '').trim()
    const cname = String(hostRes.host.cname ?? '').trim()
    const siteOrigins = [
      subdomain ? `${subdomain}.${TENANT_APEX}` : '',
      cname,
      cname ? `www.${cname}` : '',
    ].filter(Boolean)
    const analytics = hostRes.host.analytics
    const runsMeasurement = Boolean(
      analytics?.gaMeasurementId ||
      analytics?.gtmContainerId ||
      // `adTags` is how an ad pixel is ACTUALLY configured — a vendor id →
      // account id map, and the field `aglyn-marketing` carries its Meta
      // pixel in. Omitting it was a real defect for the narrow case that
      // matters most: a site running an ad pixel and NO analytics id would
      // have had `runsMeasurement: false`, and the very beacon this gate
      // exists to permit would have been the one thing refused.
      Object.keys(analytics?.adTags ?? {}).length > 0,
    )
    const state = resolveLockdown(
      {
        platform: await getPlatformLockdown(),
        org: normalizeOrgLockdown(orgRes.org as never),
        host: normalizeHostLockdown(hostRes.host as never),
        domain,
      },
      Date.now(),
    )
    if (!state) {
      return Response.json(
        {
          locked: false,
          attribution,
          overQuota,
          approvedImageHosts,
          approvedMediaHosts,
          approvedFontHosts,
          approvedFormActions,
          runsMeasurement,
          siteOrigins,
        },
        { status: 200 },
      )
    }
    return lockedVerdict(state, {
      attribution,
      overQuota,
      approvedImageHosts,
      approvedMediaHosts,
      approvedFontHosts,
      approvedFormActions,
      runsMeasurement,
      siteOrigins,
    })
  } catch (error) {
    console.error('[lockdown-verdict] failed', error)
    // Fail open on the LOCK: the middleware treats any non-locked answer as
    // "serve", because an unreachable verdict is an outage, not a takedown.
    // Fail CLOSED on the attribution, in the same breath and for the opposite
    // reason: serving a site we could not price is recoverable, stamping the
    // platform's name on a site that paid to hide it is not.
    // …and fail open on the CAP too, in the same breath. An unreachable org
    // doc is an outage; taking a free customer's website down over one would
    // be the cap doing exactly the damage it exists to prevent, to the wrong
    // party. A month of missed enforcement costs Aglyn egress; an hour of
    // wrongly enforced cap costs a customer their site.
    return Response.json(
      {
        locked: false,
        attribution: false,
        overQuota: false,
        // ABSENT, not empty: the middleware distinguishes "this site approved
        // nothing" from "we could not ask", and retains its last known good
        // list for the second. An empty list here would blank every approved
        // host's images across the platform during a verdict outage.
        approvedImageHosts: null,
        // Same stale-retentive null for the three that joined it: an empty
        // list would look like "the owner approved nothing" and blank a
        // site's media and fonts during a verdict outage.
        approvedMediaHosts: null,
        approvedFontHosts: null,
        approvedFormActions: null,
      },
      { status: 200 },
    )
  }
}
