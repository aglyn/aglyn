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
 * The one way an adapter reaches a service: `fetch` with a deadline, JSON
 * both ways, and an answer the adapter reads whatever its status. A network
 * failure or a timeout is a `PodProviderError` with status 0; the adapter
 * turns a refusal into one with the service's own sentence, never repeating
 * the token it sent.
 */

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>

/** How long one call may take. */
export const POD_PROVIDER_TIMEOUT_MS = 15_000

export class PodProviderError extends Error {
  /** The HTTP status, or 0 for a network failure or a timeout. */
  readonly status: number
  /** The service's own error code or reason, when it gave one. */
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'PodProviderError'
    this.status = status
    this.code = code
  }

  /** A failure a retry might cure: the network, a timeout, a 429 or a 5xx. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }

  /** The token was refused: the merchant has to connect again. */
  get unauthorized(): boolean {
    return this.status === 401
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

export async function sendProviderRequest(fetchImpl: ProviderFetch, request: ProviderRequest): Promise<ProviderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? POD_PROVIDER_TIMEOUT_MS)
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
    throw new PodProviderError(
      aborted ? 'The print-on-demand service did not answer in time.' : 'The print-on-demand service could not be reached.',
      0,
      aborted ? 'timeout' : 'network',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Runs `work` over `items`, at most `limit` at a time, keeping order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index])
    }
  })
  await Promise.all(lanes)
  return results
}
