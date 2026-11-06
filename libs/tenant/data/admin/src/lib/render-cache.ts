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

import { unstable_cache } from 'next/cache'

/**
 * Cross-request caching for the tenant render path's Firestore reads
 * (AGL-1302, the caching half of AGL-1151).
 *
 * Every tenant SSR render fanned out to ~15–40 uncached Admin-SDK reads —
 * host resolution, org billing, screen + version, the layout chain, and the
 * whole compose bundle (components, variables, functions, datasets,
 * workflows, plugin installs). None of that data is per-visitor, and almost
 * all of it is identical across every path on a site, so a 50-route sweep
 * paid the same host-scoped reads 50 times over. Routine verification
 * traffic alone burned ~44K reads/day (87% of the free tier).
 *
 * This module is deliberately a THIN wrapper around `unstable_cache` rather
 * than a cache of its own, so invalidation stays Next's: entries are tagged
 * and the existing publish/revalidate path (`/api/revalidate`, AGL-1150)
 * busts them with `revalidateTag` the same moment it drops the page HTML.
 *
 * Ground rules encoded here, because `unstable_cache` enforces none of them:
 *
 * - VALUES ARE JSON. `unstable_cache` stores `JSON.stringify(result)`, so a
 *   cache HIT returns plain data while a MISS would return live objects —
 *   Firestore `Timestamp`s, most importantly, whose `.seconds` getter decays
 *   to `_seconds` across the round trip. Serving two shapes for the same
 *   read is how a schedule check works in testing and misfires in
 *   production, so `withRenderCache` normalizes the MISS through the same
 *   JSON round trip. Callers whose logic needs live `Timestamp` semantics
 *   must not cache that read (see the pending-`publishSchedule` guards at
 *   the call sites).
 *
 * - NEGATIVES ARE NOT CACHED unless a caller opts in via `store`. A
 *   transient miss (host not found, doc missing) cached for the TTL is a
 *   self-inflicted outage; the Firestore negative-cache class of bug is
 *   exactly this shape.
 *
 * - OUTSIDE NEXT (jest, scripts) there is no incremental cache and
 *   `unstable_cache` throws its `incrementalCache missing` invariant before
 *   running the callback. The wrapper catches precisely that and falls back
 *   to the uncached read, so shared-lib specs exercise the same code path
 *   they always did.
 *
 * - NEVER cache per-user reads through this. Everything cached here must be
 *   a pure function of published site data.
 */

/**
 * One tag per host covers every host-scoped cached doc — the host doc, the
 * compose bundle, plugin installs, the sitemap payload. The tenant
 * `/api/revalidate` route busts it on publish (alongside its existing
 * `revalidatePath` calls), so a publish is exactly as instant as AGL-1150
 * made it; the TTL is only the backstop for writes that never announce
 * themselves.
 */
export const tenantDataTag = (hostId: string): string => `tenant-data:${hostId}`

/**
 * THE BACKSTOP every tenant render-path read and the page itself share
 * (AGL-4121): seven days.
 *
 * Freshness is change-driven. Every write that changes what a page shows
 * drops it on demand, and the security-relevant drops (a plugin removed,
 * disabled, taken down, revoked or untrusted) are staged in the publish
 * outbox first, so a failed call is retried by the drain rather than left to
 * this timer. The timer only bounds an unannounced direct Firestore edit.
 *
 * One number on purpose. Next lowers a page's window to the SHORTEST cached
 * read its render makes (`unstable_cache` and `fetch` both shrink the work
 * store's `revalidate`), so a single read left on a shorter TTL quietly
 * becomes the page's window — exactly what kept #2459's one-day page on five
 * minutes. `tenant-page-window.spec.ts` sweeps the render path for that.
 */
export const TENANT_CACHE_BACKSTOP_SECONDS = 604800

/**
 * Every cached read that decides WHICH PLUGINS a site may load — the signed
 * realm installs, the pinned installs with their kill-switch state, and the
 * image hosts those plugins declare — carries these tags beside
 * `tenantDataTag` (AGL-4121), and so does every page whose render read one.
 *
 * - `tenantPluginsTag(hostId)`: one site's plugin set changed (an uninstall,
 *   a switchboard toggle, a plan move).
 * - `TENANT_PLUGINS_TAG`: a platform event changed it for every site at once
 *   (a takedown, a revoked version, realm trust withdrawn). One tag bust
 *   reaches every affected site with no host walk and no fan-out cap.
 *
 * The tenant's `/api/revalidate` expires both with `{ expire: 0 }`, not the
 * stale-while-revalidate `'max'` the data tag takes: a removed plugin must
 * not run for even one more visitor.
 */
export const TENANT_PLUGINS_TAG = 'tenant-plugins'
export const tenantPluginsTag = (hostId: string): string =>
  `tenant-plugins:${hostId}`

