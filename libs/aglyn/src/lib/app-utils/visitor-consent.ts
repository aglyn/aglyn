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
 * Visitor tracking consent (AGL-1498): the single answer to "may this
 * tracking feature run for this visitor?", shared by every surface that has
 * to agree about it — the tenant's GA injection, the consent banner, the
 * marketing runtime's visitor id, the console card that configures it, and
 * the console preview's region simulator.
 *
 * The model, and the honesty bar it was built against:
 *
 * - **Strictly necessary — no consent asked, none required.** The cart cookie
 *   (`aglyn_cart_{hostId}`, commerce checkout), the member session
 *   (`aglyn_member_{hostId}`, memberships sign-in), the `aglyn-tenant-host`
 *   preview-host override, popup/announcement dismissal stamps (local-only,
 *   never transmitted, and blocking them would show MORE popups), the
 *   first-party pageview beacon (cookieless, stores no visitor identifier —
 *   AGL-82), and the stored consent choice itself.
 * - **Consent-gated: `analytics`.** Today that is the customer-configured
 *   Google Analytics tag — a third-party identifier-setting script — plus
 *   the CROSS-VISIT persistence of the `aglyn:visitor` experiment id (the id
 *   never leaves the browser, but an indefinite-lifetime identifier is
 *   disproportionate without a basis; without one it degrades to
 *   sessionStorage, so variants stay stable within the visit).
 *
 * **Two postures, resolved per visitor** (the Squarespace shape, host-chosen):
 *
 * - **`opt-in`** — prior consent: nothing gated loads until an explicit
 *   accept. Applied in regions whose law requires prior consent (EU/EEA/UK),
 *   whenever the visitor's region is UNKNOWN, and everywhere when the host
 *   picks `strict` mode. Unknown-geo falls to opt-in deliberately: the
 *   asymmetry is a few lost analytics events on rare headerless visits
 *   versus pre-consent tracking of an EU visitor.
 * - **`opt-out`** — implied consent: gated features are live from first
 *   paint, no banner and no notice; the visitor's recorded state is
 *   `implied`, and the always-present "Privacy choices" control is the
 *   opt-out surface. Applied outside prior-consent regions when the host
 *   mode is `geo`.
 *
 * **GPC (Global Privacy Control)** is honored as an automatic opt-out in
 * both postures: a visitor whose browser sends it is recorded `gpc-opt-out`
 * and never tracked, unless they later explicitly accept (the signal is a
 * default; a specific, informed choice overrides it).
 *
 * Enforcement is AT THE SOURCE and MODE-INDEPENDENT: whenever the verdict is
 * "no", the GA script never loads — not load-then-suppress — and the gate
 * does not care WHY consent is absent. Because tenant pages are ISR-cached,
 * both the posture and the verdict are evaluated client-side only — the
 * cached HTML never varies by region or consent state.
 */

/** The host fields this module reads; keeps callers free of the full doc. */
export interface VisitorConsentHost {
  analytics?: {
    gaMeasurementId?: string
  } | null
  consent?: {
    /**
     * Host opt-out of the whole tool (AGL-1498). PERSISTED NAME. `true`
     * means the host runs their own consent solution (or accepts the
     * exposure): no banner, no privacy-choices control, and gated features
     * load for every visitor. Absent means the tool is active.
     */
    disabled?: boolean
    /**
     * The host's consent posture (AGL-1498). PERSISTED NAME.
     * - `'geo'` — geo-conditional: implied consent (tracking on, opt-out
     *   offered) outside prior-consent regions; a prior-consent banner in
     *   EU/EEA/UK and wherever the region is unknown.
     * - `'strict'` — opt-in everywhere: every visitor gets the banner.
     * Absent behaves as `'geo'` — the field practice (Squarespace) and the
     * posture the console preselects; recorded here so nobody discovers it
     * by surprise.
     */
    mode?: 'geo' | 'strict'
  } | null
}

/** The host's configured posture; absent means `'geo'`. */
export type HostConsentMode = 'geo' | 'strict'

/** The per-visitor resolved posture. */
export type VisitorConsentPosture = 'opt-in' | 'opt-out'

/**
 * Consent-gated feature categories. `analytics` is the only gated category
 * today; the stored shape is keyed by category so adding one (e.g.
 * `marketing`) extends rather than migrates.
 */
export type VisitorConsentCategory = 'analytics'

/**
 * A visitor's recorded consent state. The five are DISTINCT on purpose:
 * "how many visitors are tracked" (and any future regulator question) needs
 * to distinguish a visitor who clicked Accept from one who was defaulted in.
 *
 * - `implied` — opt-out posture, no action taken: tracking is on.
 * - `accepted` — explicit yes (either posture): tracking is on.
 * - `declined` — explicit no to a prior-consent banner: tracking is off.
 * - `opted-out` — explicit opt-out from the implied default: tracking off.
 * - `gpc-opt-out` — the browser's GPC signal, honored: tracking off.
 */
