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
 * Sanctions / OFAC geo-block for the CONSOLE (AGL-1492).
 *
 * ToS §3.6 says a person located in, ordinarily resident in, or organized
 * under the laws of a comprehensively embargoed country or region "may not
 * access or use the Services", and §3.5 reserves the right to refuse them.
 * This module is the technical half of that commitment.
 *
 * **Scope is the console, deliberately.** §3.6 binds "you" — which §2 defines
 * as the party that registers for the Services — and §2 defines an "End User"
 * (a visitor to a customer's Host) as a *distinct* party who never enters into
 * these Terms. A reader in Tehran opening a customer's blog on `*.aglyn.app`
 * is not Aglyn onboarding a sanctioned customer; the service recipient there is
 * the paying customer, who is screened here and again by Stripe. So the tenant
 * runtime is NOT wired to this, and that is a decision rather than an
 * oversight — see the note in `apps/tenant/middleware.ts`.
 *
 * Payer screening is Stripe's and stays Stripe's. This module never looks at a
 * card, a name or a sanctions list; it answers one question — where did this
 * request come from — and is the coarse first layer in front of it.
 */

/**
 * Countries under comprehensive U.S. embargo, exactly as ToS §3.6 names them.
 *
 * ISO 3166-1 alpha-2, matching what `x-vercel-ip-country` carries. Deliberately
 * not a broader list: Russia and Belarus are under *sectoral* sanctions, not a
 * comprehensive embargo, and §3.6 does not name them. Blocking a country the
 * Terms do not name is a product decision, not a compliance one.
 */
export const EMBARGOED_COUNTRIES: ReadonlySet<string> = new Set([
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
])

/**
 * The sub-country half, which a country check alone cannot reach.
 *
 * Crimea, Donetsk and Luhansk are regions *of Ukraine* — an embargoed region
 * inside a country that is not embargoed — so `x-vercel-ip-country` reads `UA`
 * for a Kyiv user and a Donetsk user alike. These are ISO 3166-2:UA subdivision
 * codes, which is what `x-vercel-ip-country-region` carries (measured: it
 * carries `TX` for Dallas, i.e. the bare code without the country prefix).
 *
 * `40` (Sevastopol) is included because OFAC treats the "Crimea region of
 * Ukraine" as covering the city of Sevastopol, which ISO codes separately from
 * the Autonomous Republic of Crimea.
 */
export const EMBARGOED_UA_REGIONS: ReadonlySet<string> = new Set([
  '43', // Autonomous Republic of Crimea
  '40', // Sevastopol
  '14', // Donetsk oblast
  '09', // Luhansk oblast
])

/** Vercel's edge geo headers, the only geo signal this deployment has. */
export const GEO_COUNTRY_HEADER = 'x-vercel-ip-country'
export const GEO_REGION_HEADER = 'x-vercel-ip-country-region'

/** Prefix every log line here shares, so the absence is greppable. */
export const SANCTIONS_LOG_PREFIX = '[sanctions-geo]'

export interface RequestGeo {
  /** ISO 3166-1 alpha-2, uppercased. `null` when the edge sent no signal. */
  country: string | null
  /** Bare ISO 3166-2 subdivision code, uppercased. `null` when absent. */
  region: string | null
}

export type SanctionsOutcome =
  /** An embargoed country code. */
  | 'blocked-country'
  /** An embargoed subdivision of a country that is not itself embargoed. */
  | 'blocked-region'
  /** A geo signal that resolves outside the embargoed set. */
  | 'allowed'
  /** No country header at all — see {@link sanctionsVerdict} on failing open. */
  | 'no-signal'
  /**
   * Ukraine with no subdivision code. The country is not embargoed and the
   * three embargoed oblasts cannot be ruled in or out; allowed, but called out
   * separately from a plain `allowed` because it is the one partial-signal
   * case this control actually has.
   */
  | 'region-unresolved'

export interface SanctionsVerdict extends RequestGeo {
  blocked: boolean
  outcome: SanctionsOutcome
}

/** A minimal `Headers`, so route handlers and middleware share one reader. */
export interface HeaderReader {
  get(name: string): string | null
}

/**
 * Normalize a subdivision code to the bare, zero-padded ISO 3166-2 form.
 *
 * Providers disagree on `UA-43` vs `43`, and on `9` vs `09` for Luhansk. All
 * three spellings have to land on the same set member or the sub-country half
 * of this control silently answers "allowed" for a region it was written to
 * catch.
 */
function normalizeRegion(raw: string): string {
  const upper = raw.trim().toUpperCase()
  const bare = upper.includes('-') ? upper.slice(upper.indexOf('-') + 1) : upper
  return /^\d$/.test(bare) ? `0${bare}` : bare
}

/** Reads the edge geo signal off a request's headers. */
export function readRequestGeo(headers: HeaderReader): RequestGeo {
  const country = (headers.get(GEO_COUNTRY_HEADER) ?? '').trim().toUpperCase()
  const region = (headers.get(GEO_REGION_HEADER) ?? '').trim()
  return {
    country: country || null,
    region: region ? normalizeRegion(region) : null,
  }
}

/**
 * The verdict for an already-read geo signal. Pure — no headers, no logging,
 * no clock — so the policy can be tested exhaustively and the wiring tested
 * separately.
 *
 * **Absent signal fails OPEN, and that is the load-bearing choice here.**
 *
 * It fails open because absence is a *normal* operating state, not an
 * exception: the header is set by Vercel's edge network and nothing else sets
 * it, so local dev, preview builds under `next start`, and every self-hosted
 * install (Docker + BYO-Firebase) run permanently without it. This is measured,
 * not assumed — of five sign-in device records in production, one reads
 * `Unknown location`, meaning a real, legitimate sign-in already reached the
 * console with no geo headers at all. Fail-closed would have refused it.
 *
 * The trade is deliberate and it is not "voiding the control": the residual
 * risk of an unknown-origin request is covered by the contractual
 * representation in §3.6, by Stripe's independent screening of every payer at
 * the moment money moves, and by the fact that a signal we do not have cannot
 * be made trustworthy by refusing service to everyone who lacks it. Choosing
 * the other way would trade a compliance residual for a total outage of the
 * paid product, on a header we do not control.
 *
 * What makes fail-open honest rather than silent is
 * {@link enforceSanctionsGeo} logging every absence under
 * {@link SANCTIONS_LOG_PREFIX}. A control that fails open without saying so is
 * indistinguishable from one that was never wired.
 */
export function sanctionsVerdict(geo: RequestGeo): SanctionsVerdict {
  if (!geo.country) return { ...geo, blocked: false, outcome: 'no-signal' }
  if (EMBARGOED_COUNTRIES.has(geo.country)) {
    return { ...geo, blocked: true, outcome: 'blocked-country' }
  }
  if (geo.country === 'UA') {
    if (!geo.region) {
      return { ...geo, blocked: false, outcome: 'region-unresolved' }
    }
    if (EMBARGOED_UA_REGIONS.has(geo.region)) {
      return { ...geo, blocked: true, outcome: 'blocked-region' }
    }
  }
  return { ...geo, blocked: false, outcome: 'allowed' }
}

/**
 * The 451 body. Plain HTML, no scripts and no assets — it has to render on a
 * response the rest of the console's pipeline never touched.
 */
const BLOCKED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unavailable in your region</title></head>
<body style="font:16px/1.6 system-ui,sans-serif;margin:0;padding:12vh 6vw;color:#1a1a1a;background:#fff">
<h1 style="font-size:1.5rem;margin:0 0 1rem">Unavailable in your region</h1>
<p style="max-width:44rem;margin:0 0 1rem">Aglyn cannot be provided in countries and
regions subject to comprehensive U.S. economic sanctions. This is a legal restriction,
not a fault with your account.</p>
<p style="max-width:44rem;margin:0">See section 3.6 (Sanctions &amp; Export Control) of
our Terms of Service. If you believe this is a mistake, contact
<a href="mailto:support@aglyn.com">support@aglyn.com</a>.</p>
</body></html>`

const BLOCKED_JSON = {
  error: 'region-unavailable',
  reason: 'sanctions',
  detail:
    'Aglyn is unavailable in countries and regions subject to comprehensive ' +
    'U.S. economic sanctions (Terms of Service §3.6).',
}

/**
 * The refusal: **451 Unavailable For Legal Reasons**, which is precisely what
 * this is and is worth saying on the wire rather than hiding behind a 403.
 *
 * `no-store` matters more than it looks. A cached 451 is a region block pinned
 * onto whoever the cache serves next, and the console sits behind a CDN that
 * caches by URL, not by requester — the same shape as the ISR staleness that
 * has bitten this repo before. This response must never be reused.
 */
export function sanctionsBlockResponse(kind: 'page' | 'json'): Response {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Vary: GEO_COUNTRY_HEADER,
    'X-Robots-Tag': 'noindex',
  }
  if (kind === 'json') {
    return Response.json(BLOCKED_JSON, { status: 451, headers })
  }
  return new Response(BLOCKED_HTML, {
    status: 451,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * How often an absent geo signal is re-logged per runtime instance. Absence is
 * the state that most needs to be visible and is also the one that would flood
 * a log fastest (every local-dev request hits it), so it is throttled with a
 * count rather than sampled away.
 */
export const NO_SIGNAL_LOG_INTERVAL_MS = 60_000

/**
 * `hasLoggedNoSignal` is a separate flag rather than a `noSignalSince === 0`
 * sentinel, and the difference is not cosmetic: with a timestamp sentinel the
 * FIRST absence on a fresh instance compares `now - 0 >= INTERVAL` and, on any
 * clock this code actually sees, is judged "already logged recently". The one
 * absence most worth seeing — the first one after a deploy — was the one that
 * went unlogged. Caught by `sanctions-geo.spec.ts`, not by reading.
 */
let hasLoggedNoSignal = false
let noSignalLoggedAt = 0
let noSignalCount = 0

/** Test seam — the counters above are module state on a long-lived instance. */
export function resetSanctionsTelemetry(): void {
  hasLoggedNoSignal = false
  noSignalLoggedAt = 0
  noSignalCount = 0
}

/**
 * The wiring seam: read, judge, log, and hand back a refusal or `null`.
 *
 * Callers do `const refused = enforceSanctionsGeo(req.headers, 'page'); if
 * (refused) return refused` — one line, so nothing about the policy has to be
 * restated at a call site and no call site can get a *different* answer than
 * another. A control that each caller re-derives is a control that drifts.
 */
export function enforceSanctionsGeo(
  headers: HeaderReader,
  kind: 'page' | 'json',
  options: { now?: number; log?: (message: string) => void } = {},
): Response | null {
  const verdict = sanctionsVerdict(readRequestGeo(headers))
  const log = options.log ?? console.warn
  const now = options.now ?? Date.now()

  if (verdict.blocked) {
    log(
      `${SANCTIONS_LOG_PREFIX} refused ${verdict.outcome} ` +
        `country=${verdict.country} region=${verdict.region ?? '-'}`,
    )
    return sanctionsBlockResponse(kind)
  }

  if (verdict.outcome === 'no-signal') {
    noSignalCount += 1
    if (!hasLoggedNoSignal || now - noSignalLoggedAt >= NO_SIGNAL_LOG_INTERVAL_MS) {
      log(
        `${SANCTIONS_LOG_PREFIX} FAILING OPEN: no ${GEO_COUNTRY_HEADER} on ` +
          `${noSignalCount} request(s) since instance start — the sanctions ` +
          'block cannot be evaluated for these',
      )
      hasLoggedNoSignal = true
      noSignalLoggedAt = now
    }
  } else if (verdict.outcome === 'region-unresolved') {
    // Ukraine without a subdivision: the one case where the country resolves
    // but the embargoed-region question cannot be answered.
    log(
      `${SANCTIONS_LOG_PREFIX} FAILING OPEN: country=UA with no ` +
        `${GEO_REGION_HEADER} — Crimea/Donetsk/Luhansk not evaluable`,
    )
  }

  return null
}
