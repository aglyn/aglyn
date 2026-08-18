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
 * The GA4 event parameter GA's built-in internal-traffic data filter matches
 * on, and the value its default rule uses.
 *
 * Named here rather than inlined because the strings have to agree with a
 * setting in the GA UI that nothing in this repo can typecheck against — see
 * `docs/ANALYTICS.md` §8 — and because THREE surfaces now stamp them: the
 * console through Firebase's `setDefaultEventParameters`, the tenant runtime
 * and the docs site through a raw `gtag('set', …)`. One definition is what
 * keeps the console's parameter and the marketing site's parameter the same
 * parameter; two spellings would read as two dimensions in GA and the filter
 * would catch one of them.
 */
export const INTERNAL_TRAFFIC_PARAM = 'traffic_type'
export const INTERNAL_TRAFFIC_VALUE = 'internal'

/**
 * Where a browser's opt-in is remembered, and the query parameter that sets
 * it (AGL-2064 / AGL-2065).
 *
 * ## Why an explicit override exists at all
 *
 * The AGL-1582 predicate keys on ID-token claims — `staff` or `impersonatedBy`
 * — which is right, and insufficient. Several release drills REQUIRE a
 * non-staff account: the marketplace publisher drill cannot be run by staff at
 * all, because the thing being exercised is a publisher installing their own
 * unreviewed version. Those sessions emit `sign_up`, `org_created`,
 * `host_created`, `site_published` and `begin_checkout` — precisely the
 * activation and revenue events the September funnel is read from — and the
 * claims predicate correctly declines to flag them.
 *
 * Widening the predicate would be the wrong repair. It would flag by identity,
 * and a customer identity is the point of the drill. So the override is a
 * property of the BROWSER, not of the account: a browser we have declared to
 * be ours stays ours across sign-outs, re-auths and whichever test account is
 * currently signed in.
 *
 * And the marketing surface has no account to consult in the first place —
 * `aglyn.com`, `/pricing` and every published site are browsed logged out,
 * which is why that leak is the larger one and why this is the only mechanism
 * that can close it.
 *
 * ## Why `localStorage`, and what being origin-scoped costs
 *
 * It has to survive a reload and a full page navigation, which rules out
 * module state, and it has to be readable by an inline script before the tag
 * library loads, which rules out anything asynchronous. `localStorage` is
 * both, and it is deliberately NOT a cookie: a cookie would ride to the server
 * on every request and end up in logs.
 *
 * The cost is that the opt-in is per ORIGIN, so it must be performed once on
 * `app.aglyn.com`, once on `aglyn.com`, and once on each `localhost:PORT` in
 * use. That is a documented property rather than a defect — it is also what
 * makes it impossible for an opt-in on our console to leak a stamp into a
 * CUSTOMER's Analytics property while we click through their published site.
 *
 * ## Bias
 *
 * Opt-in only, never inferred. Wrongly flagging a real customer erases them
 * from every report and a GA4 data filter is not retroactive, so every
 * ambiguous case here resolves to "not internal".
 */
export const INTERNAL_TRAFFIC_STORAGE_KEY = 'aglyn_traffic_type'
export const INTERNAL_TRAFFIC_QUERY_PARAM = 'aglyn_internal'

/**
 * The values of `?aglyn_internal=` that turn the override OFF again. Anything
 * else present turns it on, so `?aglyn_internal` with no value works — that is
 * the form someone types from memory.
 */
const OFF_VALUES = new Set(['0', 'false', 'off', 'no'])

