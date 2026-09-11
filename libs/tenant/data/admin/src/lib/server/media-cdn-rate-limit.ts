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
  type ClientIpHeaders,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'
import { consumeRateLimit } from './rate-limit-store'

/**
 * The media CDN's per-caller limit (AGL-2812).
 *
 * `/api/media/cdn/*` is anonymous public delivery, and nothing bounded how
 * much of it one caller could take. The firewall bypasses the route on
 * purpose, because link-preview crawlers and Gmail's image proxy cannot solve
 * a challenge ("Public asset delivery bypass" in
 * `tools/scripts/lib/firewall-posture.mjs`). Both middlewares exclude `/api/*`,
 * and no WAF rule covers the path. `serveMediaCdn` is the one piece of code
 * every request passes through, so the limit lives there.
 *
 * ## What is counted
 *
 * A GET that is about to read bytes out of Storage: past every access gate,
 * past the lockdown and quarantine refusals, and past the 304 exit. A refusal,
 * a 304 and a HEAD send no file, so a revalidating browser, a crawler's HEAD
 * and a probe for a deleted id spend nothing. The counter's Firestore write is
 * paid only where the delivery it guards is about to cost more.
 *
 * ## Two budgets, split where the edge splits them
 *
 * Images and everything else are counted separately, on the line
 * `mediaCdnEdgeCacheable` already draws (AGL-1515):
 *
 * - **Images** are held by the edge, so only a miss reaches the function, and
 *   images are what link-preview crawlers and Gmail's image proxy fetch.
 * - **Everything else** (video, audio, PDFs, documents) is `private`, so every
 *   request reaches the function, and it is where the bytes are: a video
 *   master is a single request for up to 200 MB.
 *
 * Separate keys also mean a DAM grid's burst of tiles cannot spend the budget
 * the video on the same page needs, or the reverse.
 *
 * ## Thresholds, from measured traffic
 *
 * Read from both mounts' production request logs on 2026-09-11: the tenant's
 * last seven days (2026-09-04 08:01 to 2026-09-11 07:56 UTC), and the
 * console's last sixteen hours, which is all it retains. Only requests that
 * reached the function count, since an edge hit never runs this code.
 *
 * | measured | busiest minute, whole route |
 * | -- | -- |
 * | image deliveries (200 and 206) | 98 |
 * | every other delivery (200 and 206) | 31 |
 * | every request, with 304s, 404s and edge hits | 236 |
 * | link-preview crawlers and other bots, together | 32 |
 * | Gmail's image proxy | none in the sample |
 *
 * Each of those minutes was one browser: the image peak was a single Chrome
 * session pulling 129 distinct assets, and the non-image peak a single session
 * following 31 `?download=1` links. No asset took more than 4 range requests
 * in a minute. Over thirty days the day documents count 30,855 origin serves
 * in all, and 4,234 on the busiest day.
 *
 * Each ceiling is at least five times the busiest minute the whole route
 * served in its class. No single address can reach it with a pattern the route
 * has actually seen, even if every request in that minute had been its own:
 *
 * - {@link MEDIA_CDN_IMAGE_RATE_LIMIT}, 600: 6.1 times the image peak, and more
 *   than 18 times every crawler together.
 * - {@link MEDIA_CDN_NON_IMAGE_RATE_LIMIT}, 180: 5.8 times the non-image peak.
 *   Tenant video uploads are paused (AGL-2830), so film playback is barely in
 *   the sample. A page of twelve films at four ranges a minute each still fits
 *   more than three times over.
 *
 * ## Keyed on the caller alone
 *
 * The key is the caller's address and the class: not the site, the asset or
 * the query string. Cycling media ids, cache-busting a URL with a junk query
 * parameter, or switching between the tenant and console mounts all land in
 * the same counter.
 *
 * The address comes from `readClientIp`, which reads the hop the platform
 * wrote rather than one a caller can prepend. An IPv6 address counts by its
 * `/64`: one subscriber is routinely handed a whole `/64`, so keying on the
 * full address would give that subscriber 2^64 budgets.
 *
 * A request with no readable address is not counted at all. One shared bucket
 * for every unaddressable caller would refuse all of them together the moment
 * a proxy stopped naming callers, which is media delivery taken down by its
 * own limiter (see `NO_CLIENT_ADDRESS_BUCKET`). Vercel always names the caller,
 * so production does not reach that branch.
 *
 * ## Fails open
 *
 * Only a durable count past the ceiling refuses. Everything else admits:
 *
 * - **Contended, or no answer inside the budget.** `consumeRateLimit` reports
 *   both as `allowed: false` with `contended: true`. That is the store saying
 *   it could not count, not that the caller is over, and reading it as a
 *   refusal is how a slow counter fails every request closed.
 * - **The store is down.** `consumeRateLimit` falls back to its per-instance
 *   count and flags `degraded`. The episode is still recorded and still
 *   reaches `/api/health/rate-limits`; the request is admitted.
 * - **Anything thrown.** Counting may never be the reason a delivery fails.
 *
 * Delivery is the product, and the counter and the media document share one
 * Firestore. While the counter cannot answer, the document read in front of it
 * is usually failing too, and refusing would add a second outage to the first.
 *
 * ## Latency
 *
 * `serveMediaCdn` starts the count beside the Storage metadata read, so its
 * two round trips overlap one the request already pays. It gets
 * {@link MEDIA_CDN_RATE_LIMIT_BUDGET_MS} rather than the store's 2.5 s
 * default, and a request whose count has not come back by then is admitted.
 *
 * ## What it does not bound
 *
 * The bytes in one request, a caller spread across many addresses, and an
 * org's total delivery. A WAF rule, a signed or referrer-checked public URL and
 * a per-org byte cap are the controls for those. Each one changes what an
 * `og:image`, a mailed image or an embed is able to fetch, so none of them is
 * decided here.
 */

