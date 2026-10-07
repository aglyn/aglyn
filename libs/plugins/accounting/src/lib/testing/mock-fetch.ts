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
 * A scripted `fetch` for the adapter specs (AGL-3614): each call is matched
 * against the routes in order, answered with the first that matches, and
 * recorded with its method, URL, headers and body.
 */

export interface RecordedCall {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

export interface MockRoute {
  method?: string
  match: string | RegExp
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Answer only this many times, then fall through to the next route. */
  times?: number
}

export function mockFetch(routes: MockRoute[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const used = new Map<MockRoute, number>()
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key] = value
    })
    calls.push({ method, url, headers, body: typeof init.body === 'string' ? init.body : null })
    const route = routes.find((candidate) => {
      if (candidate.method && candidate.method !== method) return false
      if (candidate.times !== undefined && (used.get(candidate) ?? 0) >= candidate.times) return false
      return typeof candidate.match === 'string' ? url.includes(candidate.match) : candidate.match.test(url)
    })
    if (!route) throw new Error(`mock-fetch: no route for ${method} ${url}`)
    used.set(route, (used.get(route) ?? 0) + 1)
    const status = route.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) },
    })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

/** A sleep that resolves at once and remembers what it was asked to wait. */
export function instantSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = []
  return { sleep: async (ms: number) => void waits.push(ms), waits }
}
