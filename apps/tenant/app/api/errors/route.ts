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
 * Where the tenant runtime's uncaught browser errors land (AGL-1538) — the
 * first-party stand-in for "Crashlytics for web", which does not exist.
 * The beacon (libs/aglyn app-utils/error-beacon) batches window.onerror /
 * unhandledrejection here; this route disarms the payload and forwards it
 * to Cloud Error Reporting, whose alert policy pages through the existing
 * GCP notification channel (AGL-1502).
 *
 * Unauthenticated by necessity — every visitor to a published site is
 * anonymous by design — so it follows the csp-report discipline: byte
 * cap before parse, field clamps in the parser, per-IP in-memory rate limit
 * (the volume tier, deliberately not the Firestore-backed limiter — see
 * rate-limit-store.ts on cost), and it answers 204 whatever arrived.
 */

// lockdown-423: exempt — anonymous browser beacon; no caller identity, no org context.

import {
  checkRateLimit,
  parseClientErrorEvents,
  reportClientErrors,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 65_536

const accepted = () => new Response(null, { status: 204 })

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
    // Awaited (not fire-and-forget): a serverless response ending cancels
    // in-flight work, and the reporter carries its own short timeout.
    await reportClientErrors(events, { service: 'tenant-web' })
    return accepted()
  } catch {
    // The observer must never become the outage.
    return accepted()
  }
}
