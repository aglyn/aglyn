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
 * THE FRONT DOOR: does a visitor get a page? (AGL-2709)
 *
 * Every monitor this repo owns asks a health route. A health route answers
 * from inside a route handler, and a route handler is not the path a visitor
 * takes. On 2026-09-09 every tenant page answered 500 with a
 * `DYNAMIC_SERVER_USAGE` digest for ten minutes, and both page monitors —
 * `Published sites` on `/api/health/render/site`, `Marketing site` on
 * `/api/health/render/marketing` — stayed at 100.000% with no downtime
 * recorded. They were not broken. They measure whether the render code can
 * produce a node tree, which it could; the ISR path that assembles that tree
 * into a document at request time is the part that was throwing, and no
 * `/api/*` route enters it.
 *
 * So the canaries answer a real question and the wrong one. This module asks
 * the other: fetch the page URL a visitor types, and grade the response the
 * way a visitor experiences it.
 *
 * ## Why this had to be built rather than restored
 *
 * It existed once. The GCP uptime checks `marketing-home` and `customer-site`
 * fetched `aglyn.com/` and `demo.aglyn.app/`, which is exactly this. Vercel
 * Bot Protection began answering them with a 429 Security Checkpoint on
 * 2026-08-21, they read 0% for a week, and the repair pointed them at the
 * render canaries instead — trading the question for one that could be
 * answered. `x-aglyn-probe` (see `probe-headers.mjs`) has since made the
 * original question answerable again, and this is that coverage, taken back.
 *
 * ⚠️ A CHALLENGE IS NOT A PASS AND NOT AN OUTAGE. `gradeFrontDoor` names it as
 * its own verdict, because reporting a checkpoint as DOWN produces the false
 * alarm that got the checks repointed the first time, and reporting it as UP
 * is the silence this issue is about. It is red, and it says which red it is.
 *
 * ⚠️ AND A 200 IS NOT A RENDER. Next serves the cached ISR document while
 * every regeneration underneath it throws, so a green row here is a statement
 * about the cache and not about the code. `readCacheState` reads where the
 * bytes came from — `x-vercel-cache` on Vercel, `x-nextjs-cache` on a local
 * `next start` — and `cacheNote` makes the row say so in words. It is not
 * GRADED, because grading a cache hit red would fire on ordinary traffic every
 * fifteen minutes, which is how the two GCP page checks got repointed off real
 * pages the first time. The check that does answer it is
 * `tools/scripts/check-render-errors.mjs`.
 */

/**
 * The two hostnames that serve PAGES, by the render canary each one stands
 * behind.
 *
 * `site` is the customer-shaped published site on the `.aglyn.app` tenant
 * apex; `marketing` is Aglyn's own marketing home, served by the same tenant
 * runtime through the `cname--` custom-domain path. Both are ISR routes under
 * `apps/tenant/app/[host]`, which is the code the outage was in — and they
 * reach it through two different host-resolution paths, so a middleware
 * regression that spares one is still caught by the other.
 *
 * Keyed by canary name on purpose: `evaluateFrontDoorReaders` holds the two
 * lists in lockstep, so a third canary cannot ship with only the proxy
 * measurement pointed at it.
 */
export const FRONT_DOORS = {
  site: 'https://demo.aglyn.app',
  marketing: 'https://aglyn.com',
}

/** A visitor arrives at the root. Nothing here probes a deep link. */
export const FRONT_DOOR_PATH = '/'

/** Row names carry this prefix so a log line says which kind of check it is. */
export const FRONT_DOOR_PREFIX = 'front-door'

/**
 * Vercel's challenge interstitial, which answers 429 to a client that cannot
 * run its JavaScript. Matched on the body as well as the status because a
 * challenge served with any other status is still a challenge, and grading it
 * on the status alone is how a 200-with-an-interstitial would read as a page.
 */
const CHECKPOINT_MARKER = /Vercel Security Checkpoint/i

/**
 * What proves the response is a page our app rendered.
 *
 * Deliberately structural and platform-level, never a string from the page.
 * Site copy belongs to whoever owns the site: a customer who rewrites their
 * home page must not red a platform monitor, which is the mistake
 * `customer-site` made before it was renamed away from asserting on the demo
 * site's own content.
 *
 *  - `</html>` — the document is COMPLETE. A truncated response, a proxy
 *    error page and a half-streamed render all fail here.
 *  - `/_next/static/` — Next produced it. An edge error page, a CDN
 *    interstitial and a parked-domain placeholder are all valid HTML and none
 *    of them carries our build's asset references.
 *
 * `<meta name="generator" content="Aglyn">` is deliberately NOT on this list
 * even though every page in the fixture carries one: it is SUPPRESSED on
 * white-labeled sites by design (AGL-2088), so asserting it would tie a
 * platform monitor to one host's plan.
 */
