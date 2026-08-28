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
 * Visitor consent for AGLYN'S OWN console (`app.aglyn.com`) — the same
 * decision the tenant runtime makes for a customer site, resolved against a
 * surface that has no host document.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is a COMPOSITION of `visitor-consent.ts`, not a second consent engine.
 * Every question a decision actually turns on is answered there: which
 * statuses grant which category ({@link analyticsGrantedByStatus},
 * {@link advertisingGrantedByStatus}), how a record is read and written
 * ({@link readStoredVisitorConsent}, {@link storeVisitorConsent}), what a
 * withdrawal sweeps, and what consent-mode signals a pair of grants becomes
 * ({@link consentModeSignals}). A second implementation of any of those is how
 * two surfaces come to disagree about whether a visitor said yes, and the
 * disagreement is invisible from either side.
 *
 * What lives here is only what the console answers DIFFERENTLY, and there are
 * exactly three such things:
 *
 * 1. **There is no host document.** A customer site's posture, its gated
 *    categories and its advertising question all come off `hosts/{id}`. The
 *    console has none, so the equivalents are constants derived below from
 *    what this surface actually runs.
 * 2. **The prior-consent region set is the platform's, not the tenant's.**
 *    `PLATFORM_PRIOR_CONSENT_REGIONS` adds Switzerland to the tenant's
 *    ePrivacy set, because Aglyn's own brief treats CH as prior opt-in while
 *    the tenant set stays exactly as customers' sites have it. Reusing that
 *    constant rather than restating a country list is the point — two
 *    hand-kept lists is how one of them ends up a year behind the other.
 * 3. **The storage subject is fixed.** Records are keyed by host id so one
 *    site's yes cannot leak to another's; the console is one surface, so it
 *    takes one constant subject and shares the same `aglyn:consent:` prefix,
 *    the same versioned record shape, and the same reader/writer.
 *
 * ## The posture, which is the tenant's posture
 *
 * - **UK / EU / EEA — and any visitor whose region cannot be determined** —
 *   `opt-in`: nothing non-essential runs until an explicit accept. Undecided
 *   is not a maybe.
 * - **Everywhere else** — `opt-out`: implied consent is recorded on the first
 *   visit, analytics runs from that first paint, and the visitor can withdraw
 *   at any time from the account menu.
 * - **GPC** is honored as an automatic opt-out in both postures, and is
 *   overridden only by a later explicit accept.
 *
 * ## Advertising on this surface
 *
 * Asked about only where something would read the answer — see
 * {@link platformAsksAboutAdvertising}, which derives it from the consent
 * defaults this surface actually declares rather than from a flag someone has
 * to remember to keep in step.
 */

import {
  PLATFORM_CONSENT_DEFAULT_COMMANDS,
  PLATFORM_PRIOR_CONSENT_REGIONS,
} from './platform-consent-default'
import {
  analyticsGrantedByStatus,
  hasGlobalPrivacyControl,
  isExplicitConsentStatus,
  readStoredVisitorConsent,
  type StoredVisitorConsent,
  storeVisitorConsent,
  type VisitorConsentPosture,
  type VisitorConsentStatus,
} from './visitor-consent'

/**
 * The storage subject for the console's own consent record.
 *
 * `visitorConsentStorageKey` keys records by host id because preview
 * deployments and localhost serve many customer sites from one origin. The
 * console is a single surface, so it takes a constant — but it takes it
 * through the same key builder, so a console record and a customer-site record
 * can never collide, and a self-hosted console on the same origin as a site
 * keeps its own.
 *
 * A name, not a hostname: the console is served from `app.aglyn.com`, from a
 * custom console domain (AGL-1099c), and from localhost, and a visitor's
 * choice is about the surface rather than about which of its origins they
 * reached it through.
 */
export const PLATFORM_CONSENT_SUBJECT = 'aglyn-console'

/**
 * Where the client asks which country it is visiting from.
 *
 * The same path the tenant runtime uses, and for the same reason: the answer
 * is a per-visitor request header, so it cannot be baked into a render. Each
 * app serves its own route handler at this path.
 */
export const PLATFORM_CONSENT_REGION_ENDPOINT = '/api/consent/region'

/** Session-scoped region cache — one lookup per visit, not per pageview. */
export const PLATFORM_CONSENT_REGION_CACHE_KEY = 'aglyn:consent:region'

