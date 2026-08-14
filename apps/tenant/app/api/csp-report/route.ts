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
 * Where CSP violations from PUBLISHED CUSTOMER SITES land (AGL-1703).
 *
 * The tenant had no collector at all. That is why AGL-1685 fixed only the
 * console half: a report-only `img-src` shipped here without this route would
 * have reported into nothing, which is the exact AGL-518 failure — a policy
 * that detects violations, tells nobody, and reads as an all-clear.
 *
 * It shares the PARSER with the console (`@aglyn/aglyn/app-utils/csp-report`),
 * moved to a lib in this pass, because normalizing two wire formats and
 * dropping browser-extension noise is the same job on any surface. It does not
 * share the ROUTE, and the three differences below are the reason.
 *
 * ## 1. Same-origin by construction, on a domain we do not own
 *
 * The alternative considered was posting to the console's collector as an
 * absolute URL. Rejected: it would make every visitor to every customer's
 * website issue a cross-origin request to `console.aglyn.com`, needing a CORS
 * preflight per origin and putting our console's hostname in the network log
 * of a stranger reading a customer's blog. A relative `/api/csp-report`
 * resolves against the document, so it lands on the customer's own domain and
 * arrives here — the tenant middleware matcher excludes `/api`, so this route
 * is reachable on every custom domain and every `*.aglyn.app` subdomain
 * without any per-host wiring.
 *
 * ## 2. Volume is a different order, and per-IP limiting alone does not fix it
 *
 * The console's collector is driven by signed-in staff and customers. This one
 * is driven by every anonymous visitor to every published site. A single
 * offending image in a shared header would otherwise emit one log line PER
 * PAGE VIEW, forever, across the whole customer base.
 *
 * So there are two limiters, and they answer different questions:
 *
 * - per IP, which bounds what one hostile client can send;
 * - **per violation KEY**, which bounds what one real defect can cost. The
 *   console dedupes only WITHIN a single POST, which is right there and
 *   useless here: 10,000 visitors each report the same broken image once, so
 *   no POST ever contains a duplicate and the log still gets 10,000 lines.
 *   Keying the limiter on `violationKey` collapses that to a handful of lines
 *   per window per instance — the defect is what we want counted, not the
 *   traffic.
 *
 * ## 3. The body is attacker-controllable, and so is the key space
 *
 * The console's discipline is inherited whole (byte cap before parse, every
 * logged field clamped in the parser, nothing echoed back, always 204). One
 * thing is new: `violationKey` contains `blockedUri`, which the caller
 * chooses. Feeding the per-key limiter from the shared module-scope store
 * would let a distributed flood of unique URIs grow that map without bound —
 * a memory leak reachable by anyone with a URL. Hence {@link keyStore}: a
 * private, size-capped store, so the worst case is a cleared cache rather
 * than an OOM.
 *
 * The site name is taken from the REQUEST, never from `document-uri` in the
 * body. A report whose body claims to be from another customer's domain is
 * then a lie about a field we do not read.
 */

// lockdown-423: exempt — anonymous browser beacon; no caller identity, no org context.

import {
  isActionableViolation,
  parseCspReports,
  violationKey,
} from '@aglyn/aglyn/app-utils/csp-report'
import { checkRateLimit } from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/**
 * Matches the console's cap. A legitimate violation is a few hundred bytes;
 * the biggest field is `original-policy`, echoed back to us and never read.
 */
const MAX_BODY_BYTES = 16_384

/** One page load can emit many violations; a caller sending more is not a browser. */
const MAX_REPORTS_PER_REQUEST = 10

/** Generous for a browser, nothing for a flood. Over-limit posts are dropped, not refused. */
const IP_LIMIT = 20
const IP_WINDOW_MS = 60_000

/**
 * How often one DISTINCT violation may reach the log, per instance.
 *
 * Three is not one on purpose: the same `img-src` failure appearing on three
 * different sites is three lines worth having, and `violationKey` includes the
 * document path but not the site, so a single count would hide the fan-out.
 * Ten minutes because the thing being measured is whether a defect exists at
 * all, not how popular the page carrying it is.
 */
const KEY_LIMIT = 3
const KEY_WINDOW_MS = 600_000

/**
 * Private store for the per-key limiter, capped because its keys come from the
 * caller. Cleared wholesale rather than evicted least-recently-used: this is a
 * noise damper, and the failure mode of clearing it is a brief return to
 * verbose logging, which is strictly better than the failure mode of an
 * unbounded map on a long-lived instance.
 */
const keyStore = new Map<string, { count: number; windowStartMs: number }>()
const MAX_TRACKED_KEYS = 5_000

/** 204 with no body — the answer for every path through this route. */
const accepted = () => new Response(null, { status: 204 })

/**
 * Which published site reported, from the request rather than the payload.
 *
 * Clamped and character-restricted before it is logged: it originates in a
 * `Host` header, which a non-browser caller writes freely, and a log line is a
 * place where an unbounded attacker-controlled string does real damage.
 */
function reportingSite(request: Request): string {
  const raw =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const host = raw.split(',')[0].trim().slice(0, 253).toLowerCase()
  return /^[a-z0-9.:_-]+$/.test(host) ? host : 'unknown'
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    if (
      !checkRateLimit(`csp:${ip}`, { limit: IP_LIMIT, windowMs: IP_WINDOW_MS })
        .allowed
    ) {
      return accepted()
    }

    // Cap BEFORE parsing. `request.json()` on a hostile body would buffer
    // whatever was sent, and a Content-Length header is a claim, not a limit.
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return accepted()

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return accepted()
    }

    const violations = parseCspReports(payload)
      .filter(isActionableViolation)
      .slice(0, MAX_REPORTS_PER_REQUEST)
    if (violations.length === 0) return accepted()

    const site = reportingSite(request)
    if (keyStore.size > MAX_TRACKED_KEYS) keyStore.clear()

    for (const violation of violations) {
      const key = violationKey(violation)
      // Both the within-request dedupe the console does AND the across-request
      // damper this surface needs, from one counter: the second occurrence in
      // the same POST is simply the second hit on the same key.
      if (
        !checkRateLimit(`${site}|${key}`, {
          limit: KEY_LIMIT,
          windowMs: KEY_WINDOW_MS,
          store: keyStore,
        }).allowed
      ) {
        continue
      }
      console.warn(
        JSON.stringify({
          tag: 'AGL-1703:tenant-csp-violation',
          site,
          key,
          directive: violation.effectiveDirective,
          blocked: violation.blockedUri,
          path: violation.documentPath,
          source: violation.sourceFile,
          line: violation.lineNumber,
          sample: violation.sample,
          disposition: violation.disposition,
        }),
      )
    }
    return accepted()
  } catch {
    // Never a 5xx. This route exists to observe a problem and must not become
    // one — a failing report endpoint gets retried by the browser and says
    // nothing useful about the page that triggered it.
    return accepted()
  }
}

/**
 * The Reporting API sends a CORS preflight for the `report-to` endpoint when
 * the reporting group's origin differs from the document's. Ours does not —
 * the endpoint is relative, so it is always the customer's own domain — but
 * answering is free and a missing preflight response silently drops every
 * report from the browsers that ask.
 */
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
