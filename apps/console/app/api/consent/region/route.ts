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

// lockdown-423: exempt — pure request-header echo. It reads `x-vercel-ip-country`
// off the incoming request and returns a country code; it touches no org doc, no
// host doc and no Firestore collection, so there is nothing here for a lock to
// pause. Refusing it would only push the consent posture to opt-in, which is a
// privacy default rather than an enforcement — and it would do so on the sign-in
// page, where a locked org's members still have to be able to answer.

/**
 * The console's consent-posture region signal.
 *
 * The console is a fully client-rendered app behind `NoSsr`, so no render ever
 * sees the visitor's request headers — this endpoint is where the client asks
 * "where am I visiting from?" in order to pick the consent posture. It is the
 * console's own copy of the route the tenant runtime serves at the same path,
 * because a route handler cannot be shared across two Next apps; the part that
 * could be shared is, and it is the reader (`readRequestGeo`), which is the
 * same one the AGL-1492 sanctions gate uses. Deliberately NOT a second geo
 * layer.
 *
 * ## It must stay reachable while signed out
 *
 * The console's most-collected public page is `/signin`, and a prior-consent
 * visitor there has to be gated like any other. `/api/*` sits outside the
 * middleware auth matcher, so this answers before there is a session; if it
 * ever moves inside one, every signed-out visitor resolves to unknown region
 * and therefore to opt-in — strict, but it would silently stop measuring the
 * rest of the world's sign-in page.
 *
 * An absent signal returns `country: null`, which the client maps to opt-in.
 * Absence is logged the sanctions way — throttled, never silent — because a
 * control that fails strict without saying so still hides an operational fact:
 * local dev and self-hosted installs run permanently headerless.
 */

import type { NextRequest } from 'next/server'
import { GEO_COUNTRY_HEADER, readRequestGeo } from '@aglyn/aglyn/app-utils/request-geo'

const CONSENT_GEO_LOG_PREFIX = '[consent-geo]'
const NO_SIGNAL_LOG_INTERVAL_MS = 60_000

// A separate first-log flag rather than a `loggedAt === 0` sentinel: with a
// timestamp sentinel the FIRST absence after a deploy is judged "already
// logged recently" and never reported at all (AGL-1492).
let hasLoggedNoSignal = false
let noSignalLoggedAt = 0
let noSignalCount = 0

/** Test seam: forget what has been logged, so throttling is assertable. */
export function resetConsentGeoTelemetry(): void {
  hasLoggedNoSignal = false
  noSignalLoggedAt = 0
  noSignalCount = 0
}

export async function GET(req: NextRequest): Promise<Response> {
  const geo = readRequestGeo(req.headers)
  if (!geo.country) {
    noSignalCount += 1
    const now = Date.now()
    if (
      !hasLoggedNoSignal ||
      now - noSignalLoggedAt >= NO_SIGNAL_LOG_INTERVAL_MS
    ) {
      console.warn(
        `${CONSENT_GEO_LOG_PREFIX} FALLING TO OPT-IN: no ` +
          `${GEO_COUNTRY_HEADER} on ${noSignalCount} request(s) since ` +
          'instance start — consent posture cannot be geo-resolved for these',
      )
      hasLoggedNoSignal = true
      noSignalLoggedAt = now
    }
  }
  // Per-visitor by definition. A cached country pins one visitor's region onto
  // whoever the cache serves next, which on a shared edge means a US answer
  // handed to a European visitor and no banner shown.
  return Response.json(
    { country: geo.country },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Vary: GEO_COUNTRY_HEADER,
      },
    },
  )
}