/** Fixed 60 s window, the same as every other limiter on the store. */
export const MEDIA_CDN_RATE_WINDOW_MS = 60_000

/** Image deliveries one caller may start in a window; see "Thresholds". */
export const MEDIA_CDN_IMAGE_RATE_LIMIT = 600

/** Non-image deliveries one caller may start in a window; see "Thresholds". */
export const MEDIA_CDN_NON_IMAGE_RATE_LIMIT = 180

/**
 * How long a delivery waits for its count before it is admitted uncounted.
 *
 * The store's default is 2.5 s, sized for a password attempt that can afford
 * to wait. A video seek cannot. The count's two round trips were measured at
 * about 0.6 s end to end including the request itself (`rate-limit-store.ts`),
 * and they run beside the metadata read, so 1 s is ample for an answer and
 * short enough that a stalled store costs a player one short pause.
 */
export const MEDIA_CDN_RATE_LIMIT_BUDGET_MS = 1_000

/** Which budget a delivery spends: `mediaCdnEdgeCacheable` of what it serves. */
export type MediaCdnRateClass = 'image' | 'non-image'

/**
 * The address a caller is counted under: an IPv4 address as it is, an IPv6
 * address as its `/64`.
 *
 * `readClientIp` has already normalized the address, so an IPv6 value here is
 * lower-case hex and colons. Anything that does not expand to eight groups is
 * counted under the value as given, which can only be narrower than a `/64`.
 */
export function mediaCdnRateLimitCaller(address: string): string {
  if (!address.includes(':')) return address
  const halves = address.split('::')
  if (halves.length > 2) return address
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const elided = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (elided < 0 || (halves.length === 2 && elided === 0)) return address
  const groups = [...head, ...Array<string>(elided).fill('0'), ...tail]
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return address
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=[0-9a-f])/, ''))
    .join(':')}::/64`
}

/** The counter key for one caller's budget in one class. */
export function mediaCdnRateLimitKey(
  rateClass: MediaCdnRateClass,
  address: string,
): string {
  return `media-cdn:${rateClass}:${mediaCdnRateLimitCaller(address)}`
}

export interface MediaCdnRateLimitOptions {
  /** The request's headers, node-style or `Headers`-shaped. */
  headers: ClientIpHeaders
  /** `req.socket.remoteAddress`, which `readClientIp` consults last. */
  remoteAddress?: string | null
  rateClass: MediaCdnRateClass
  limit?: number
  windowMs?: number
  budgetMs?: number
  nowMs?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: unknown
}

export interface MediaCdnRateLimitRefusal {
  /** Whole seconds until the caller's window ends, never less than 1. */
  retryAfterSeconds: number
}

/**
 * Counts one delivery against its caller, and answers with a refusal only
 * when the durable count is past the ceiling. `null` means serve.
 *
 * Never rejects: see "Fails open" above.
 */
export async function mediaCdnRateLimitRefusal(
  options: MediaCdnRateLimitOptions,
): Promise<MediaCdnRateLimitRefusal | null> {
  try {
    const address = readClientIp(options.headers, {
      remoteAddress: options.remoteAddress,
    })
    if (!address) return null
    const nowMs = options.nowMs ?? Date.now()
    const rate = await consumeRateLimit(
      mediaCdnRateLimitKey(options.rateClass, address),
      {
        limit:
          options.limit ??
          (options.rateClass === 'image'
            ? MEDIA_CDN_IMAGE_RATE_LIMIT
            : MEDIA_CDN_NON_IMAGE_RATE_LIMIT),
        windowMs: options.windowMs ?? MEDIA_CDN_RATE_WINDOW_MS,
        budgetMs: options.budgetMs ?? MEDIA_CDN_RATE_LIMIT_BUDGET_MS,
        now: nowMs,
        firestore: options.firestore,
      },
    )
    if (rate.allowed || rate.contended || rate.degraded) return null
    return {
      retryAfterSeconds: Math.max(1, Math.ceil((rate.resetMs - nowMs) / 1000)),
    }
  } catch {
    return null
  }
}
