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
 * The one way this plugin's adapters reach a review service (AGL-3699): JSON
 * or a form body out, JSON back, a deadline, and the service's own words
 * kept for the log — never shown to a buyer.
 */

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>

export class ReviewPlatformError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
    this.name = 'ReviewPlatformError'
  }

  /** A refusal a retry will not change: a bad credential, a rejected body. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

export interface ProviderCall {
  vendor: string
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  /** A JSON body. */
  json?: unknown
  /** A form body, `application/x-www-form-urlencoded`. */
  form?: Record<string, string>
  /** Statuses answered as a result rather than thrown, e.g. a 409 "already exists". */
  accept?: readonly number[]
  timeoutMs?: number
  fetchImpl?: ProviderFetch
}

/** Default wait for one call. */
export const PROVIDER_TIMEOUT_MS = 10_000

export async function callProvider<T = Record<string, unknown>>(call: ProviderCall): Promise<{ status: number; body: T }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? PROVIDER_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...(call.headers ?? {}) }
    let body: string | undefined
    if (call.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(call.form).toString()
    } else if (call.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(call.json)
    }
    const response = await (call.fetchImpl ?? ((url, init) => fetch(url, init)))(call.url, {
      method: call.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!response.ok && !(call.accept ?? []).includes(response.status)) {
      throw new ReviewPlatformError(call.vendor, response.status, `${call.vendor} answered ${response.status}`, parsed)
    }
    return { status: response.status, body: (parsed ?? {}) as T }
  } catch (error) {
    if (error instanceof ReviewPlatformError) throw error
    throw new ReviewPlatformError(
      call.vendor,
      0,
      controller.signal.aborted ? `${call.vendor} did not answer in time` : `${call.vendor} could not be reached`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Integer cents as the decimal number a service's JSON takes: `1234` → `12.34`. */
export function centsToAmount(cents: unknown): number {
  return Math.round(Number(cents) || 0) / 100
}
