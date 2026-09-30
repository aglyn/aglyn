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

import type {
  AnalyticsEventOptions,
  AnalyticsGrants,
  AnalyticsMountOptions,
  AnalyticsProvider,
  AnalyticsTagMount,
} from '@aglyn/aglyn/app-utils/analytics-provider'
import { analyticsEnvironmentForcesInternal } from '@aglyn/aglyn/app-utils/analytics-environment'
import {
  INTERNAL_TRAFFIC_FORCED_SNIPPET,
  INTERNAL_TRAFFIC_GTAG_SNIPPET,
} from '@aglyn/aglyn/app-utils/internal-traffic'
import { PLATFORM_GA_MEASUREMENT_ID } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import {
  analyticsConsentSignals,
  consentModeSignals,
  GA_MEASUREMENT_ID_PATTERN,
  resolveGaMeasurementId,
  resolveGtmContainerId,
  type VisitorConsentHost,
} from '@aglyn/aglyn/app-utils/visitor-consent'

/**
 * The Google tag adapter: Google Analytics 4 and Google Tag Manager on a
 * published site, and the resident Google tag of any document that has one
 * (AGL-3080).
 *
 * Core decides whether a visitor may be measured and names no vendor
 * (`analytics-provider.ts`); this is where Google's shape lives — the inline
 * boot and library each tag needs, Consent Mode, the window flag that
 * silences a resident tag, and how an event reaches `gtag`.
 *
 * Loaded as a chunk of its own, and only where it is used: by a published
 * page whose site configures a measurement id or a container, and by the
 * console, whose own analytics tag the consent controls answer to.
 */

/** The `gtag` a loaded Google tag defines on `window`. */
type Gtag = (...args: unknown[]) => void

/** The resident `gtag`, or null when no Google tag is on the page. */
function residentGtag(): Gtag | null {
  if (typeof window === 'undefined') return null
  const gtag = (window as unknown as { gtag?: unknown }).gtag
  return typeof gtag === 'function' ? (gtag as Gtag) : null
}

/**
 * The `window` flag `gtag.js` consults before every hit: with
 * `window['ga-disable-G-XXXX'] === true` the tag for that property sends
 * nothing and writes nothing. Google's own documented opt-out mechanism, and
 * the one that works on a tag which never received a consent-mode default
 * (AGL-1608) — a case that still exists after AGL-1622, because a tag arriving
 * through GTM or a host's own CMP is not one this adapter declared for.
 */
export const GA_DISABLE_FLAG_PREFIX = 'ga-disable-'

/**
 * The consent-mode `default` declaration that goes in front of the tag
 * (AGL-1622), for injection into the same inline block that creates
 * `dataLayer` and calls `gtag('config', …)`.
 *
 * ## What this is, and — load-bearing — what it is NOT
 *
 * It is NOT a licence to load the tag earlier. It is emitted INSIDE the block
 * that only renders when the AGL-1498 gate has already said yes, so it is
 * reached only on a pageview where analytics is granted. On every gated
 * pageview — an EU/UK/EEA visitor with no explicit accept, an unknown region, a
 * declined or opted-out visitor, a GPC browser — nothing here renders, no
 * request goes to `googletagmanager.com`, and this constant is never evaluated
 * into the page. "The script never LOADS, rather than load-then-suppress" is a
 * stated AGL-1498 property and it is intact everywhere the gate applies;
 * `consent-mode-default.spec.tsx` fails if that ever stops being true.
 *
 * the decision, 2026-08-14: load-then-restrict is approved for the UNITED
 * STATES, where the implied-consent posture already permits the load and the
 * restriction signals act on a tag that is legitimately resident. EU and UK
 * keep the prior-consent gate exactly as it is, because loading an analytics
 * tag before consent is the specific thing prior-consent law prohibits. So the
 * consent-mode mechanism is strictly ADDITIVE to the gate, never a replacement
 * for it.
 *
 * What declaring it actually buys, given the tag is granted by the time it is
 * read:
 *
 * - The advertising signals are denied FROM THE FIRST HIT. Without a default,
 *   a freshly loaded tag runs with `ad_storage` unrestricted and only becomes
 *   denied if the visitor happens to withdraw and change their mind again
 *   (AGL-1608's `update`). The load-time state now matches the tool's actual
 *   scope instead of being wider than it.
 * - A later `update` is a transition from a declared state rather than a tag's
 *   first-ever consent signal, which is the shape GA4's consent-mode reporting
 *   and any third-party CMP alongside ours both expect.
 *
 * The value is a literal, built from `analyticsConsentSignals` — no
 * interpolated input reaches it, which matters because it lands inside an
 * inline script (the AGL-138 concern).
 */