/** The full tag set for a read that decides which plugins load on a site. */
export const tenantPluginGateTags = (hostId: string): string[] => [
  tenantDataTag(hostId),
  tenantPluginsTag(hostId),
  TENANT_PLUGINS_TAG,
]

/**
 * The backstop TTL for published site data — every read that
 * `revalidateTag(tenantDataTag(hostId))` busts on publish.
 *
 * ## Seven days (AGL-4121)
 *
 * The hour below became the backstop once every product write announced
 * itself; AGL-4121 audited the remaining unannounced writers (shopper stock
 * and reviews, the plugin switchboard, realm trust) and wired them, so the
 * hour is now {@link TENANT_CACHE_BACKSTOP_SECONDS}.
 *
 * WHY AN HOUR AND NOT A MINUTE (2026-08-26, from the Vercel cost review).
 *
 * Every cache in this layer shipped at 60s, and the page above them was
 * `revalidate = 60` too. Setting the backstop to the same order as the
 * request rate makes it the PRIMARY propagation mechanism rather than a
 * backstop: the whole chain expired together, so a render a minute paid the
 * full sequential Firestore walk — host, org billing, redirect rules, page
 * resolution, screen, compose bundle, enrichers — and none of it was ever
 * stale in a way anyone could observe, because the publish path had already
 * busted the tag the moment the content changed.
 *
 * Measured on `/[host]/[scheme]/[[...slug]]`: 0.78 GB-hr across 635 invocations, a P75
 * of 3.65s, and ~4.4 GB-s per render — the most expensive route per hit in
 * the account, on a site with no real traffic yet.
 *
 * So the TTL goes back to being what `withRenderCache`'s own docstring says
 * it is: "the backstop for writes that never announce themselves." An hour
 * bounds an unannounced direct-to-Firestore edit. Everything that goes
 * through the product announces itself and is busted in the same instant it
 * always was, so publish latency is unchanged.
 *
 * ⛔ NOT for reads that change OUTSIDE a publish. Two deliberately keep their
 * own short TTLs and must not be moved onto this one:
 *
 *   - `ORG_BILLING_TTL_SECONDS` — the request-time org read (the lockdown
 *     verdict and the other dynamic routes), where a bandwidth cap or a
 *     suspension stamped straight onto the doc arrives by TTL alone. The
 *     render's own org read is on this backstop instead (`scope: 'render'`):
 *     plan transitions, staff overrides and org settings all announce
 *     themselves through `revalidateOrgHosts`.
 *
 * ⚠️ Any TTL read inside the ISR render also caps the PAGE: `unstable_cache`
 * lowers the regeneration's `revalidate` to the shortest TTL it saw, so one
 * 60s entry holds the catch-all's 3600 at 60.
 *   - `HOST_ALIAS_TTL_SECONDS` / `HOST_DOC_TTL_SECONDS` — a custom domain
 *     attaching is the customer sitting there waiting for their site
 *     (AGL-2010), and the `cname--` alias entry expires only by TTL.
 *
 * Takedowns are unaffected either way: the middleware runs ahead of every
 * cache here and carries its own memo, which is what
 * `lockdown-middleware-propagation.spec.ts` measures.
 */
export const PUBLISHED_SITE_DATA_TTL_SECONDS = TENANT_CACHE_BACKSTOP_SECONDS

/**
 * The backstop for the one read a screen publish changes under an UNCHANGED
 * cache key — the version pointer (AGL-2573).
 *
 * The hour above is argued on the premise that "everything that goes through
 * the product announces itself". That premise held for eleven days in August
 * and then did not: the tenant refused the announce and every publish on the
 * platform fell back to this TTL. The announce is still the mechanism — no TTL
 * can make a publish instant, because the page above these caches is ISR-held
 * and does not re-run a loader to notice a fresher document — but a backstop
 * only bounds a failure, and an hour is not a bound anyone would choose for
 * "your published page is not the page you published".
 *
 * Applied to the POINTER alone, deliberately, because the pointer alone is
 * what makes the hour expensive. `get-screen-version` is keyed by `versionId`,
 * so the body of a newly published version misses on its own; the only thing
 * standing between a visitor and it is the screen document that names which
 * version is live. That document is one small read, and shortening it leaves
 * the expensive reads — the compose bundle, the node trees — at the hour the
 * cost review set.
 *
 * The principle rather than a tuned figure: **the pointer must never be staler
 * than the HTML that reads it** — `<=` the tenant catch-all's ISR window
 * (`apps/tenant/app/[host]/[scheme]/[[...slug]]/page.tsx`), which
 * `publish-pointer-tracks-page-window.spec.ts` enforces. Above the window, the
 * page regenerates and faithfully rebuilds itself from a stale pointer, which
 * is the failure being closed.
 *
 * It matched that window exactly while the window was also 600s. It no longer
 * does, and staying at 600 under an hour-long window is the deliberate choice
 * (AGL-2690): the loader runs only when the page regenerates, so a shorter TTL
 * here costs the same single read per regeneration — a miss instead of a hit —
 * and buys a rebuild from data at most ten minutes old rather than up to an
 * hour old. That difference only shows when the publish announce is down, and
 * the announce has been down for eleven days once already.
 *
 * The read cost this adds is one document per page REGENERATION rather than
 * one per hour — regenerations are already bounded by the ISR window, so the
 * ceiling is the render rate and not the request rate. That is the price of
 * the bound, and it is the cheapest read on the path.
 *
 * ## Equal to the page window again (AGL-4121)
 *
 * The reasoning above held while the pointer sat BELOW the page window. It
 * stopped holding once AGL-4121 measured that a TTL read in the render lowers
 * the page's own window to match: at 600s the pointer was what regenerated
 * every page every ten minutes. The failure it bounded is now closed at the
 * source instead — every pointer move rides the publish outbox (AGL-2575),
 * whose drain retries a refused announce — so the pointer takes the backstop
 * and stays exactly `<=` the page window, which the spec still enforces.
 */
