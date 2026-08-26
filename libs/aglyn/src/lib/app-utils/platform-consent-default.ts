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
 * The Consent Mode v2 `default` declaration for AGLYN'S OWN surfaces — the
 * console (`app.aglyn.com`) and the docs site (`docs.aglyn.com`) (AGL-1597).
 *
 * the decision, 2026-08-20: analytics is ENABLED BY DEFAULT with implied
 * consent **where that is lawful**, and denied by default where prior consent
 * is required. This module is the "where applicable" half, expressed in the
 * one mechanism that can carry it on a surface with no consent gate: a
 * region-scoped `gtag('consent', 'default', …)`.
 *
 * ## Which surfaces this is for, and — load-bearing — which it is NOT
 *
 * Aglyn runs GA4 `G-YW5PG16YTM` on three of its own domains, and they did not
 * arrive at the same posture:
 *
 * - **`aglyn.com`** — served by the TENANT runtime, so it already runs the
 *   full AGL-1498 gate: a Firestore `consent.mode`, `/api/consent/region`, a
 *   per-visitor record in localStorage, and a tag that never LOADS for a
 *   visitor who has not granted. It is already default-on outside the
 *   prior-consent regions. **This module does not touch it and must not.**
 *
 *   ⚠️ Its AD signals DIVERGE from this module's, and that is expected rather
 *   than a defect — the two domains answer to different rules and always have.
 *   The history is worth carrying because the divergence has flipped twice:
 *   AGL-2402 (2026-08-21) let the implied default carry advertising, the
 *   marketing host had opted into asking, and a US visitor was measured on
 *   2026-08-23 with the record
 *   `{"status":"implied","analytics":true,"advertising":true,"country":"US"}`
 *   and a collect hit carrying `gcs=G111` — ad storage GRANTED. That was
 *   narrowed back on 2026-08-24 and widened again on 2026-08-25 once the
 *   Cookie Policy master was rewritten to match the Privacy Policy's opt-out
 *   description, so the 2026-08-23 measurement is once more the shape the
 *   current rule produces.
 *
 *   This module keeps declaring all three ad signals DENIED, and must. It
 *   speaks for `app.aglyn.com` and `docs.aglyn.com`, where no per-visitor
 *   record exists, nobody can be asked and no opt-out surface is reachable —
 *   the conditions the opt-out posture rests on are simply absent. An implied
 *   grant needs a visitor who COULD have said no.
 *
 *   ⛔ Re-measure `aglyn.com` before relying on any comparison here; the
 *   numbers above are a record of what was seen, not a claim about today.
 * - **`app.aglyn.com` and `docs.aglyn.com`** — GA loads unconditionally on
 *   both (no gate can run here), and BEFORE this module they carried no
 *   consent declaration of any kind. That was not "default on where lawful";
 *   it was default on EVERYWHERE, prior-consent regions included, which is the
 *   gap AGL-1597 was filed for. These two are what this module is wired into.
 *
 *   On the docs side, being wired in was not enough on its own: the
 *   declaration was emitted but landed AFTER the gtag preset's `config`, which
 *   makes it a no-op. See the `ssrTemplate` note in
 *   `apps/docs/docusaurus.config.ts` — position matters as much as presence.
 * - **Customer/tenant sites** — NOT in scope by a wide margin. Aglyn ships
 *   the consent gate to customers as a product (AGL-1498) and the host
 *   chooses the posture. Changing their default would configure a customer's
 *   compliance posture for them, for visitors who may well be European. The
 *   separation here is structural rather than a matter of care: this module
 *   is imported only by the console's Firebase Analytics boot and copied into
 *   the docs site's `ssrTemplate` bootstrap. Nothing in the tenant runtime
 *   reads it, and
 *   `visitor-consent.ts` — the tenant's decision module — is unchanged.
 *
 * ## Why a region-scoped `default` here, and not the tenant's gate
 *
 * The tenant gate is strictly stronger: the tag never loads at all for a
 * gated visitor. It is also unavailable here. It needs a host document, a
 * per-host storage key and a region endpoint, none of which exist on a static
 * Docusaurus build or on the console's Firebase-owned tag — and porting it
 * would be a third implementation of consent, the outcome AGL-1579 explicitly
 * ruled out. So this is the weaker mechanism applied where the stronger one
 * cannot reach, and it is strictly better than what it replaces (nothing).
 *
 * It is NOT equivalent, and the difference should be stated rather than
 * glossed: under a denied `analytics_storage` the tag still LOADS and still
 * sends cookieless pings. That is a real residual question for the EEA/UK,
 * and it is flagged on AGL-1597 rather than papered over here.
 *
 * ## The ad signals
 *
 * Denied in BOTH branches, everywhere. Zach decided analytics and only
 * analytics for these two surfaces: Google Signals is off, there is no Google
 * Ads link and enhanced conversions is off.
 *
 * This deliberately no longer matches `aglyn.com`, which has since taken an
 * advertising grant (see the note above). The asymmetry is the point rather
 * than an oversight — `aglyn.com` can ASK, through the AGL-1498 gate, so a
 * grant there has a recorded basis behind it. The console and the docs cannot
 * ask at all, so an ad grant here would rest on nothing.
 *
 * Before this module they declared nothing, which left a freshly loaded tag
 * with ad storage UNRESTRICTED — so denying them was a tightening, not a
 * preference.
 */

