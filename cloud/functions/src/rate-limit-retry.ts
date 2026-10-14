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
 * A bounded retry for a cron POST the console answered 429.
 *
 * On 2026-10-09 at 14:00Z `consoleAiInsightsDigest` was answered
 * `{"error":"Too many requests"}` by the console's plugin-API write limiter,
 * which counted the scheduler by client address. That is fixed at the
 * limiter: the verified cron secret is no longer counted. This is the second
 * line, so the next limiter that forgets the scheduler costs a few seconds
 * rather than a day's run.
 *
 * A 429 is the one refusal that is safe to repeat. Whatever answers it has
 * declined to do the work, so nothing ran, nothing was metered into Stripe,
 * and a second POST cannot duplicate anything. Every other refusal — 401,
 * 501, 500 — still ends the run, as `postConsoleCron` explains.
 *
 * The edge's own 429 (the Security Checkpoint PAGE) is retried separately,
 * once, by `fetchPastEdgeChallenge`; this sees only the JSON 429 that comes
 * back after that.
 *
 * Pure, so `node --test` can exercise it without loading firebase-functions.
 */

/** Retries after the first 429. Three POSTs in all, then it is reported. */
export const RATE_LIMIT_MAX_RETRIES = 2

/** The wait when the answer names none. */
export const RATE_LIMIT_DEFAULT_DELAY_MS = 10_000

/**
 * The longest single wait. A limiter's window is a minute; waiting it out
 * twice must still leave a chunked sweep most of its 540-second budget.
 */
export const RATE_LIMIT_MAX_DELAY_MS = 30_000

/**
 * How long to wait before retrying, or null to stop.
 *
 * `retryAfter` is the raw `Retry-After` header. Only the delta-seconds form
 * is read; an HTTP-date, or nothing, falls back to the default.
 * `retriesSoFar` counts retries already made for this POST.
 */
export function rateLimitRetryDelayMs(
  status: number,
  retryAfter: string | null | undefined,
  retriesSoFar: number,
): number | null {
  if (status !== 429) return null
  if (retriesSoFar >= RATE_LIMIT_MAX_RETRIES) return null
  const seconds = Number(String(retryAfter ?? '').trim())
  const asked =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : RATE_LIMIT_DEFAULT_DELAY_MS
  return Math.min(Math.max(asked, 1_000), RATE_LIMIT_MAX_DELAY_MS)
}