export const PUBLISH_POINTER_TTL_SECONDS = TENANT_CACHE_BACKSTOP_SECONDS

/**
 * The alias→hostId resolution is tagged separately because it is the one
 * cache keyed BEFORE the hostId is known. It only changes on subdomain
 * rename or custom-domain (dis)connect, never on publish.
 */
export const tenantHostAliasTag = (alias: string): string =>
  `tenant-host:${alias}`

/**
 * A value that must be RETURNED but not STORED (a negative result, or a doc
 * carrying a pending publish schedule). Thrown out of the cached callback so
 * `unstable_cache` never writes it, caught by the wrapper and unwrapped.
 */
class BypassStore extends Error {
  constructor(readonly value: unknown) {
    super('render-cache bypass')
    this.name = 'RenderCacheBypass'
  }
}

const isMissingIncrementalCache = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('incrementalCache missing')

/**
 * The same normalization the page props already go through (`JSON.parse(
 * JSON.stringify(...))` at every loader exit), applied at the cache boundary
 * so hits and misses hand back byte-identical shapes.
 */
export function toPlainJson<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export interface RenderCacheOptions<T> {
  /**
   * Cache key parts. The FIRST part must be unique per read helper — every
   * call funnels through the same callback source, and `unstable_cache` keys
   * on callback text + key parts, so the name prefix is what keeps
   * `getScreen` and `getComponents` from colliding.
   */
  key: readonly string[]
  /** TTL in seconds — the staleness backstop when no tag bust arrives. */
  revalidate: number
  /** Tags `revalidateTag` can bust — see `tenantDataTag`. */
  tags: readonly string[]
  /** The uncached read. Must resolve to JSON-serializable data. */
  read: () => Promise<T>
  /**
   * Return `false` to serve the value WITHOUT storing it. Negative results
   * and docs whose live `Timestamp` semantics matter (pending publish
   * schedules) belong here. `undefined` is never stored regardless.
   */
  store?: (value: T) => boolean
}

export async function withRenderCache<T>(
  options: RenderCacheOptions<T>,
): Promise<T> {
  const { key, revalidate, tags, read, store } = options
  const cached = unstable_cache(
    async () => {
      const value = toPlainJson(await read())
      if (value === undefined || (store && !store(value))) {
        throw new BypassStore(value)
      }
      return value
    },
    [...key],
    { revalidate, tags: [...tags] },
  )
  try {
    return await cached()
  } catch (error) {
    if (error instanceof BypassStore) return error.value as T
    // No Next server context (jest, one-off scripts): the invariant throws
    // before the callback runs, so reading directly is not a double read.
    if (isMissingIncrementalCache(error)) return toPlainJson(await read())
    throw error
  }
}

/**
 * Lowers the window of the page being rendered to `seconds`, and nothing
 * else (AGL-4121).
 *
 * For the narrow cases where a page shows something that changes on a clock
 * rather than on a write — a publish schedule that is still pending. Next
 * takes the shortest `revalidate` any cached read made during a regeneration,
 * so a tiny cached constant read with this TTL holds THAT page (and only
 * that page) on the short window, while every other page keeps the backstop.
 *
 * Outside a Next render (jest, scripts) it is a no-op.
 */
export async function capRenderWindow(seconds: number): Promise<void> {
  const window = Math.max(1, Math.floor(seconds))
  try {
    await unstable_cache(async () => window, ['tenant-render-window-cap', String(window)], {
      revalidate: window,
    })()
  } catch (error) {
    if (isMissingIncrementalCache(error)) return
    console.error('[render-cache] could not cap the page window', error)
  }
}