export type VisitorConsentStatus =
  | 'implied'
  | 'accepted'
  | 'declined'
  | 'opted-out'
  | 'gpc-opt-out'

const CONSENT_STATUSES: ReadonlySet<string> = new Set([
  'implied',
  'accepted',
  'declined',
  'opted-out',
  'gpc-opt-out',
])

/** The statuses that are a visitor's own click, not a default or a signal. */
export function isExplicitConsentStatus(
  status: VisitorConsentStatus | null | undefined,
): boolean {
  return (
    status === 'accepted' || status === 'declined' || status === 'opted-out'
  )
}

/** Whether a status grants the analytics category. */
export function analyticsGrantedByStatus(
  status: VisitorConsentStatus,
): boolean {
  return status === 'accepted' || status === 'implied'
}

/**
 * Strict GA measurement-id check (AGL-138) — the id lands inside an inline
 * script, so the format gate is load-bearing, not cosmetic.
 */
export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/

/** The configured GA id when it is well-formed, else null. */
export function resolveGaMeasurementId(
  host: VisitorConsentHost | null | undefined,
): string | null {
  const candidate = String(host?.analytics?.gaMeasurementId ?? '')
  return GA_MEASUREMENT_ID_PATTERN.test(candidate) ? candidate : null
}

/** Host opt-out of the tool. Absent means ACTIVE — the safe default. */
export function isConsentToolDisabled(
  host: VisitorConsentHost | null | undefined,
): boolean {
  return host?.consent?.disabled === true
}

/** The host's posture choice; anything but `'strict'` reads as `'geo'`. */
export function resolveHostConsentMode(
  host: VisitorConsentHost | null | undefined,
): HostConsentMode {
  return host?.consent?.mode === 'strict' ? 'strict' : 'geo'
}

/**
 * The gated categories this site actually uses. Empty means there is
 * nothing to consent to and no consent UI renders — a banner with no
 * question behind it is decoration that trains visitors to click banners.
 */
export function consentGatedCategories(
  host: VisitorConsentHost | null | undefined,
): VisitorConsentCategory[] {
  return resolveGaMeasurementId(host) ? ['analytics'] : []
}

/**
 * Whether the published site runs the consent machinery at all: the tool is
 * active AND the site uses at least one gated feature.
 */
export function hostConsentRequired(
  host: VisitorConsentHost | null | undefined,
): boolean {
  return !isConsentToolDisabled(host) && consentGatedCategories(host).length > 0
}

/**
 * Regions whose law requires PRIOR consent for non-essential
 * cookies/identifiers (ePrivacy and its UK retention): the EU 27, the three
 * EEA/EFTA states, the UK, Gibraltar (UK GDPR extends there), and the EU
 * outermost regions that carry their own ISO codes. ISO 3166-1 alpha-2,
 * matching `x-vercel-ip-country`.
 *
 * Deliberately NOT a "privacy-law countries" list: plenty of laws (CCPA,
 * LGPD, PIPEDA) regulate tracking on an opt-out basis, which is exactly what
 * the opt-out posture plus GPC provides. This set is only the prior-consent
 * boundary.
 */
export const PRIOR_CONSENT_COUNTRY_CODES: ReadonlySet<string> = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA / EFTA
  'IS', 'LI', 'NO',
  // UK and Gibraltar
  'GB', 'GI',
  // EU outermost regions with their own ISO codes (legally EU territory)
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT',
])

/**
 * The per-visitor posture. Client-evaluated (ISR forbids varying the HTML),
 * from the country the region endpoint reports.
 *
 * Unknown region (`null`) falls to `opt-in` — the ONE place this feature
 * does not maximize tracking, because the asymmetry is lopsided: a few lost
 * analytics events on rare headerless visits, versus pre-consent tracking
 * of an EU visitor, which "track as soon as we legally can" excludes by its
 * own terms.
 */
export function resolveConsentPosture(
  host: VisitorConsentHost | null | undefined,
  country: string | null | undefined,
): VisitorConsentPosture {
  if (resolveHostConsentMode(host) === 'strict') return 'opt-in'
  if (!country) return 'opt-in'
  return PRIOR_CONSENT_COUNTRY_CODES.has(country.toUpperCase())
    ? 'opt-in'
    : 'opt-out'
}

/**
 * Whether this browser sends Global Privacy Control. Read live at decision
 * time — the signal is the user agent's, not ours to cache.
 */
export function hasGlobalPrivacyControl(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as { globalPrivacyControl?: unknown }).globalPrivacyControl ===
      true
  )
}

/**
 * A visitor's stored consent record. Versioned so a future category
 * addition can distinguish "declined analytics" from "was never asked about
 * marketing".
 */
export interface StoredVisitorConsent {
  v: 1
  /** Epoch ms of the decision (or of the implied default's recording). */
  at: number
  status: VisitorConsentStatus
  /** The category grant, derived from `status` at store time. */
  analytics: boolean
  /** ISO country at decision time, when known — the `implied,us` shape. */
  country?: string | null
}

