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
 * The site's 503 answer, sent as a 503 (AGL-4110).
 *
 * Maintenance mode (AGL-131) and preview (AGL-4086) answer a visitor who is
 * not let through with the site's designed 503 page, or the built-in notice,
 * at every address. The body was right and the status was not: every address
 * said `200 OK`, which tells a crawler the notice IS the page. A live site
 * that spent a weekend in maintenance could be re-indexed as "Temporarily
 * unavailable" and drop out of search. `503` with `Retry-After` is the answer
 * that means "this site is briefly down, come back".
 *
 * The body still comes from the ISR-cached catch-all, exactly as before; only
 * the tenant middleware can set the status, because an App Router page has no
 * status lever and the middleware is the one layer that runs ahead of the
 * cache on every request. It asks {@link siteUnavailableForRequest}, reads the
 * page, and sends it as a 503, so a cached page body never decides the status.
 * Why it reads the page rather than putting the status on its rewrite is the
 * note beside that code: on Vercel that rewrite loses the page.
 *
 * DEPENDENCY-FREE ON PURPOSE, like `site-preview.ts`: the middleware runs on
 * the edge and deep-imports this leaf, so it imports nothing.
 */

/**
 * How long a crawler or uptime check is told to wait before asking again, in
 * seconds: an hour.
 *
 * The bandwidth cap's figure (`BANDWIDTH_CAP_RETRY_AFTER_SECONDS`), for the
 * same reason. Both states end the moment the owner flips a switch, and the
 * site is back within about a minute, so no longer value is ever "correct".
 * Too long is wrong in the direction that costs the site: a crawler staying
 * away after the site came back. An hour is short enough to be wrong in the
 * recoverable direction, and long enough that a crawler does not spend its
 * visits re-reading "not yet".
 */
export const SITE_UNAVAILABLE_RETRY_AFTER_SECONDS = 3600

/**
 * Marks the middleware's own read of the notice page, which comes back through
 * the middleware and must take the plain rewrite rather than read it again.
 *
 * Not a secret, and nothing is withheld behind it: a stranger who sends it gets
 * the same notice with a 200.
 */
export const SITE_NOTICE_REQUEST_HEADER = 'x-aglyn-site-notice'

/**
 * How long a visitor waits on that read, in milliseconds, before being served
 * the plain rewrite. Generous, as the verdict's deadline is: a cold render
 * answers inside it, and the page still arrives if it does not.
 */
export const SITE_NOTICE_DEADLINE_MS = 8_000

/**
 * Is the site in maintenance mode (AGL-131)?
 *
 * The loader's own test, shared with the verdict the middleware reads, so the
 * status and the body are decided by one predicate: a field the loader reads as
 * "in maintenance" is a field the middleware reads the same way.
 */
export function isHostInMaintenance(
  host: { maintenance?: unknown } | null | undefined,
): boolean {
  return Boolean(host?.maintenance)
}

/** What the middleware knows about a site, from its verdict. */
export interface SiteUnavailableVerdict {
  /** Maintenance mode is on: the public gets the notice, the team the site. */
  maintenance?: boolean
  /** The WHOLE site is in preview. One page in preview is not this. */
  preview?: boolean
}

/** How the middleware is routing this request. */
export interface SiteUnavailableRouting {
  /** An entry preview link (`?aglyn_preview=`) is being opened. */
  entryPreview: boolean
  /**
   * A team cookie sent this request around the cache to the uncached preview
   * route, which shows the team the site.
   */
  teamPreview: boolean
  /** The middleware's own read of the notice page, not a visitor. */
  noticeRequest?: boolean
}

/**
 * Does this page request get the site's 503 answer as an HTTP 503?
 *
 * - **Maintenance or a site in preview: yes, for the public**, the requests
 *   answered from the shared cache. A request carrying a team cookie goes to
 *   the uncached preview route instead, which shows the team the whole site.
 * - **An entry preview link: no.** When the site is unavailable its route
 *   redirects to the plain address, which answers 503 by the rules above; a
 *   503 set here would only argue with that redirect.
 * - **One page in preview: no.** The public gets the site's 404 there, and the
 *   render's own 404 decides that status.
 * - **The middleware's own read of the page: no.** That is how the body of the
 *   503 is fetched, and it would otherwise fetch itself.
 *
 * Nothing here is a permission. The body is the loader's decision, and a
 * request this answers `false` for is one whose body is already the site, or
 * an answer with a status of its own.
 */
export function siteUnavailableForRequest(
  verdict: SiteUnavailableVerdict | null | undefined,
  routing: SiteUnavailableRouting,
): boolean {
  if (!verdict || routing.entryPreview || routing.noticeRequest) return false
  return (
    (verdict.maintenance === true || verdict.preview === true) &&
    !routing.teamPreview
  )
}
