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
  isMachinePluginApiPath,
  lockdownIntentForMethod,
  VISITOR_WRITE_RATE_LIMIT,
  VISITOR_WRITE_RATE_WINDOW_MS,
  visitorWriteRateLimitKey,
} from '@aglyn/aglyn/server'
import { consumeRateLimit } from './rate-limit-store'

/**
 * The rate-limit refusal a visitor-facing plugin write returns, or null to
 * proceed (AGL-1770):
 *
 *   const limited = await visitorWriteRateLimitRefusal({ path, hostId, request })
 *   if (limited) return limited
 *
 * Sits beside `visitorWriteRefusal` on purpose — same shape, same chokepoint,
 * same "return it or carry on" contract. The policy (ceiling, window, key,
 * which paths are exempt) is pure and lives in `@aglyn/aglyn/server`; this is
 * only the durable half, which needs Firestore.
 */

/** Client IP, first `x-forwarded-for` hop. Matches the sibling tenant routes. */
function clientIp(request: { headers?: { get?: (name: string) => unknown } }): string {
  const raw = request?.headers?.get?.('x-forwarded-for')
  const first = String(raw ?? '').split(',')[0]?.trim()
  return first || 'unknown'
}

export interface VisitorWriteRateLimitOptions {
  /** Dispatcher path, e.g. `commerce/cart`. Decides visitor vs machine. */
  path: string
  /** The site the write targets; `''` when none resolved (still limited). */
  hostId: string
  /** Read for its method and `x-forwarded-for`. */
  request: { method?: string; headers?: { get?: (name: string) => unknown } }
  limit?: number
  windowMs?: number
  nowMs?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

/**
 * Counts one visitor write and returns a 429 once the window is spent.
 *
 * ## Reads are not limited, and that is a decision rather than an omission
 *
 * AGL-1770 scopes this to visitor-facing *writes*, and the cost argument
 * agrees. `RATE_LIMITING.md`'s standing rule is "`checkRateLimit` for volume,
 * `consumeRateLimit` for consequence": each durable call is a Firestore
 * transaction — one read plus one write — which is the right price for a cart
 * write that itself creates a document, and the wrong price for a GET. The
 * dispatcher's read paths "leave before any Firestore read" (the lockdown gate
 * says so), so a durable limiter there would be the ONLY Firestore work in the
 * request — precisely the analytics-beacon anti-pattern the doc names.
 *
 * The residual is real and worth stating: tenant reads are not free (~40
 * Firestore reads per rendered page). It is a different defect with a
 * different remedy — caching and the ISR layer, not a per-request
 * transaction — and it is not this one.
 *
 * ## Fail SOFT, inherited from `consumeRateLimit` and re-argued here
 *
 * A Firestore outage lets traffic through, flagged `degraded`, rather than
 * refusing it. CSRF fails closed; this deliberately does not, for three
 * reasons, the third of which is specific to this limiter:
 *
 * 1. **The blast radius of the strict choice is every storefront at once.**
 *    A Firestore blip that 429s every add-to-cart on every site costs
 *    merchants sales during an outage they did not cause. The risk it guards
 *    is unbounded document creation — storage. Lost revenue is the worse of
 *    the two, and it is the one the merchant notices.
 * 2. **The fallback still enforces something.** `consumeRateLimit` degrades to
 *    the in-process limiter at the same ceiling, so the cap becomes
 *    `limit × warm instances` rather than nothing.
 * 3. **The store and the thing being protected are the same Firestore.** The
 *    counter lives in `rateLimits` and the cart document it guards lives in
 *    `hosts/…/carts` — one database. If the limiter cannot write, the write it
 *    exists to bound is almost certainly failing too. Failing closed would
 *    refuse requests that were going to fail anyway, and *additionally* refuse
 *    the ones that would have succeeded. It buys nothing.
 *
 * The degradation stays findable: AGL-1679's recovery marker and AGL-1693's
 * `/api/health/rate-limits` already cover every `consumeRateLimit` caller, so
 * this one is watched by construction and needs no record of its own.
 *
 * ## What the caller is told
 *
 * A bare 429 with `Retry-After`. No `X-RateLimit-*` headers and no `degraded`
 * flag, following `forms/submit`: this surface is public and unauthenticated,
 * and both "you have N requests left" and "the global limiter is currently a
 * per-instance one" are sentences an abuser would spend the window on.
 */
export async function visitorWriteRateLimitRefusal(
  options: VisitorWriteRateLimitOptions,
): Promise<Response | null> {
  if (lockdownIntentForMethod(options.request?.method) === 'read') return null
  if (isMachinePluginApiPath(options.path)) return null

  const nowMs = options.nowMs ?? Date.now()
  const rate = await consumeRateLimit(
    visitorWriteRateLimitKey(options.hostId, clientIp(options.request)),
    {
      limit: options.limit ?? VISITOR_WRITE_RATE_LIMIT,
      windowMs: options.windowMs ?? VISITOR_WRITE_RATE_WINDOW_MS,
      now: nowMs,
      firestore: options.firestore,
    },
  )
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

export default visitorWriteRateLimitRefusal