const PAGE_MARKERS = [
  { marker: '</html>', missing: 'incomplete document (no </html>)' },
  {
    marker: '/_next/static/',
    missing: 'no Next asset references — not our render',
  },
]

/**
 * Grade one front-door response the way a visitor experiences it.
 *
 * Pure, so the verdicts can be asserted without a network. `body` may be
 * truncated by the caller; every marker above appears in the first bytes of a
 * real render except `</html>`, so callers pass the whole body.
 *
 * @param {{status: number, contentType?: string|null, body?: string,
 *   location?: string|null}} response
 * @returns {{ok: boolean, detail: string, challenged: boolean}}
 */
export function gradeFrontDoor({
  status,
  contentType = null,
  body = '',
  location = null,
}) {
  // Ahead of the status check: a challenge can arrive under any status, and
  // naming it is the difference between "our monitor cannot see the site" and
  // "the site is down". Confusing those two is what this file exists for.
  if (CHECKPOINT_MARKER.test(body)) {
    return {
      ok: false,
      challenged: true,
      detail:
        `CHALLENGED (HTTP ${status}) — bot protection answered instead of the ` +
        'app; this is not a verdict on the site. Check AGLYN_PROBE_TOKEN and ' +
        'the "CI and uptime probe bypass" Vercel rule',
    }
  }

  // Never followed, for the reason `probe-uptime.mjs` gives: a base that
  // redirects would otherwise report the redirect target's health under this
  // name, which is how a monitor sat green on a hostname that served nothing.
  if (status >= 300 && status < 400) {
    return {
      ok: false,
      challenged: false,
      detail: `redirects to ${location ?? '?'} — probe the host that SERVES pages`,
    }
  }

  if (status !== 200) {
    return { ok: false, challenged: false, detail: `HTTP ${status}` }
  }

  if (!/text\/html/i.test(contentType ?? '')) {
    return {
      ok: false,
      challenged: false,
      detail: `not HTML (content-type: ${contentType || 'absent'})`,
    }
  }

  const missing = PAGE_MARKERS.filter(({ marker }) => !body.includes(marker))
  if (missing.length) {
    return {
      ok: false,
      challenged: false,
      detail: `200 but ${missing.map((m) => m.missing).join(' · ')}`,
    }
  }

  return { ok: true, challenged: false, detail: 'a visitor gets a page' }
}

/**
 * Cache states that mean THESE BYTES WERE RENDERED, against states that mean
 * they came out of a store.
 *
 * The distinction is the whole of the stale-ISR blind spot. A 200 from `HIT`
 * proves a render succeeded at some point in the past and nothing about
 * whether one would succeed now; a 200 from `MISS` was produced by a render
 * that ran during this request.
 *
 * ⚠️ `STALE` IS NOT A SIGNAL ON THIS DEPLOYMENT, and that was measured rather
 * than assumed. Both front doors read `STALE` at ages of 50–111 seconds on
 * 2026-09-09 with nothing wrong — the route sends `cache-control: public,
 * max-age=0, must-revalidate` and no `s-maxage`, so the edge revalidates
 * against the ISR store on essentially every request and `STALE` is its
 * resting state. Grading it, or grading `age` past a threshold, would red the
 * board every fifteen minutes forever. Both are REPORTED and neither is
 * graded; `check-render-errors.mjs` is what answers the question they only
 * hint at.
 */
const RENDERED_STATES = new Set(['MISS', 'BYPASS', 'REVALIDATED'])

/**
 * Where the bytes came from, read off the response headers.
 *
 * ⛔ `x-nextjs-cache` IS NOT SENT BY VERCEL. Measured 2026-09-09 against both
 * front doors with a bypass token: `demo.aglyn.app/` and `aglyn.com/` answer
 * `x-vercel-cache: STALE` / `HIT` plus `age`, `x-matched-path` and
 * `x-nextjs-prerender`, and no `x-nextjs-cache` at all. So the header this
 * probe originally recorded was absent on every production row, and the note
 * it was supposed to leave in the log — the one thing on the board that
 * acknowledged the ISR cache — never appeared.
 *
 * `x-nextjs-cache` stays as the fallback because it is Next's own server
 * header and this probe can be pointed at a local `next start` (see
 * `frontDoorPlan`), where there is no Vercel edge to rewrite it.
 *
 * `age` is the CDN's, in seconds. Reported beside the state because "HIT" on
 * its own does not say whether the document is a minute or a week old.
 *
 * @param {{vercelCache?: string|null, nextCache?: string|null,
 *   age?: string|null}} headers
 * @returns {{state: string|null, header: string|null, rendered: boolean|null,
 *   ageSeconds: number|null}}
 */
