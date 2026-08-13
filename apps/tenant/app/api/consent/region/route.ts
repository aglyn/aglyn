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

import type { NextRequest } from 'next/server'
import {
  GEO_COUNTRY_HEADER,
  readRequestGeo,
} from '@aglyn/aglyn/app-utils/request-geo'

/**
 * The consent-posture region signal (AGL-1498).
 *
 * Tenant pages are ISR-cached, so the page render never sees the visitor's
 * request headers — this endpoint is where the client asks "where am I
 * visiting from?" to pick the consent posture. Same reader, same headers as
 * the AGL-1492 sanctions gate; deliberately NOT a second geo layer.
 *
 * Absent signal returns `country: null`, which the client maps to the
 * OPT-IN posture — the one place the consent feature does not maximize
 * tracking, because a few lost analytics events on rare headerless visits
 * are nothing against pre-consent tracking of an EU visitor. Absence is
 * logged the sanctions way: throttled, never silent — a control that fails
 * strict without saying so still hides an operational fact (local dev and
 * self-hosted installs run permanently headerless).
 */

const CONSENT_GEO_LOG_PREFIX = '[consent-geo]'
const NO_SIGNAL_LOG_INTERVAL_MS = 60_000

// A separate first-log flag, not a `loggedAt === 0` sentinel: with a
// timestamp sentinel the FIRST absence after a deploy is judged "already
// logged recently" — the same trap sanctions-geo.spec.ts caught (AGL-1492).
let hasLoggedNoSignal = false
let noSignalLoggedAt = 0
let noSignalCount = 0

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
  // Per-visitor by definition; a cached country pins one visitor's region
  // onto whoever the cache serves next — the exact ISR-shaped failure the
  // client-side evaluation exists to avoid.
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