import { PRIOR_CONSENT_COUNTRY_CODES } from './visitor-consent'

/** A single consent-mode signal value. */
export type PlatformConsentSignal = 'granted' | 'denied'

/**
 * Switzerland, and why it is here but NOT in the tenant's set.
 *
 * the 2026-08-20 brief names the EEA, the UK **and Switzerland** as prior
 * opt-in, and instructs that those regions not be defaulted on. The tenant's
 * {@link PRIOR_CONSENT_COUNTRY_CODES} does not include `CH` — defensibly, the
 * revised FADP has no ePrivacy-style prior-consent rule and regulates on a
 * transparency/opt-out basis — so the two sets genuinely disagree.
 *
 * That disagreement is resolved in the only direction that is safe to resolve
 * unilaterally: Aglyn's OWN surfaces take the stricter reading Zach asked
 * for, and the tenant set is left exactly as it is. Widening
 * `PRIOR_CONSENT_COUNTRY_CODES` would flip Swiss visitors on every CUSTOMER
 * site from tracked to banner-gated — a change to customers' compliance
 * posture, made on their behalf, which is the specific thing this work is
 * scoped out of.
 */
export const PLATFORM_EXTRA_PRIOR_CONSENT_CODES: readonly string[] = ['CH']

/**
 * The regions whose analytics default is DENIED on Aglyn's own surfaces.
 *
 * DERIVED from the tenant's canonical prior-consent set rather than retyped
 * beside it. Two hand-maintained country lists is how one of them ends up a
 * year behind the other, and the failure is silent in both directions: a
 * missing code tracks a European visitor by default, a stale extra one just
 * loses data. Deriving means an EU membership change is edited once.
 *
 * Sorted so the emitted snippet is byte-stable across builds — the docs
 * site's copy of it is checked character-for-character.
 */
export const PLATFORM_PRIOR_CONSENT_REGIONS: readonly string[] = [
  ...new Set([
    ...PRIOR_CONSENT_COUNTRY_CODES,
    ...PLATFORM_EXTRA_PRIOR_CONSENT_CODES,
  ]),
].sort()

/** The four signals a consent-mode declaration carries. */
export interface PlatformConsentSignals {
  analytics_storage: PlatformConsentSignal
  ad_storage: 'denied'
  ad_user_data: 'denied'
  ad_personalization: 'denied'
}

/**
 * One `gtag('consent', 'default', …)` payload. `region` absent means the
 * declaration applies wherever no region-scoped one matches.
 */
export interface PlatformConsentDefaultCommand extends PlatformConsentSignals {
  region?: readonly string[]
}

/**
 * The declaration, in emission order.
 *
 * The global default comes first and grants analytics — the implied-consent
 * posture, lawful in the US and most of the world. The region-scoped
 * declaration follows and denies it for the prior-consent regions. Both are
 * `default` (never `update`): a default is read before the tag's first hit,
 * whereas an update arrives after `config` and would leave the session's
 * first pageview — often the whole session — in the wrong state.
 */
export const PLATFORM_CONSENT_DEFAULT_COMMANDS: readonly PlatformConsentDefaultCommand[] =
  [
    {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    },
    {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      region: PLATFORM_PRIOR_CONSENT_REGIONS,
    },
  ]

