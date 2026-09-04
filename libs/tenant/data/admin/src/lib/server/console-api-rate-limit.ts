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

import {
  CONSOLE_API_RATE_LIMIT,
  CONSOLE_API_RATE_WINDOW_MS,
  consoleApiRateLimitKey,
  isMachinePluginApiPath,
  lockdownIntentForMethod,
} from '@aglyn/aglyn/server'
import { consumeRateLimit } from './rate-limit-store'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

/**
 * The rate-limit refusal a console plugin-API write returns, or null to
 * proceed:
 *
 *   const limited = await consoleApiRateLimitRefusal({ path, uid, request })
 *   if (limited) return limited
 *
 * The same split as `visitorWriteRateLimitRefusal` beside it — the policy
 * (ceiling, window, key, which paths are exempt) is pure and lives in
 * `@aglyn/aglyn/server`; this is only the durable half, which needs Firestore.
 * The counter is `consumeRateLimit`, unchanged and unwrapped, so the console
 * inherits its postures rather than acquiring a second set.
 */

/**
 * The caller's address, through the shared reader, or the no-address bucket.
 *
 * `readClientIp` counts from the RIGHT of the forwarding chain and is the only
 * reader allowed to answer this question, so a caller cannot choose its own
 * bucket by prepending an address.
 */
function clientIp(request: {
  headers?: { get?: (name: string) => unknown }
}): string {
  const headers = request?.headers
  if (typeof headers?.get !== 'function') return NO_CLIENT_ADDRESS_BUCKET
  return (
    readClientIp(headers as { get(name: string): string | null }) ??
    NO_CLIENT_ADDRESS_BUCKET
  )
}

export interface ConsoleApiRateLimitOptions {
  /** Dispatcher path, e.g. `email/list-members-add`. Decides machine vs not. */
  path: string
  /**
   * The verified Firebase uid, or null when the request carried no bearer
   * token or one that did not decode. The console dispatcher has already
   * decoded it for the lockdown gate, so this costs no second verification.
   */
  uid: string | null
  /** Read for its method and its client-address headers. */
  request: { method?: string; headers?: { get?: (name: string) => unknown } }
  limit?: number
  windowMs?: number
  nowMs?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

/**
 * Counts one console write and returns a 429 once the window is spent.
 *
 * ## Reads are not limited
 *
 * The standing rule in `RATE_LIMITING.md` is "`checkRateLimit` for volume,
 * `consumeRateLimit` for consequence": a durable call costs one Firestore read
 * plus one write, which is the right price beside a handler that installs a
 * bundle or calls a paid model, and the wrong price in front of a listing GET.
 * Every route on this surface that spends something spends it on a POST — the
 * two email list previews, the member add, the suppression writes, `ai/assist`,
 * every marketplace install and publish — so writes-only covers the exposure
 * rather than merely most of it.
 *
 * ## Fail SOFT, inherited from `consumeRateLimit`
 *
 * A Firestore outage lets traffic through, flagged `degraded`, rather than
 * refusing it; a contended key is refused. That classification is the store's
 * and is not re-decided here. Failing closed would take the console's write
 * surface down during an unrelated blip — the operator's own recovery tools
 * among them — to bound spend that the outage has already stopped, since the
 * counter and the documents these handlers write are one Firestore. CSRF fails
 * closed because forging a request is the threat; here the threat is volume,
 * and volume during an outage is not the incident.
 *
 * ## No staff bypass
 *
 * The lockdown gates above this one grant staff a bypass, because their
 * question is "should anyone be doing this right now" and staff are how an
 * incident gets diagnosed. This one's question is "how much is this costing",
 * and a staff session spends exactly what a customer session spends. A bypass
 * would also make the surface unlimited for the accounts most likely to be
 * driving it from a script.
 *
 * ## What the caller is told
 *
 * A bare 429 with `Retry-After`, following `visitorWriteRateLimitRefusal` and
 * `forms/submit`. The fallback bucket below is reached by callers that proved
 * nothing, so the response says nothing a caller could spend the rest of the
 * window on.
 */
export async function consoleApiRateLimitRefusal(
  options: ConsoleApiRateLimitOptions,
): Promise<Response | null> {
  if (lockdownIntentForMethod(options.request?.method) === 'read') return null
  if (isMachinePluginApiPath(options.path)) return null

  const nowMs = options.nowMs ?? Date.now()
  // Prefixed, so an address can never collide with a uid: Firebase uids are
  // opaque and a bucket shared between an identified operator and everyone
  // arriving from one address would refuse the wrong one of them.
  const subject = options.uid
    ? `uid:${options.uid}`
    : `ip:${clientIp(options.request)}`
  const rate = await consumeRateLimit(consoleApiRateLimitKey(subject), {
    limit: options.limit ?? CONSOLE_API_RATE_LIMIT,
    windowMs: options.windowMs ?? CONSOLE_API_RATE_WINDOW_MS,
    now: nowMs,
    firestore: options.firestore,
  })
  if (rate.allowed) return null

  return Response.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(
          Math.max(1, Math.ceil((rate.resetMs - nowMs) / 1000)),
        ),
      },
    },
  )
}

export default consoleApiRateLimitRefusal
