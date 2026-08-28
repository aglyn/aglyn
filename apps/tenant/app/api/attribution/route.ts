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
 * Where a suppressed credit badge or abuse-report control is reported
 * (AGL-1477).
 *
 * The guard on the page repairs the suppression; this is the half that makes
 * it MEAN something. Enforcement is a policy decision a person makes, and a
 * person needs a list — a site that had to have its report control put back
 * is a site worth looking at, and until now nothing anywhere knew.
 *
 * Unauthenticated by necessity, like `/api/errors` and `/api/csp-report`
 * beside it, and it follows the same discipline: byte cap before parse, field
 * clamps in the parser, per-IP in-memory rate limit, and 204 whatever
 * arrived. A beacon endpoint that answers anything else teaches retry loops.
 *
 * ## Why the write is throttled in memory rather than by a read
 *
 * The obvious shape — read the host doc, write if the last report is old —
 * pays a Firestore READ per beacon, on a route any visitor to any published
 * site can reach, for a signal whose value does not change with volume. One
 * report an hour per site says everything ten thousand would. The throttle is
 * therefore a module-scope map, which bounds writes per instance without
 * reading anything; a few extra writes across instances is the price, and it
 * is far below what the read would have cost.
 */

// lockdown-423: exempt — anonymous browser beacon; no caller identity, no org context.

import { checkRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4_096
const REPORT_THROTTLE_MS = 60 * 60 * 1000

/**
 * Reasons the guard can send. An unknown one is stored as `other` rather than
 * refused: the value is written to a document and read by staff, and a field
 * whose contents are whatever a POST body said is not one to trust.
 */
const REASONS = new Set([
  'removed',
  'display',
  'visibility',
  'opacity',
  'collapsed',
  'pointer-events',
  'offscreen',
  'covered',
])

const SUBJECTS = new Set(['badge', 'report'])

/** Last write per host, per instance. See the note above on why. */
const lastReportedAt = new Map<string, number>()

const accepted = (): Response => new Response(null, { status: 204 })

export async function POST(request: Request): Promise<Response> {
  try {
    // A cost control with no second key, so it keeps counting under the
    // no-address bucket rather than being skipped: this endpoint is
    // unauthenticated and writes, and the deployment that cannot name its
    // callers is the one an unbounded beacon would hurt most. The collapse
    // costs telemetry rather than service — every path here answers 204.
    const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
    // Generous for a browser that reports once per page view, nothing for a
    // flood. Over-limit posts are ACCEPTED and dropped.
    if (
      !checkRateLimit(`attribution:${ip}`, { limit: 10, windowMs: 60_000 })
        .allowed
    ) {
      return accepted()
    }
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return accepted()

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return accepted()
    }
    // Firestore document ids cannot hold a slash and are capped in length;
    // this value came from a POST body, so it is checked rather than trusted.
    const hostId = String(payload['hostId'] ?? '').trim()
    if (!hostId || hostId.length > 128 || /[/.\s]/.test(hostId)) {
      return accepted()
    }
    const reason = String(payload['reason'] ?? '')
    const subject = String(payload['subject'] ?? '')

    const now = Date.now()
    const previous = lastReportedAt.get(hostId) ?? 0
    if (now - previous < REPORT_THROTTLE_MS) return accepted()
    lastReportedAt.set(hostId, now)

    const firestore = firebaseAdmin.app().firestore()
    await firestore
      .collection('hosts')
      .doc(hostId)
      .set(
        {
          attributionIntegrity: {
            lastSuppressedAt:
              firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            lastReason: REASONS.has(reason) ? reason : 'other',
            lastSubject: SUBJECTS.has(subject) ? subject : 'other',
            // A count, not a log. The question staff answer is "is this site
            // suppressing attribution, and has it kept doing it" — a
            // per-event history would be a subcollection nobody reads and a
            // retention obligation nobody asked for.
            suppressedReports: firebaseAdmin.firestore.FieldValue.increment(1),
          },
        },
        { merge: true },
      )
    return accepted()
  } catch {
    // A beacon that 500s is a beacon that gets retried. Never.
    return accepted()
  }
}
