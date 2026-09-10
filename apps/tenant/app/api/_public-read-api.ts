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

import { API_VERSION, API_VERSION_HEADER } from '@aglyn/aglyn/app-utils/agent-openapi'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'
import { checkRateLimit } from '@aglyn/tenant-data-admin'

/**
 * The budget one address gets on the anonymous read API, per minute.
 *
 * Deliberately far above what any legitimate agent does. The WAF is the real
 * boundary and this is a backstop, so the number that matters is the one a
 * courteous caller can never reach: an agent reading a whole site — every page
 * as Markdown, the sitemap, the feeds — spends a few dozen requests, not six
 * hundred. Setting it tight would throttle exactly the callers the bot-detection
 * allowlist was opened for (AGL-2716), which is the opposite of the point.
 */
export const PUBLIC_READ_LIMIT = 600

/** The window {@link PUBLIC_READ_LIMIT} is counted in. */
export const PUBLIC_READ_WINDOW_MS = 60_000

/**
 * The gate on the anonymous read API, and the headers that describe it
 * (AGL-2722).
 *
 * ## Why the in-memory counter and not the durable one
 *
 * `consumeRateLimit` is durable and exact, and it is two Firestore round trips
 * inside a 2,500 ms budget. These endpoints are anonymous, cached, and the ones
 * `/llms.txt` now actively points agents at — so a durable counter would add
 * two writes and a read-latency floor to the highest-volume reads on the
 * platform, to enforce a limit whose whole purpose is to never be reached.
 * `checkRateLimit` is in-process, synchronous and free.
 *
 * ⚠️ The counter is therefore PER INSTANCE, which makes the published
 * `RateLimit-Remaining` a per-instance figure rather than a global one. That is
 * stated in `/openapi.json` rather than papered over: a header claiming to be
 * a global budget when it is not would be worse than no header, because a
 * caller would pace against a number that means something else.
 *
 * ## It fails OPEN, and that is a decision
 *
 * A limiter that cannot answer must not refuse. This one cannot fail — the
 * store is a process-local map — but the shape is kept anyway: anything thrown
 * while deciding allows the request. A read API that starts refusing because
 * its own bookkeeping is unwell has turned a bookkeeping problem into an
 * outage, and on this surface an extra request is a nuisance while a refused
 * one is an agent that concludes the site is unreachable.
 */
export function publicReadApiGate(request: Request): {
  refusal: Response | null
  headers: Record<string, string>
} {
  const version = { [API_VERSION_HEADER]: API_VERSION }
  try {
    const address =
      readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
    const rate = checkRateLimit(`public-read:${address}`, {
      limit: PUBLIC_READ_LIMIT,
      windowMs: PUBLIC_READ_WINDOW_MS,
    })

    /*
      RFC 9331 field names. `RateLimit-Reset` is expressed in SECONDS REMAINING
      rather than as a timestamp, which is what the draft settled on — a clock
      the caller already has beats one it has to trust ours for.
    */
    const resetSeconds = Math.max(
      0,
      Math.ceil((rate.resetMs - Date.now()) / 1000),
    )
    const headers: Record<string, string> = {
      ...version,
      'RateLimit-Limit': String(rate.limit),
      'RateLimit-Remaining': String(rate.remaining),
      'RateLimit-Reset': String(resetSeconds),
    }

    if (rate.allowed) return { refusal: null, headers }

    return {
      headers,
      refusal: new Response(
        JSON.stringify({
          status: 'error',
          statusCode: 429,
          statusMessage:
            `Too many requests. This address may make ${PUBLIC_READ_LIMIT} ` +
            `requests per minute to the read API. Retry in ${resetSeconds}s.`,
        }),
        {
          status: 429,
          headers: {
            ...headers,
            'Content-Type': 'application/json; charset=utf-8',
            // The one header a caller can act on without parsing a body.
            'Retry-After': String(Math.max(1, resetSeconds)),
            'Cache-Control': 'no-store',
          },
        },
      ),
    }
  } catch {
    // Fail OPEN. See the note above: silence is not evidence of an overage.
    return { refusal: null, headers: version }
  }
}

/** Copy `headers` onto `response` without rebuilding its body. */
export function withPublicReadHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value)
  }
  return response
}
