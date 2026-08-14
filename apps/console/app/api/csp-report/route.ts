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
 * Where CSP violations land (AGL-523).
 *
 * The report-only `script-src` has been live since AGL-518 with no reporting
 * directive, so it has been detecting violations and telling nobody. This is
 * the endpoint that makes the flip to enforcing a decision about data rather
 * than a guess — including the open question of whether to go to
 * `strict-dynamic` or stay on `'self' https: blob:`, which the report-only
 * policy is already exercising.
 *
 * Reports go to the runtime log as one JSON line each, tagged for a Vercel log
 * query — the same instrument AGL-1152 used to settle the cold-start argument.
 * Deliberately not Firestore: this needs no schema, no rules change, no
 * retention job, and no write path that an unauthenticated caller can drive.
 *
 * ## This route is unauthenticated by necessity
 *
 * The browser posts these with no credentials, so anyone can post anything.
 * Every property below follows from that:
 *
 * - the body is read with a hard byte cap, not `await request.json()`;
 * - nothing is echoed back, so it cannot be used to reflect content;
 * - every logged field is length-clamped in `csp-report.ts`;
 * - reports per request are capped, so one POST cannot emit unbounded lines;
 * - it always answers 204, whatever arrived. A report endpoint that argues
 *   with the browser gets retried, and the status is not read by anything.
 */

import {
  isActionableViolation,
  parseCspReports,
  violationKey,
} from '../../../utils/server/csp-report'

// lockdown-423: exempt — anonymous browser beacon; no caller identity, no org context.

export const dynamic = 'force-dynamic'

/**
 * Generous for a real report, tiny next to what a hostile client would send.
 * A legitimate violation is a few hundred bytes; the biggest field is
 * `original-policy`, which is echoed back to us and which we never read.
 */
const MAX_BODY_BYTES = 16_384

/**
 * One page load can emit many violations, but a caller sending hundreds is
 * not a browser. Bounded so a single POST cannot turn into a log flood.
 */
const MAX_REPORTS_PER_REQUEST = 10

/** 204 with no body — the answer for every path through this route. */
const accepted = () => new Response(null, { status: 204 })

export async function POST(request: Request): Promise<Response> {
  try {
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

    // Deduplicated within the request: a page that loads the same offending
    // script in a loop would otherwise emit the same line many times and make
    // one defect look like many.
    const seen = new Set<string>()
    for (const violation of violations) {
      const key = violationKey(violation)
      if (seen.has(key)) continue
      seen.add(key)
      console.warn(
        JSON.stringify({
          tag: 'AGL-523:csp-violation',
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
    // Never a 5xx. This route exists to observe a problem, and it must not
    // become one — a failing report endpoint would be retried by the browser
    // and would say nothing useful about the page that triggered it.
    return accepted()
  }
}

/**
 * The Reporting API sends a CORS preflight for the `report-to` endpoint when
 * the reporting group's origin differs from the document's. Ours does not, but
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
