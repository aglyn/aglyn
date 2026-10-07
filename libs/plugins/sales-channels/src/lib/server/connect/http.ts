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
 * HOW THE CHANNEL CONNECTIONS TALK TO GOOGLE AND META (AGL-3637, phase 2).
 *
 * One runtime object holds the fetch, the sleep and the clock every call
 * here uses, so a spec swaps them in one place and no request leaves the
 * process. A 429 or a 5xx is retried with backoff (honoring a short
 * `Retry-After`), as is a request that never got an answer; anything else
 * is the provider's verdict and is returned as is.
 */

export interface ConnectRuntime {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const connectRuntime: ConnectRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

/** Retries after the first attempt. */
export const CHANNEL_HTTP_RETRIES = 3
const BASE_BACKOFF_MS = 500
const MAX_RETRY_AFTER_MS = 30_000
/** Each attempt is abandoned after this long. */
const ATTEMPT_TIMEOUT_MS = 60_000

/** A provider's refusal, carrying its status and the sentence it gave. */
export class ChannelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ChannelApiError'
  }
}

const retryable = (status: number) => status === 429 || status >= 500

function retryDelay(attempt: number, response: Response | null): number {
  const header = response?.headers.get('retry-after')
  const seconds = header ? Number(header) : NaN
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  return BASE_BACKOFF_MS * 2 ** attempt
}

/** A request, retried on a throttle, a server error or no answer at all. */
export async function channelFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= CHANNEL_HTTP_RETRIES; attempt += 1) {
    let response: Response | null = null
    try {
      response = await connectRuntime.fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) })
    } catch (error) {
      lastError = error
    }
    if (response && !retryable(response.status)) return response
    if (attempt === CHANNEL_HTTP_RETRIES) {
      if (response) return response
      break
    }
    await connectRuntime.sleep(retryDelay(attempt, response))
  }
  throw new ChannelApiError(0, `The request did not reach the channel: ${String((lastError as Error)?.message ?? lastError)}`)
}

/** The provider's own sentence for a refusal: Google and Meta both answer `{ error: { message } }`. */
export async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; error_description?: unknown }
    if (typeof body.error_description === 'string') return body.error_description.slice(0, 300)
    if (typeof body.error === 'string') return body.error.slice(0, 300)
    if (typeof body.error?.message === 'string') return body.error.message.slice(0, 300)
  } catch {
    // Not JSON: the status line below.
  }
  return `HTTP ${response.status}`
}

/** A JSON answer, or a {@link ChannelApiError} with the provider's sentence. */
export async function channelJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await channelFetch(url, init)
  if (!response.ok) throw new ChannelApiError(response.status, await errorMessage(response))
  return (await response.json().catch(() => ({}))) as T
}

/** Runs `work` over `items`, at most `limit` at once, in order of start. */
export async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await work(item)
    }
  })
  await Promise.all(lanes)
}
