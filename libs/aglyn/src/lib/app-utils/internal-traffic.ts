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
 * both, and it was deliberately NOT a cookie: a cookie rides to the server on
 * every request and ends up in logs.
 *
 * ## Why a cookie now rides ALONGSIDE it (AGL-3175)
 *
 * That reasoning held while the surfaces were a fixed list. They are not. The
 * console is served on every `*.aglyn.com` hostname, and `WORKSPACE_DOMAIN` is
 * `aglyn.com`, so EVERY ORG WORKSPACE IS ITS OWN ORIGIN — fourteen distinct
 * hostnames have sent events to the property, among them generated slugs like
 * `34kwy7hnbr`. Per-origin storage cannot be opted into on a hostname that
 * does not exist yet, so the opt-in list was not merely incomplete, it was
 * uncompletable. `auth.aglyn.com` sat unpinned for a month on exactly that.
 *
 * So the opt-in is ALSO written as a cookie scoped to the workspace domain,
 * and either source turning it on is enough. What the cookie costs is what the
 * paragraph above says it costs: the constant string `internal` now appears in
 * request headers to our own hosts. It carries no identity — it says "this
 * browser is ours" and nothing about who is using it — and it rides beside
 * `__session`, which the same domain already carries.
 *
 * ## What still bounds it
 *
 * The cookie is written ONLY where a call site passes `cookieDomain`, and the
 * console's helper passes it only when the current hostname is under that
 * domain. Nothing here writes a cookie on a customer's custom domain, and
 * nothing needs to: published sites are on `aglyn.app` and custom domains,
 * which a `.aglyn.com` cookie cannot reach. That registrable-domain boundary
 * — not per-origin storage — is what keeps an opt-in on our console out of a
 * CUSTOMER's Analytics property while we click through their published site.
 *
 * `INTERNAL_TRAFFIC_GTAG_SNIPPET` is deliberately left on storage alone. It is
 * a constant string inlined into ISR-cached customer HTML (with a verbatim
 * copy in the docs site's config), it cannot be made hostname-aware, and every
 * surface that uses it is a fixed origin that can be pinned directly.
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
 * The cookie that carries the same opt-in across every origin under one
 * domain. Same name as the storage key on purpose: one concept, and a browser
 * inspector shows the two halves of it side by side under one label.
 */
export const INTERNAL_TRAFFIC_COOKIE_KEY = 'aglyn_traffic_type'

/**
 * 400 days, which is the ceiling Chrome clamps `Max-Age` to anyway. Expiry is
 * not a feature here — the opt-in is meant to be permanent, and a browser that
 * quietly forgets it puts our own browsing back into the launch metrics, which
 * a GA4 data filter cannot undo after the fact.
 */
const INTERNAL_TRAFFIC_COOKIE_MAX_AGE = 34_560_000

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
  /** `document.cookie`, for the READ half. Absent means no cookie source. */
  cookie?: string | null
  /**
   * The domain to scope the cookie WRITE to, bare (`aglyn.com`). Absent means
   * this call site does not write cookies at all, which is the default and
   * what every shared caller does — see the module comment. Only a call site
   * that has already established it is on a first-party host passes it.
   */
  cookieDomain?: string | null
  /** Where a written cookie goes. Defaults to `document.cookie`. */
  writeCookie?: ((serialized: string) => void) | null
}

/** Whether a `document.cookie` string carries our opt-in. Never throws. */
function cookieSaysInternal(cookie: string | null | undefined): boolean {
  if (!cookie) return false
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== INTERNAL_TRAFFIC_COOKIE_KEY) continue
    return part.slice(eq + 1).trim() === INTERNAL_TRAFFIC_VALUE
  }
  return false
}

/**
 * Mirror the opt-in into the domain-wide cookie, when the call site asked for
 * it. A no-op everywhere else, which is every shared caller.
 *
 * `SameSite=Lax` and `Secure` because this rides to our own hosts and has no
 * cross-site job; clearing writes the same attributes with `Max-Age=0`,
 * because a cookie is only replaced by one whose domain and path match.
 */