export const GA_CONSENT_DEFAULT_SNIPPET = `gtag('consent', 'default', ${JSON.stringify(
  analyticsConsentSignals(true),
)});`

/**
 * The same declaration for a visitor who granted ADVERTISING too (AGL-1649).
 *
 * A second CONSTANT rather than a parameterised builder, for the reason the
 * first one is a constant: it lands inside an inline script (the AGL-138
 * concern), and a constant cannot interpolate anything. Both values are
 * literals fixed at module load; the only thing the caller chooses is which
 * of the two to emit.
 *
 * Reached only where the page's `advertising` answer is yes — host opted in,
 * explicit accept, explicit yes to this category — which is evaluated
 * client-side after hydration, like every other part of this gate. The ISR
 * property is unaffected: the cached HTML contains neither snippet, because
 * the whole block is inside the client-side `analyticsAllowed` condition.
 *
 * Declaring the grant as the DEFAULT rather than sending a later `update` is
 * what keeps the tag's first hit correct. An update would arrive after
 * `config`, so the session's first pageview — usually the entire session for
 * a marketing visit — would carry the denied state the visitor did not
 * choose.
 */
export const GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET = `gtag('consent', 'default', ${JSON.stringify(
  consentModeSignals({ analytics: true, advertising: true }),
)});`

/**
 * Consent-mode URL passthrough for the platform's own tag (AGL-2548).
 *
 * The advertising signals in {@link GA_CONSENT_DEFAULT_SNIPPET} are denied, so
 * on `aglyn.com` gtag writes no `_gcl_aw` cookie and the `gclid` an ad click
 * arrives with lives only in that first URL. The conversions it should be
 * credited for fire one hop later, on the console, where the posture grants
 * advertising storage outside the prior-consent regions — and without this
 * declaration the click id never makes that hop. The console reports a
 * conversion with no click behind it, and Google Ads counts nothing.
 *
 * `url_passthrough` is Google's mechanism for exactly this state: while
 * `ad_storage` is denied, gtag appends the click identifiers to links into the
 * cross-domain-linked hosts as URL parameters instead of setting a cookie. The
 * receiving tag reads them under its own consent state. Nothing is stored on
 * the denying surface, so the marketing site's opt-in advertising posture is
 * unchanged; the click id simply survives the link it was always meant to
 * survive.
 *
 * `ads_data_redaction` is the companion Google documents alongside it: with
 * `ad_storage` denied, the ad click identifiers are stripped from the hits this
 * tag sends and its network requests go to a cookieless endpoint. Declared
 * together so a denied visitor is measured with less, not merely differently.
 *
 * Both are `set` calls, so they must precede `gtag('config', …)` in the same
 * inline block — a `set` applies to hits processed after it, and the session's
 * first pageview is the one carrying the click.
 *
 * PLATFORM ID ONLY. A customer's tag is configured with their id and their
 * consent posture; how their ad click ids travel is theirs to decide, and a
 * passthrough declared on their behalf would rewrite links on their site.
 */
export const GA_CLICK_ID_PASSTHROUGH_SNIPPET =
  "gtag('set', 'url_passthrough', true);" +
  "gtag('set', 'ads_data_redaction', true);"