/**
 * Keyed by hostId, not a bare name: preview deployments and localhost serve
 * many hosts from one origin, and one site's "yes" must never leak to
 * another's.
 */
export const VISITOR_CONSENT_STORAGE_PREFIX = 'aglyn:consent:'

/** The marketing runtime's cross-visit experiment id (`site-runtime.tsx`). */
export const VISITOR_ID_STORAGE_KEY = 'aglyn:visitor'

/** Fired on `window` whenever {@link storeVisitorConsent} records a state. */
export const VISITOR_CONSENT_CHANGED_EVENT = 'aglyn:consent:changed'

/**
 * Fired on `window` to open the privacy-choices panel — the change-your-mind
 * path, in BOTH directions. Sites can also link any element to
 * `#aglyn-consent`; the banner listens for those clicks.
 */
export const VISITOR_CONSENT_OPEN_EVENT = 'aglyn:consent:open'

export function visitorConsentStorageKey(hostId: string): string {
  return `${VISITOR_CONSENT_STORAGE_PREFIX}${hostId}`
}

/**
 * The stored record, or null when there is none (never resolved, storage
 * unavailable, or an unrecognized shape — treated alike: not yet decided).
 */
export function readStoredVisitorConsent(
  hostId: string | null | undefined,
): StoredVisitorConsent | null {
  if (!hostId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(visitorConsentStorageKey(hostId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed?.v !== 1 ||
      typeof parsed.status !== 'string' ||
      !CONSENT_STATUSES.has(parsed.status)
    ) {
      return null
    }
    const status = parsed.status as VisitorConsentStatus
    return {
      v: 1,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
      status,
      // Derived, never trusted from storage: a hand-edited record must not
      // grant what its status does not.
      analytics: analyticsGrantedByStatus(status),
      country: typeof parsed.country === 'string' ? parsed.country : null,
    }
  } catch {
    // No storage (privacy mode) or corrupt JSON — the visitor is simply
    // undecided, which is the safe reading.
    return null
  }
}

/**
 * Record a consent state and make the page agree with it immediately.
 *
 * Storing the record is itself strictly-necessary storage (it is how a "no"
 * is remembered), so it is exempt from the consent it records. Any
 * non-granting state also REMOVES the persistent `aglyn:visitor` id:
 * opting out cleans up, it does not merely stop adding. Listeners hear
 * about it via {@link VISITOR_CONSENT_CHANGED_EVENT} so the GA gate and the
 * runtime react without a reload.
 */
export function storeVisitorConsent(
  hostId: string,
  state: { status: VisitorConsentStatus; country?: string | null },
): StoredVisitorConsent {
  const stored: StoredVisitorConsent = {
    v: 1,
    at: Date.now(),
    status: state.status,
    analytics: analyticsGrantedByStatus(state.status),
    country: state.country ?? null,
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        visitorConsentStorageKey(hostId),
        JSON.stringify(stored),
      )
      if (!stored.analytics) {
        window.localStorage.removeItem(VISITOR_ID_STORAGE_KEY)
      }
    } catch {
      // Private mode: the state holds for this page via the event below,
      // and is re-derived next visit — the safe failure.
    }
    try {
      window.dispatchEvent(new CustomEvent(VISITOR_CONSENT_CHANGED_EVENT))
    } catch {
      // A dispatch failure only delays consumers until the next read.
    }
  }
  return stored
}

/**
 * The GA gate's whole verdict: may the analytics category run for this
 * visitor, on this site, right now?
 *
 * - Consent machinery not required (no gated features, or host opted out of
 *   the tool) → yes.
 * - Required and the recorded state grants analytics (`accepted` or
 *   `implied`) → yes.
 * - Required and anything else — declined, opted out, GPC, or NOT YET
 *   RESOLVED → no. Undecided is not a maybe: the script stays out until a
 *   state that grants it exists. The gate never asks WHY consent is absent,
 *   which is what keeps it posture-independent.
 */
export function isAnalyticsAllowed(
  host: VisitorConsentHost | null | undefined,
  stored: StoredVisitorConsent | null,
): boolean {
  if (!hostConsentRequired(host)) return true
  return stored?.analytics === true
}

/**
 * Where the marketing runtime may keep its experiment visitor id.
 *
 * `local` — the id persists across visits. `session` — the id lives in
 * sessionStorage: variants stay stable within the visit and the identifier
 * dies with the tab. The downgrade applies while the consent machinery is
 * active for this site and analytics is not granted; the id itself never
 * leaves the browser either way (the experiment beacons are aggregate — no
 * visitor id on the wire).
 */
export function resolveVisitorIdPersistence(
  host: VisitorConsentHost | null | undefined,
  stored: StoredVisitorConsent | null,
): 'local' | 'session' {
  return isAnalyticsAllowed(host, stored) ? 'local' : 'session'
}