export function readCacheState({
  vercelCache = null,
  nextCache = null,
  age = null,
} = {}) {
  const raw = vercelCache ?? nextCache
  const header = vercelCache
    ? 'x-vercel-cache'
    : nextCache
      ? 'x-nextjs-cache'
      : null
  const state = raw ? raw.trim().toUpperCase() : null
  const parsedAge = Number.parseInt(age ?? '', 10)
  return {
    state,
    header,
    rendered: state === null ? null : RENDERED_STATES.has(state),
    ageSeconds: Number.isFinite(parsedAge) ? parsedAge : null,
  }
}

/**
 * The sentence a green page row adds about its own provenance.
 *
 * A green row that says nothing implies more than it measured, and that
 * implication is the AGL-2709 gap in one line: every check on the board read
 * 100.000% through ten minutes of every page answering 500. So a row served
 * out of the cache says so, and says what it therefore does NOT prove, and
 * names the check that does — `tools/scripts/check-render-errors.mjs`, which
 * reads the drained 5xx split by route.
 *
 * Nothing here changes a verdict. Grading a cache hit red would fire on
 * ordinary traffic every fifteen minutes, which is how the two GCP page checks
 * got repointed off real pages in the first place.
 */
export function cacheNote(cache) {
  if (!cache || cache.state === null) return null
  const age = cache.ageSeconds === null ? '' : ` age=${cache.ageSeconds}s`
  if (cache.rendered) return `cache=${cache.state}${age} — rendered now`
  return (
    `cache=${cache.state}${age} — FROM CACHE, so this 200 is not evidence ` +
    'the render works (check-render-errors.mjs is)'
  )
}

/**
 * Expand the front doors into probe rows, with optional per-name base
 * overrides.
 *
 * Overrides exist so the same grader can be pointed at a local production
 * server, which is the only way to watch this go red against real broken code
 * rather than against a hand-written fixture.
 *
 * An override may carry a PATH, and only an override may. Production probes
 * the root because that is where a visitor arrives; the local e2e fixture
 * seeds screens at `/home` and `/survey` and no root screen at all, so
 * pinning the path here would make every local run report a 404 and prove
 * nothing about the code under it.
 *
 * @param {Record<string, string>} overrides name -> base URL, optionally with
 *   a path
 * @param {Record<string, string>} frontDoors
 * @returns {Array<[string, string, string]>} [name, base, path]
 */
export function frontDoorPlan(overrides = {}, frontDoors = FRONT_DOORS) {
  return Object.entries(frontDoors).map(([name, base]) => {
    const override = overrides[name]
    if (!override)
      return [`${FRONT_DOOR_PREFIX}/${name}`, base, FRONT_DOOR_PATH]
    const url = new URL(override)
    const path = url.pathname === '/' ? FRONT_DOOR_PATH : url.pathname
    return [`${FRONT_DOOR_PREFIX}/${name}`, url.origin, `${path}${url.search}`]
  })
}

/**
 * Every render canary must have a front door of the same name, and vice
 * versa (AGL-2709).
 *
 * The lesson of the outage stated as a guard: a canary is a PROXY for a page,
 * and a proxy is only trustworthy while the thing it stands for is also
 * measured. Both canaries were green through ten minutes of every page
 * answering 500 — not because either was broken, but because nothing was
 * asking the question they approximate.
 *
 * `canaryRoutes` are the directory names under
 * `apps/tenant/app/api/health/render/`, read from the filesystem by the test
 * exactly as `evaluateCanaryReaders` reads them. So a third canary fails this
 * until somebody points a real page fetch at the same runtime, and a
 * front-door key that does not name a canary (a typo, a host that no longer
 * exists) fails it from the other side.
 */
export function evaluateFrontDoorReaders(
  canaryRoutes,
  frontDoors = FRONT_DOORS,
) {
  const doors = new Set(Object.keys(frontDoors))
  const canaries = new Set(canaryRoutes)
  const unpaired = [...canaries].filter((name) => !doors.has(name)).sort()
  const orphan = [...doors].filter((name) => !canaries.has(name)).sort()
  return { ok: unpaired.length === 0 && orphan.length === 0, unpaired, orphan }
}
