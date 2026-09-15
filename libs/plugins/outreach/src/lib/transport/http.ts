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

import { GmailTransportError, isRateLimitBody } from './gmail-errors'

/**
 * ONE HTTP ATTEMPT POLICY FOR EVERY GOOGLE CALL (AGL-2978).
 *
 * A send runs inside a cron invocation with a deadline, so the policy is
 * bounded on every axis: a timeout per attempt, a small number of attempts,
 * and a wait between them that is short and jittered. What it retries is
 * exactly what might succeed unchanged — a 429, a 5xx, a rate-limit 403, a
 * dropped connection — and everything else is handed straight back.
 *
 * When Google asks for longer than this policy will wait, the response is
 * returned without waiting, and the caller reports the delay as
 * `retryAfterMs` for the NEXT invocation to honor.
 */
export interface TransportDeps {
  /** The network. The real one is the global `fetch`. */
  fetch?: typeof fetch
  /** Waits between attempts. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>
  /** Jitter source, `[0, 1)`. */
  random?: () => number
  /** Clock, for token expiry. */
  now?: () => number
  /** Attempts per request, first included. Default 3. */
  maxAttempts?: number
  /** Milliseconds one attempt may take before it is abandoned. Default 20s. */
  timeoutMs?: number
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 20_000
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 8_000
/** The longest `Retry-After` this invocation will sit out. */
const MAX_HONORED_RETRY_AFTER_MS = 10_000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `Retry-After` in milliseconds — seconds or an HTTP date — or `null`. */
export function retryAfterMs(response: Response, nowMs: number = Date.now()): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null
}

/** Exponential backoff with jitter: half the step, plus up to half again. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1))
  return Math.round(step / 2 + (step / 2) * random())
}

async function shouldRetry(response: Response): Promise<boolean> {
  if (response.status === 429 || response.status >= 500) return true
  if (response.status !== 403) return false
  const body = await response.clone().json().catch(() => null)
  return isRateLimitBody(body)
}

/**
 * `fetch`, with the attempt policy above. Resolves with the last response
 * Google gave; rejects with a `network` {@link GmailTransportError} only when
 * no attempt got an answer at all.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  deps: TransportDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  const attempts = Math.max(1, Math.floor(deps.maxAttempts ?? DEFAULT_ATTEMPTS))
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = deps.now ?? Date.now

  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await doFetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      clearTimeout(timer)
      if (attempt >= attempts) {
        throw new GmailTransportError(
          'network',
          `Google could not be reached${controller.signal.aborted ? ' before the request timed out' : ''}.`,
          { providerReason: error instanceof Error ? error.name : null },
        )
      }
      await sleep(backoffDelayMs(attempt, deps.random))
      continue
    }
    clearTimeout(timer)
    if (attempt >= attempts || !(await shouldRetry(response))) return response
    const asked = retryAfterMs(response, now())
    if (asked !== null && asked > MAX_HONORED_RETRY_AFTER_MS) return response
    await sleep(asked ?? backoffDelayMs(attempt, deps.random))
  }
}
