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
export async function postTenantRevalidate(options: {
  /** The site's subdomain — the tenant keys its cache on it, not on `hostId`. */
  subdomain: string
  /** Required: without it no `tenant-data:{hostId}` tag is busted. */
  hostId: string
  /** Site-absolute paths (`/`, `/menu`). The tenant caps them at 250. */
  paths: string[]
}): Promise<TenantRevalidateResult> {
  const { subdomain, hostId, paths } = options
  const secret = process.env['REVALIDATE_SECRET']
  if (!secret) return { revalidated: [], reason: 'not-configured', pathsDropped: 0 }

  try {
    const response = await fetch(`https://${subdomain}.${TENANT_APEX}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ host: subdomain, hostId, paths }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const result = (await response.json().catch(() => null)) as {
      revalidated?: unknown
      truncated?: unknown
    } | null
    if (!response.ok) {
      console.error('[tenant-revalidate] tenant refused', response.status, result)
      return {
        revalidated: [],
        reason: `tenant-${response.status}` as TenantRevalidateResult['reason'],
        pathsDropped: 0,
      }
    }
    return {
      revalidated: Array.isArray(result?.revalidated) ? (result.revalidated as string[]) : [],
      reason: 'ok',
      pathsDropped: Number(result?.truncated ?? 0) || 0,
    }
  } catch (error) {
    console.error('[tenant-revalidate] request failed', error)
    return { revalidated: [], reason: 'error', pathsDropped: 0 }
  }
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
    const result = await postTenantRevalidate({ subdomain, hostId, paths })
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