/** The marker `advertising-tags.ts` names in `sharesLibrary` for gtag.js. */
export const GTAG_LIBRARY = 'googletagmanager.com/gtag/js'

/** `dataLayer` and the canonical `gtag` shim, the start of every boot. */
const GTAG_SHIM =
  'window.dataLayer=window.dataLayer||[];' +
  'function gtag(){dataLayer.push(arguments);}'

/**
 * The consent-mode default a boot opens with — none when the host runs its
 * own consent solution (`consentRequired` false): their solution owns the
 * default, and a second one racing it would overwrite their visitor's answer
 * with ours.
 */
function consentDefault(options: AnalyticsMountOptions): string {
  if (!options.consentRequired) return ''
  return options.advertising
    ? GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET
    : GA_CONSENT_DEFAULT_SNIPPET
}

/**
 * The Google Analytics pair (AGL-138/661): the site's configured measurement
 * id, booted and loaded.
 *
 * Order is load-bearing twice over. The inline block precedes the library, and
 * inside it the consent `default` precedes `config`, so no hit is ever sent
 * before the tag has been told what it may store. Google's canonical snippet
 * shape.
 *
 * ## The platform's own property
 *
 * `aglyn.com` is a site on this platform pointed at the platform's measurement
 * id, and three things are said to THAT property only, because a customer's
 * site configures its own id and their property gets no opinion of ours:
 *
 * - THE INTERNAL-TRAFFIC STAMP (AGL-2064), between the shim and `gtag('js')`.
 *   It is a CONSTANT string, evaluated in the browser: these pages are
 *   ISR-cached, so a server-side branch on "is this us" would bake one
 *   browser's answer into the cache for everyone. It runs BEFORE `config`,
 *   because the hits that leak are the ones no call site writes —
 *   `session_start`, `first_visit`, `user_engagement`, the automatic
 *   `page_view` — and a `set` applies only to hits processed after it. Wrongly
 *   flagging a real visitor erases them from every report and a GA4 data
 *   filter is not retroactive, so the id equality is the guard that keeps the
 *   expensive direction unreachable. When the analytics escape hatch
 *   deliberately re-enables a non-production build, the stamp is
 *   UNCONDITIONAL (AGL-2067): a build that emits because someone asked it to is
 *   ours by definition.
 * - THE CLICK-ID PASSTHROUGH (AGL-2548), also a `set` before `config`.
 * - `content_group: 'marketing'` on `config` (AGL-1857): the one-click
 *   marketing/docs/console split in GA4 standard reports. The platform's id is
 *   the discriminator because same-property IS the definition of "this is our
 *   surface".
 */
function googleAnalyticsMount(
  measurementId: string,
  options: AnalyticsMountOptions,
): AnalyticsTagMount {
  const own = measurementId === PLATFORM_GA_MEASUREMENT_ID
  return {
    id: 'ga',
    boot:
      GTAG_SHIM +
      consentDefault(options) +
      (own
        ? analyticsEnvironmentForcesInternal()
          ? INTERNAL_TRAFFIC_FORCED_SNIPPET
          : INTERNAL_TRAFFIC_GTAG_SNIPPET
        : '') +
      (own ? GA_CLICK_ID_PASSTHROUGH_SNIPPET : '') +
      "gtag('js', new Date());" +
      (own
        ? `gtag('config', '${measurementId}', {'content_group':'marketing'});`
        : `gtag('config', '${measurementId}');`),
    src: `https://www.googletagmanager.com/gtag/js?id=${measurementId}`,
    library: GTAG_LIBRARY,
  }
}

