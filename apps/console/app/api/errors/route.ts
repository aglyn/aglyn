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
 * Where the console's uncaught browser errors land (AGL-1538) — the
 * first-party stand-in for "Crashlytics for web", which does not exist.
 * The beacon (libs/aglyn app-utils/error-beacon) batches window.onerror /
 * unhandledrejection here; this route disarms the payload and forwards it
 * to Cloud Error Reporting, whose alert policy pages through the existing
 * GCP notification channel (AGL-1502).
 *
 * Unauthenticated by necessity — errors on the sign-in page are exactly the
 * ones worth hearing about — so it follows the csp-report discipline: byte
 * cap before parse, field clamps in the parser, per-IP in-memory rate limit
 * (the volume tier, deliberately not the Firestore-backed limiter — see
 * rate-limit-store.ts on cost), and it answers 204 whatever arrived.
 *
 * Also the collector for docs.aglyn.com (AGL-1646): the docs site is static
 * Docusaurus with no API routes of its own, so its beacon (a standalone
 * copy of the wire format in apps/docs/src/error-beacon.ts) posts here
 * cross-origin. Hence the CORS headers and the OPTIONS handler below — the
 * docs beacon sends CORS *simple requests* (text/plain), but a preflighting
 * client must not find a wall. Docs events are forwarded under service
 * `docs-web`, keyed on the request Origin, so the two surfaces group
 * separately in Error Reporting.
 */

// lockdown-423: exempt — anonymous browser beacon; no caller identity, no org context.

import {
  checkRateLimit,
  parseClientErrorEvents,
  reportClientErrors,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 65_536

/**
 * The one cross-origin caller this collector accepts reports from (AGL-2124).
 *
 * Was the bare literal `https://docs.aglyn.com`. This is the receiving half of
 * the docs error beacon, and pinning it meant an operator running BOTH halves
 * of the open-source stack still could not have their own docs site report to
 * their own console: the browser blocked every POST on CORS, so their beacon
 * was silently inert while ours was the only origin the collector would talk
 * to.
 *
 * Same env name the runbook documents and `assist-retrieval.ts` reads — one
 * value, one name (AGL-733). Bracket notation is correct here and deliberate:
 * this module is server-only, and using the dot form would inline the value
 * into any client bundle that ever imported it.
 */
const DOCS_ORIGIN = (
  process.env['NEXT_PUBLIC_DOCS_ORIGIN'] || 'https://docs.aglyn.com'
).replace(/\/+$/, '')

// Fixed allowed origin (same-origin console callers never read the response,
// so a docs-only ACAO costs them nothing); Vary keeps caches honest.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': DOCS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}

const accepted = () => new Response(null, { status: 204, headers: CORS_HEADERS })

export function OPTIONS(): Response {
  return accepted()
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    // 30 events/min/IP is generous for a browser and nothing for a flood;
    // over-limit posts are ACCEPTED and dropped — a beacon endpoint that
    // returns 429 teaches retry loops.
    if (!checkRateLimit(`errors:${ip}`, { limit: 30, windowMs: 60_000 }).allowed) {
      return accepted()
    }
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return accepted()
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return accepted()
    }
    const events = parseClientErrorEvents(payload)
    // Docs reports group under their own service; the console keeps its own.
    // Origin is the browser-asserted caller — good enough for a grouping
    // label, and it decides nothing security-relevant.
    const service =
      request.headers.get('origin') === DOCS_ORIGIN ? 'docs-web' : 'console-web'
    // Awaited (not fire-and-forget): a serverless response ending cancels
    // in-flight work, and the reporter carries its own short timeout.
    await reportClientErrors(events, { service })
    return accepted()
  } catch {
    // The observer must never become the outage.
    return accepted()
  }
}
