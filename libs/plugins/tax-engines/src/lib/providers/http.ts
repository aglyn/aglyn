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
 * The one way an adapter reaches a vendor: `fetch` with a deadline, JSON both
 * ways, and a refusal turned into a `TaxProviderError` that says what the
 * vendor said without ever repeating the credential that was sent.
 */

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>

/** How long one vendor call may take. A checkout holds its own, shorter deadline. */
export const TAX_PROVIDER_TIMEOUT_MS = 10_000

export class TaxProviderError extends Error {
  /** The HTTP status, or 0 for a network failure or a timeout. */
  readonly status: number
  /** The vendor's own error code, when it gave one. */
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'TaxProviderError'
    this.status = status
    this.code = code
  }

  /** A failure a retry might cure: the network, a timeout, a 429 or a 5xx. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

export interface ProviderRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface ProviderResponse {
  status: number
  body: any
}

/**
 * Sends one request. Resolves with any HTTP answer, 4xx and 5xx included —
 * the adapter reads the vendor's error shape — and throws a `TaxProviderError`
 * only for a network failure or a timeout.
 */
export async function sendProviderRequest(
  fetchImpl: ProviderFetch,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? TAX_PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...request.headers,
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: controller.signal,
    })
    const text = await response.text().catch(() => '')
    let body: any = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { message: text.slice(0, 300) }
      }
    }
    return { status: response.status, body }
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError'
    throw new TaxProviderError(
      aborted ? 'The tax service did not answer in time.' : 'The tax service could not be reached.',
      0,
      aborted ? 'timeout' : 'network',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP Basic, for AvaTax's account id and license key. */
export function basicAuthorization(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`
}