/**
 * The Google Tag Manager pair (AGL-2486), under the same gate as GA and never
 * a looser one.
 *
 * A container is not a tag — it is a LOADER, and what it loads is decided in
 * Google's UI by whoever owns it, not here. That is exactly why it cannot have
 * a weaker gate than GA: analytics may run on implied consent outside the
 * EU/EEA/UK while ADVERTISING is opt-in everywhere, and a container is the
 * likeliest thing on a page to carry an advertising tag.
 *
 * CONSENT MODE V2 comes first, in the same script, before `gtm.js` is
 * requested: defaults set after the container has loaded are defaults its
 * tags have already run past. The advertising signals stay denied unless the
 * visitor granted advertising, which is what makes a container holding ad
 * tags safe to load at all.
 *
 * NO `<noscript>` IFRAME, deliberately, and it is the one piece of Google's
 * standard snippet omitted. That iframe fires the container with no
 * JavaScript — so no consent defaults, no gate, nothing to suppress it — and
 * these pages are ISR-cached, so it would sit in shared HTML identical for
 * every visitor and every region. A visitor with JavaScript off gets no
 * container, which is the correct answer.
 */
function tagManagerMount(
  containerId: string,
  options: AnalyticsMountOptions,
): AnalyticsTagMount {
  return {
    id: 'gtm',
    boot:
      GTAG_SHIM +
      consentDefault(options) +
      "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});",
    src: `https://www.googletagmanager.com/gtm.js?id=${containerId}`,
  }
}

/**
 * The measurement ids whose tag is actually RESIDENT in this page.
 *
 * Discovered from the page rather than taken from the host document on
 * purpose: what has to be silenced is whatever gtag.js is currently loaded and
 * configured for, which is not always what the host record configures — a tag
 * can arrive through GTM, the console's is injected by its analytics SDK, and
 * a stale `<script>` from earlier in the pageview is exactly the thing this
 * function exists to find.
 *
 * Ids are format-checked before they are used, because each one becomes a
 * `window` property name.
 */
export function residentGaMeasurementIds(): string[] {
  if (typeof document === 'undefined') return []
  const ids = new Set<string>()
  try {
    const loaded = document.querySelectorAll(`script[src*="${GTAG_LIBRARY}"]`)
    for (const element of Array.from(loaded)) {
      const src = String((element as HTMLScriptElement).src ?? '')
      const match = /[?&]id=([^&]*)/.exec(src)
      const id = match ? decodeURIComponent(match[1]) : ''
      if (GA_MEASUREMENT_ID_PATTERN.test(id)) ids.add(id)
    }
  } catch {
    // A hostile or absent DOM: the dataLayer pass below still applies.
  }
  try {
    const layer = (window as unknown as Record<string, unknown>)?.dataLayer
    for (const entry of Array.from((layer ?? []) as ArrayLike<unknown>)) {
      // `arguments` objects, not arrays — gtag pushes its own call sites.
      const args = Array.from((entry ?? []) as ArrayLike<unknown>)
      if (args[0] !== 'config') continue
      const id = String(args[1] ?? '')
      if (GA_MEASUREMENT_ID_PATTERN.test(id)) ids.add(id)
    }
  } catch {
    // No dataLayer, or one that is not iterable: the script pass stands.
  }
  return [...ids]
}

/**
 * Make every resident Google tag agree with the visitor's answer, and return
 * the measurement ids it acted on.
 *
 * ## Why deleting the cookies is not enough (AGL-1608)
 *
 * The AGL-1498 gate stops the script from LOADING, which is the right
 * enforcement for a fresh pageview and the wrong tool for a visitor who
 * withdraws mid-pageview: `gtag.js` has already executed, and React unmounting
 * the `<script>` element does not unload it. `window.gtag` stays live, GA4
 * enhanced measurement fires on its own (scroll depth, outbound click, file
 * download), and the tag re-writes `_ga_<id>` AFTER the platform's cookie
 * sweep has deleted it. Reproduced on aglyn.com: an opt-out, a hand-run sweep
 * to zero cookies, then one scroll to the footer brought `_ga_YW5PG16YTM`
 * back.
 *
 * Two signals, because they fail differently and neither is guaranteed:
 * the `ga-disable-<id>` window flag silences a tag that never received a
 * consent-mode default, and the `consent`/`update` call reaches a tag that
 * arrived through GTM with its own id this function never saw.
 *
 * ## What this deliberately does NOT do
 *
 * It never touches the gate. Both signals act only on a tag that is already
 * resident — which, by construction, only exists after a grant. The
 * consent-mode DEFAULT ({@link GA_CONSENT_DEFAULT_SNIPPET}) is declared inside
 * the gated block and therefore only on a pageview the gate already allowed.
 *
 * Symmetric on purpose: a visitor who opts out and changes their mind in the
 * same pageview would otherwise stay silently unmeasured until they navigated,
 * because the re-rendered `<Script>` cannot re-execute an already-loaded tag.
 * The re-grant restores exactly what `grants` says, and core clamps
 * advertising to analytics before it arrives, so a withdrawal can never
 * restore advertising alone.
 */