function writeInternalTrafficCookie(
  source: InternalTrafficOverrideSource,
  on: boolean,
): void {
  const domain = source.cookieDomain
  if (!domain) return
  const write =
    source.writeCookie ??
    (typeof document === 'undefined'
      ? null
      : (serialized: string): void => {
          document.cookie = serialized
        })
  if (!write) return
  try {
    write(
      `${INTERNAL_TRAFFIC_COOKIE_KEY}=${on ? INTERNAL_TRAFFIC_VALUE : ''}` +
        `; Domain=.${domain}; Path=/; SameSite=Lax; Secure` +
        `; Max-Age=${on ? INTERNAL_TRAFFIC_COOKIE_MAX_AGE : 0}`,
    )
  } catch {
    // A refused cookie jar leaves `localStorage` holding the opt-in for this
    // origin, which is where it lived before this existed.
  }
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
      : {
          search: window.location?.search,
          storage: safeLocalStorage(),
          cookie: safeDocumentCookie(),
        })
  const storage = resolved.storage
  // Read the cookie BEFORE the storage gate. A browser that refuses
  // `localStorage` outright — Safari private mode, a partitioned frame — can
  // still be one of ours, and before AGL-3175 that browser was unpinnable.
  let cookieOn = cookieSaysInternal(resolved.cookie)
  if (!storage) return cookieOn
  try {
    const search = resolved.search
    if (search) {
      const requested = new URLSearchParams(
        search.startsWith('?') ? search.slice(1) : search,
      ).get(INTERNAL_TRAFFIC_QUERY_PARAM)
      if (requested !== null) {
        // Both halves move together, so `?aglyn_internal=0` really is an
        // off switch: clearing storage while the cookie still said `internal`
        // would leave the browser pinned with nothing local to show for it.
        if (OFF_VALUES.has(requested.toLowerCase())) {
          storage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
          writeInternalTrafficCookie(resolved, false)
          cookieOn = false
        } else {
          storage.setItem(INTERNAL_TRAFFIC_STORAGE_KEY, INTERNAL_TRAFFIC_VALUE)
          writeInternalTrafficCookie(resolved, true)
          cookieOn = true
        }
      }
    }
    return (
      cookieOn ||
      storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY) === INTERNAL_TRAFFIC_VALUE
    )
  } catch {
    // Storage access can throw outright (Safari private mode, a partitioned
    // third-party context). The cookie is the other half and may still answer.
    return cookieOn
  }
}

/** `document.cookie` where reaching for it does not throw, else null. */
function safeDocumentCookie(): string | null {
  try {
    return typeof document === 'undefined' ? null : document.cookie
  } catch {
    return null
  }
}

/**
 * The override, pinned domain-wide rather than per origin (AGL-3175).
 *
 * For the console, which is the surface served on an open-ended set of
 * `*.aglyn.com` origins. The hostname check is the gate the module comment
 * describes: it is what guarantees no cookie is ever written on a customer's
 * custom domain, and it also keeps `localhost` and preview deployments — where
 * a `Secure` cookie for another domain would be rejected anyway — writing
 * nothing but `localStorage`, exactly as before.
 */
export function readInternalTrafficOverrideForDomain(
  domain: string | null | undefined,
): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location?.hostname ?? ''
  const underDomain =
    !!domain && (host === domain || host.endsWith(`.${domain}`))
  return readInternalTrafficOverride({
    search: window.location?.search,
    storage: safeLocalStorage(),
    cookie: safeDocumentCookie(),
    cookieDomain: underDomain ? domain : null,
  })
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

/**
 * The stamp with no opt-in check at all, for a build that has already decided
 * every one of its hits is ours (AGL-2067).
 *
 * Used only where `analyticsEnvironmentForcesInternal()` holds: a
 * non-production build running with the analytics escape hatch on. Nobody
 * reaches that state by accident, so consulting the browser as well would only
 * create a way for it to be wrong.
 */
export const INTERNAL_TRAFFIC_FORCED_SNIPPET =
  `gtag('set',{'${INTERNAL_TRAFFIC_PARAM}':'${INTERNAL_TRAFFIC_VALUE}'});`

export default readInternalTrafficOverride