/**
 * Whether this surface asks its visitors about advertising storage.
 *
 * DERIVED from {@link PLATFORM_CONSENT_DEFAULT_COMMANDS} rather than declared
 * as its own flag. Those commands are what the console tells gtag about ad
 * storage, so the question and the declaration cannot drift: a surface that
 * denies advertising in every region asks nothing, and one that grants it
 * anywhere asks.
 *
 * A control whose answer changes nothing is decoration, and decoration is what
 * teaches people to click past the controls that do matter — which is the
 * whole reason this is derived rather than hardcoded either way.
 *
 * The console currently grants advertising outside the prior-consent regions,
 * because Aglyn advertises, remarkets and retargets on its own surfaces and
 * the Privacy Policy names this one among them. So the question IS asked, and
 * a visitor who declines gets the signals denied and the tags torn down.
 *
 * `every`, so a single region-scoped grant is enough to make the question
 * real. The console's whole visitor population is not asked about a category
 * because one region's declaration happens to deny it.
 */
export function platformAsksAboutAdvertising(): boolean {
  return !PLATFORM_CONSENT_DEFAULT_COMMANDS.every(
    (command) => command.ad_storage === 'denied',
  )
}

/**
 * The per-visitor posture for the console, from the country the region
 * endpoint reports.
 *
 * Unknown region falls to `opt-in`, exactly as it does for a customer site:
 * the asymmetry is a few lost analytics events on a rare headerless visit,
 * against pre-consent tracking of a European visitor.
 *
 * A separate function from the tenant's `resolveConsentPosture` because it
 * answers over a different country set (see the module comment) — and it reads
 * that set from `platform-consent-default.ts` rather than restating it, so the
 * console's gate and the console's consent-mode declaration can never disagree
 * about which regions require asking first.
 */
export function platformConsentPosture(
  country: string | null | undefined,
): VisitorConsentPosture {
  if (!country) return 'opt-in'
  return PLATFORM_PRIOR_CONSENT_REGIONS.indexOf(country.toUpperCase()) >= 0
    ? 'opt-in'
    : 'opt-out'
}

/** The console visitor's stored record, or null when there is none. */
export function readPlatformConsent(): StoredVisitorConsent | null {
  return readStoredVisitorConsent(PLATFORM_CONSENT_SUBJECT)
}

/**
 * Record a console consent state.
 *
 * Delegates wholesale, which is what carries the withdrawal behaviour: the
 * shared writer re-derives both grants from the status, silences any resident
 * GA tag, sweeps the analytics and advertising cookies, drops the persistent
 * visitor id, and dispatches `VISITOR_CONSENT_CHANGED_EVENT`. The console's
 * analytics gate listens for that event, which is what makes a refusal act on
 * this pageview instead of the next one.
 */
export function storePlatformConsent(state: {
  status: VisitorConsentStatus
  country?: string | null
  advertising?: boolean
}): StoredVisitorConsent {
  return storeVisitorConsent(PLATFORM_CONSENT_SUBJECT, state)
}

/**
 * The gate's whole verdict: may analytics run for this console visitor right
 * now?
 *
 * Reads storage on every call rather than caching, because it is consulted
 * synchronously from the Firebase services boot — before any effect has run,
 * and again after a consent change — and a cached answer is exactly how a
 * withdrawal fails to take effect until a reload.
 *
 * Absent record answers NO. That is the load-bearing half: an undecided
 * visitor is a visitor the tag stays out of, whatever the reason for their
 * being undecided, so the gate never has to ask WHY.
 */
export function platformAnalyticsAllowed(): boolean {
  return readPlatformConsent()?.analytics === true
}

/** Whether advertising storage may run for this console visitor. */
export function platformAdvertisingAllowed(): boolean {
  if (!platformAsksAboutAdvertising()) return false
  return readPlatformConsent()?.advertising === true
}

/** The console's resolution of a visitor, with no React in it. */
export interface ResolvedPlatformConsent {
  stored: StoredVisitorConsent | null
  posture: VisitorConsentPosture | null
  country: string | null
}

/**
 * Ask the region endpoint which country this visitor is in, once per visit.
 *
 * A successful `null` is cached too — "the edge sends no geo here" is an
 * answer, and re-asking cannot improve it this session. A network failure is
 * NOT cached and reads as unknown region, which resolves to the strict side.
 */
export async function resolvePlatformConsentCountry(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    const cached = window.sessionStorage.getItem(
      PLATFORM_CONSENT_REGION_CACHE_KEY,
    )
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed && 'country' in parsed) {
        return typeof parsed.country === 'string' ? parsed.country : null
      }
    }
  } catch {
    // No storage — ask every pageview; correct, just less frugal.
  }
  try {
    const response = await fetch(PLATFORM_CONSENT_REGION_ENDPOINT)
    if (!response.ok) return null
    const payload = await response.json().catch((): null => null)
    const country = typeof payload?.country === 'string' ? payload.country : null
    try {
      window.sessionStorage.setItem(
        PLATFORM_CONSENT_REGION_CACHE_KEY,
        JSON.stringify({ country }),
      )
    } catch {
      // Best-effort cache only.
    }
    return country
  } catch {
    // Network failure reads as unknown region, which is the opt-in side.
    return null
  }
}