/**
 * What the declaration above actually MEANS for a visitor in `country`.
 *
 * This exists so the defaults can be tested against the thing that ships
 * rather than against a second copy of the same opinion. It reads
 * {@link PLATFORM_CONSENT_DEFAULT_COMMANDS} and applies Google's documented
 * resolution rule — the most specific matching `region` wins, and a
 * declaration with no `region` is the fallback — so a test that asserts
 * "DE is denied" fails the moment `DE` stops being in the emitted payload.
 *
 * `null`/unknown resolves to the GLOBAL default, which is `granted`. That is
 * the declaration modelled honestly, not a wish: region matching is done by
 * Google from the request IP, not by us, so "we do not know the country" is
 * not a state this mechanism can act on. It is also the one place this module
 * is weaker than the tenant gate, which resolves unknown-region to opt-in —
 * another reason the tenant gate is the better mechanism where it can run.
 */
export function resolvePlatformConsentDefault(
  country: string | null | undefined,
): PlatformConsentSignals {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : ''
  let fallback: PlatformConsentDefaultCommand | null = null
  let matched: PlatformConsentDefaultCommand | null = null
  for (const command of PLATFORM_CONSENT_DEFAULT_COMMANDS) {
    if (command.region === undefined) {
      fallback = command
      continue
    }
    // `strictNullChecks` is off repo-wide, so `!code` would also swallow a
    // genuine miss; compare explicitly.
    if (code !== '' && command.region.indexOf(code) >= 0) matched = command
  }
  const winner = matched === null ? fallback : matched
  return {
    analytics_storage: winner.analytics_storage,
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  }
}

/**
 * The declaration as an inline-script snippet.
 *
 * Built by serializing {@link PLATFORM_CONSENT_DEFAULT_COMMANDS} — no caller
 * input reaches it and every value is a literal fixed at module load, which
 * matters because it lands inside an inline `<script>` (the AGL-138 concern).
 *
 * Assumes the canonical `function gtag(){dataLayer.push(arguments);}` shim is
 * already defined ABOVE it. gtag.js processes `arguments` objects, not plain
 * arrays, so a `dataLayer.push([...])` here would be the classic silent
 * no-op: no error, no consent declaration, and nothing in any GA report to
 * show for it.
 *
 * `apps/docs` cannot import from `libs/` (AGL-1595), so the docs site carries
 * a VERBATIM COPY of this string and
 * `apps/console/specs/docs-platform-consent-snippet.spec.ts` fails if the two
 * ever drift — the same treatment `INTERNAL_TRAFFIC_GTAG_SNIPPET` gets, and
 * for the same reason: a stale copy still runs without error and still reads
 * like a working declaration.
 */
export const PLATFORM_CONSENT_DEFAULT_SNIPPET =
  PLATFORM_CONSENT_DEFAULT_COMMANDS.map(
    (command) => `gtag('consent','default',${JSON.stringify(command)});`,
  ).join('')

/** The `dataLayer`-bearing window this module writes to. */
export interface ConsentDataLayerWindow {
  dataLayer?: unknown[]
}

/**
 * Declare the defaults on a window, for surfaces that boot their tag from JS
 * rather than from an inline script — i.e. the console, whose gtag is
 * injected by the Firebase Analytics SDK.
 *
 * MUST be called before the SDK initializes, because a `default` read after
 * the tag's `config` is not a default at all. The queue is what makes that
 * orderable: pushing here lands the declaration in `dataLayer` ahead of
 * everything gtag.js later processes, even though gtag.js is not loaded yet.
 *
 * Pushes a real `arguments` object, never an array literal — see the snippet
 * note above for what the array form silently does.
 *
 * Idempotent per window: a second call is a no-op, so a remount or a
 * re-entrant services boot cannot stack duplicate declarations.
 */
export function pushPlatformConsentDefault(
  win: ConsentDataLayerWindow | null | undefined,
): boolean {
  if (!win) return false
  const marked = win as { __aglynConsentDefaultPushed?: boolean }
  if (marked.__aglynConsentDefaultPushed === true) return false
  const layer = win.dataLayer === undefined ? [] : win.dataLayer
  win.dataLayer = layer
  // Declared without parameters ON PURPOSE: the body forwards the live
  // `arguments` object, and a rest parameter would hand gtag.js a plain
  // array instead.
  function gtag(): void {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments)
  }
  const queue = gtag as (...args: unknown[]) => void
  for (const command of PLATFORM_CONSENT_DEFAULT_COMMANDS) {
    queue('consent', 'default', command)
  }
  marked.__aglynConsentDefaultPushed = true
  return true
}