/** The browser bits `readInternalTrafficOverride` needs, so a test can supply them. */
export interface InternalTrafficOverrideSource {
  /** `window.location.search`, leading `?` optional. */
  search?: string | null
  /** `window.localStorage`, or null where the browser refuses one. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

/**
 * Whether THIS BROWSER has been declared one of ours, applying `?aglyn_internal`
 * first if it is on the URL.
 *
 * Reading and writing in one call is deliberate: the query parameter has to
 * take effect on the pageview that carries it, not on the next one, because
 * the pageview that carries it is already a hit. Persisting it here is what
 * makes the single `?aglyn_internal=1` visit enough.
 *
 * Never throws. A browser with `localStorage` disabled, a sandboxed iframe and
 * a server render all resolve to `false` — the not-internal direction, which
 * is the safe one.
 */
export function readInternalTrafficOverride(
  source?: InternalTrafficOverrideSource,
): boolean {
  const resolved: InternalTrafficOverrideSource =
    source ??
    (typeof window === 'undefined'
      ? {}
      : { search: window.location?.search, storage: safeLocalStorage() })
  const storage = resolved.storage
  if (!storage) return false
  try {
    const search = resolved.search
    if (search) {
      const requested = new URLSearchParams(
        search.startsWith('?') ? search.slice(1) : search,
      ).get(INTERNAL_TRAFFIC_QUERY_PARAM)
      if (requested !== null) {
        if (OFF_VALUES.has(requested.toLowerCase())) {
          storage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
        } else {
          storage.setItem(INTERNAL_TRAFFIC_STORAGE_KEY, INTERNAL_TRAFFIC_VALUE)
        }
      }
    }
    return storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY) === INTERNAL_TRAFFIC_VALUE
  } catch {
    // Storage access can throw outright (Safari private mode, a partitioned
    // third-party context). Not internal.
    return false
  }
}

/** `window.localStorage` where reaching for it does not throw, else null. */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The same decision as `readInternalTrafficOverride`, as a CONSTANT string of
 * JavaScript, for the surfaces that drive gtag directly (AGL-2064).
 *
 * ## Why a string, and why it must stay constant
 *
 * The tenant runtime serves ISR-cached HTML: one cached document is handed to
 * every visitor, so nothing about this decision may be made while rendering.
 * A server-side branch would bake one browser's answer into the cache for
 * everyone, and a first-client-render branch would break hydration. Emitting
 * the same bytes to everyone and letting them decide AT RUNTIME, in the
 * browser, is the only shape that is both correct and cacheable — the same
 * move `consent.ready` makes one layer up.
 *
 * ## Why it must run before `gtag('config', …)`
 *
 * GA4's internal-traffic filter matches per EVENT, and the events that leak
 * are the ones no call site writes: `session_start`, `first_visit`,
 * `user_engagement` and the automatic `page_view`. A `gtag('set', …)` applies
 * to every hit gtag processes AFTER it in queue order, so placed between the
 * `dataLayer` shim and the `config` call it rides all of them. Placed after
 * `config` it would miss the session's first pageview — which is the whole
 * session, for a marketing visit.
 *
 * ## Safe to inline
 *
 * No interpolation, so nothing can inject; contains no `<` at all, so it
 * cannot close its own `<script>` element. It assumes only that a `gtag`
 * function is already defined, which is the line immediately above it in every
 * call site.
 */
export const INTERNAL_TRAFFIC_GTAG_SNIPPET =
  'try{' +
  `var aq=new URLSearchParams(location.search).get('${INTERNAL_TRAFFIC_QUERY_PARAM}');` +
  'if(aq!==null){' +
  `if(['${[...OFF_VALUES].join("','")}'].indexOf(aq.toLowerCase())>=0)` +
  `localStorage.removeItem('${INTERNAL_TRAFFIC_STORAGE_KEY}');` +
  `else localStorage.setItem('${INTERNAL_TRAFFIC_STORAGE_KEY}','${INTERNAL_TRAFFIC_VALUE}');` +
  '}' +
  `if(localStorage.getItem('${INTERNAL_TRAFFIC_STORAGE_KEY}')==='${INTERNAL_TRAFFIC_VALUE}')` +
  `gtag('set',{'${INTERNAL_TRAFFIC_PARAM}':'${INTERNAL_TRAFFIC_VALUE}'});` +
  '}catch(e){}'

export default readInternalTrafficOverride