/**
 * `?aglynConsent=ask` simulates a first prior-consent visit.
 *
 * Honored on any surface because it only ever moves TOWARD strictness: it can
 * show someone a banner they have already answered, never strip one and never
 * un-decline a decline. Choices made under it are stored for real — they are
 * the visitor's own clicks.
 */
function hasAskOverride(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get('aglynConsent') === 'ask'
    )
  } catch {
    return false
  }
}

/**
 * Resolve this visitor's console consent state, most binding signal first:
 *
 * 1. An EXPLICIT stored choice — theirs; keep it, and skip the region lookup.
 * 2. GPC — the browser's opt-out overrides an implied default (it can arrive
 *    after one was recorded) but never an explicit accept.
 * 3. Any other stored record — resolved on a previous visit.
 * 4. Nothing stored: ask the region endpoint and apply the posture. `opt-out`
 *    records `implied` and analytics is live from this paint; `opt-in` leaves
 *    the visitor undecided, which keeps the tag out until the banner gets a
 *    yes.
 *
 * Idempotent: it reads and writes the same storage deterministically and the
 * region lookup is session-cached, so running it twice costs one network call
 * and reaches one answer.
 */
export async function decidePlatformConsent(): Promise<ResolvedPlatformConsent> {
  if (typeof window === 'undefined') {
    return { stored: null, posture: null, country: null }
  }
  if (hasAskOverride()) {
    return { stored: null, posture: 'opt-in', country: null }
  }
  let stored = readPlatformConsent()
  if (
    hasGlobalPrivacyControl() &&
    !isExplicitConsentStatus(stored?.status) &&
    stored?.status !== 'gpc-opt-out'
  ) {
    stored = storePlatformConsent({
      status: 'gpc-opt-out',
      country: stored?.country ?? null,
    })
  }
  if (stored) {
    return { stored, posture: null, country: stored.country ?? null }
  }
  const country = await resolvePlatformConsentCountry()
  const posture = platformConsentPosture(country)
  if (posture === 'opt-out') {
    return {
      // Implied consent, recorded as such. `storeVisitorConsent` re-derives
      // both grants from the status, so the advertising half is whatever this
      // surface can honestly carry — nothing, while nothing here reads it.
      stored: storePlatformConsent({
        status: 'implied',
        country,
        advertising: platformAsksAboutAdvertising(),
      }),
      posture,
      country,
    }
  }
  return { stored: null, posture, country }
}

/**
 * The refusal a "no" means for a visitor in this state.
 *
 * `opted-out` when they were defaulted in, `declined` when they were asked
 * first. Same gate either way; distinct record, because "how many visitors
 * were tracked before they said no" is a question the two answers separate.
 */
export function platformRefusalStatus(
  stored: StoredVisitorConsent | null,
  posture: VisitorConsentPosture | null,
): VisitorConsentStatus {
  return stored?.status === 'implied' || posture === 'opt-out'
    ? 'opted-out'
    : 'declined'
}

/**
 * Whether a status the panel is about to write would grant analytics — used to
 * label the control, never to decide the gate.
 */
export function platformStatusGrantsAnalytics(
  status: VisitorConsentStatus,
): boolean {
  return analyticsGrantedByStatus(status)
}

/**
 * One-shot guard so a pageview asks the region endpoint once, not once per
 * render pass.
 */
const primed = new Set<string>()

/**
 * Start the resolution WITHOUT waiting for React to commit.
 *
 * The gate component's effect is the normal path and does this too. It is not
 * enough on its own: an effect only runs if React commits, and a console that
 * renders but never commits — a suspended provider above the tree — would
 * otherwise leave a rest-of-world visitor permanently undecided and therefore
 * permanently unmeasured. Fire-and-forget; the answer lands in storage, so
 * whenever the component does run it reads it rather than asking again.
 */
export function primePlatformConsent(): void {
  if (typeof window === 'undefined') return
  const key = String(window.location?.pathname ?? '')
  if (primed.has(key)) return
  primed.add(key)
  void decidePlatformConsent().catch((): undefined => undefined)
}

/** Test seam: forget which pageviews have already been primed. */
export function resetPlatformConsentPriming(): void {
  primed.clear()
}
