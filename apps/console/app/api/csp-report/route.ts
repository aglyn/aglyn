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
  type CspViolation,
  isActionableViolation,
  parseCspReports,
  violationKey,
} from '@aglyn/aglyn/app-utils/csp-report'

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
 *
 * Counted in DISTINCT violations — see the dedup below. Ten repeats of one
 * problem cost one slot, so this is a budget for how many separate things a
 * page may be doing wrong, which is what makes it survivable for two
 * report-only directives sharing the endpoint (AGL-1785).
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

    // Deduplicated within the request: a page that loads the same offending
    // script in a loop would otherwise emit the same line many times and make
    // one defect look like many.
    //
    // The dedup runs BEFORE the cap, and the order is deliberate (AGL-1785).
    // It used to run after, which made the cap a budget of ten REPORTS rather
    // than ten PROBLEMS — ten repeats of one defect could consume it and leave
    // one log line to show for it.
    const seen = new Set<string>()
    const distinct = parseCspReports(payload)
      .filter(isActionableViolation)
      .filter((violation) => {
        const key = violationKey(violation)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    // Then round-robin across DIRECTIVES before capping, which is the part that
    // actually protects the measurement (AGL-1785).
    //
    // The console now runs two report-only directives through this one
    // endpoint: `img-src` (AGL-1685 — the data AGL-1702's flip is gated on) and
    // `script-src` (AGL-1785). The `report-to` wire format batches many
    // violations into a single POST, so in report order one noisy directive
    // takes the whole budget and the other is truncated away in silence.
    //
    // Deduping alone does NOT fix that, and assuming it did was the mistake
    // worth recording: a loader pulling twelve DIFFERENT chunk URLs off one CDN
    // is twelve distinct violations, so nothing collapses them — and that is
    // exactly the AGL-1779 shape. Interleaving is what bounds the damage: with
    // one violation of a directive present anywhere in the batch, that
    // directive is served in the first round and cannot be starved by another.
    //
    // The flood bound this cap exists for is unchanged — still at most ten log
    // lines per POST — and the set is bounded by what fits in `MAX_BODY_BYTES`.
    const byDirective = new Map<string, CspViolation[]>()
    for (const violation of distinct) {
      const bucket = byDirective.get(violation.effectiveDirective)
      if (bucket) bucket.push(violation)
      else byDirective.set(violation.effectiveDirective, [violation])
    }
    const fair: CspViolation[] = []
    for (let round = 0; fair.length < distinct.length; round += 1) {
      let added = false
      for (const bucket of byDirective.values()) {
        if (round < bucket.length) {
          fair.push(bucket[round])
          added = true
        }
      }
      if (!added) break
    }
    const violations = fair.slice(0, MAX_REPORTS_PER_REQUEST)

    for (const violation of violations) {
      const key = violationKey(violation)
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
