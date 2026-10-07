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
 * The one way this plugin's adapters reach a vendor (AGL-3635): JSON both
 * ways, a deadline, and the vendor's own words kept for the log — never
 * thrown at a buyer.
 */

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>

export class PostPurchaseProviderError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
    this.name = 'PostPurchaseProviderError'
  }

  /** A refusal a retry will not change: a bad credential, a rejected body. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

export interface ProviderCall {
  vendor: string
  url: string
  method: 'GET' | 'POST' | 'PUT'
  headers: Record<string, string>
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: ProviderFetch
}

/** Default wait for one vendor call. */
export const PROVIDER_TIMEOUT_MS = 10_000

export async function callProvider<T = Record<string, unknown>>(call: ProviderCall): Promise<{ status: number; body: T }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? PROVIDER_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  call.signal?.addEventListener('abort', onAbort)
  try {
    const response = await (call.fetchImpl ?? ((url, init) => fetch(url, init)))(call.url, {
      method: call.method,
      headers: {
        Accept: 'application/json',
        ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...call.headers,
      },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      signal: controller.signal,
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!response.ok) {
      throw new PostPurchaseProviderError(call.vendor, response.status, `${call.vendor} answered ${response.status}`, body)
    }
    return { status: response.status, body: (body ?? {}) as T }
  } catch (error) {
    if (error instanceof PostPurchaseProviderError) throw error
    throw new PostPurchaseProviderError(
      call.vendor,
      0,
      controller.signal.aborted ? `${call.vendor} did not answer in time` : `${call.vendor} could not be reached`,
    )
  } finally {
    clearTimeout(timer)
    call.signal?.removeEventListener('abort', onAbort)
  }
}

/** Integer cents as the decimal string a vendor's JSON takes: `1234` → `"12.34"`. */
export function centsToDecimal(cents: number): string {
  const whole = Math.round(Number(cents) || 0)
  const sign = whole < 0 ? '-' : ''
  const abs = Math.abs(whole)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * A vendor's decimal amount as integer cents, or `null` when it is not a
 * finite, non-negative number of at most two places — never rounded into
 * something it did not say.
 */
export function decimalToCents(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (!text) return null
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    // A float like 1.9800000000000002 from a JSON number.
    const parsed = Number(text)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    const cents = Math.round(parsed * 100)
    return Math.abs(cents - parsed * 100) < 1e-6 ? cents : null
  }
  const [units, fraction = ''] = text.split('.')
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'))
}