export function applyGoogleTagConsent(grants: AnalyticsGrants): string[] {
  if (typeof window === 'undefined') return []
  const granted = grants.analytics === true
  const ids = residentGaMeasurementIds()
  const scope = window as unknown as Record<string, unknown>
  for (const id of ids) {
    scope[`${GA_DISABLE_FLAG_PREFIX}${id}`] = !granted
  }
  try {
    const send = residentGtag()
    if (send) {
      // The same payload builder the load-time `default` is made from
      // (AGL-1622), so the two declarations cannot drift.
      send(
        'consent',
        'update',
        consentModeSignals({
          analytics: granted,
          advertising: grants.advertising === true,
        }),
      )
    }
  } catch {
    // A tag that throws on its own consent call is one we cannot silence;
    // the flag above and the cookie sweep still stand.
  }
  return ids
}

/**
 * Hand one event to the resident tag.
 *
 * ## `measurementOnly`: the measurement properties, not the ads account (AGL-2710)
 *
 * A gtag event with no `send_to` goes to every destination the loader has
 * configured, and on a surface that also runs Google Ads that includes the
 * ads account. Core Web Vitals have nothing to do with advertising: measured
 * on `aglyn.com`, one such event attempted seven requests to
 * `googleads.g.doubleclick.net` and `google.com/{pagead,rmkt,ccm}` — per
 * metric, per pageview, four metrics deep — and Google Ads has no report that
 * reads any of them. Naming the GA4 ids drops all seven and leaves the GA hit
 * exactly as it was.
 *
 * The ids are read at DELIVERY time, from the page: the tag routinely arrives
 * after the first metric, and what has to be addressed is whatever gtag is
 * configured for now — which on a customer site is their own property and not
 * ours.
 *
 * No ids found means no `send_to` and the event goes wherever it went before.
 * That is the fail-open side on purpose: a tag that arrived through GTM with
 * an id this reader never saw would otherwise be handed an empty destination
 * list, and losing the measurement is a worse outcome than an ads account
 * receiving a metric it ignores.
 */
function sendGoogleTagEvent(
  name: string,
  params: Record<string, unknown>,
  options?: AnalyticsEventOptions,
): void {
  const gtag = residentGtag()
  if (!gtag) return
  try {
    if (!options?.measurementOnly) {
      gtag('event', name, params)
      return
    }
    const destinations = residentGaMeasurementIds()
    gtag(
      'event',
      name,
      destinations.length ? { ...params, send_to: destinations } : params,
    )
  } catch {
    // Analytics never breaks the page.
  }
}

/** The adapter core registers from each app's generated manifest. */
export const analyticsProvider: AnalyticsProvider = {
  mounts(host: VisitorConsentHost | null | undefined, options) {
    const mounts: AnalyticsTagMount[] = []
    const measurementId = resolveGaMeasurementId(host)
    if (measurementId) mounts.push(googleAnalyticsMount(measurementId, options))
    const containerId = resolveGtmContainerId(host)
    if (containerId) mounts.push(tagManagerMount(containerId, options))
    return mounts
  },
  applyConsent: applyGoogleTagConsent,
  resident: () => residentGtag() !== null,
  sendEvent: sendGoogleTagEvent,
}
