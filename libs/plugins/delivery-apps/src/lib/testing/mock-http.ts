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

import type { ProviderHttp } from '../providers/http'

/**
 * A scripted `fetch` for this plugin's specs (AGL-3644, after AGL-3638's):
 * each call is matched against the routes in order, answered with the first
 * that matches, and recorded with its method, URL, headers and body. A spec
 * that reaches an unscripted address fails, so no call goes unchecked.
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
  /** Answers from the call itself, in place of `status` and `body`. */
  respond?: (call: RecordedCall) => { status?: number; body?: unknown }
}

export function mockHttp(routes: MockRoute[]): { http: ProviderHttp; calls: RecordedCall[]; waits: number[] } {
  const calls: RecordedCall[] = []
  const waits: number[] = []
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
    if (!route) throw new Error(`mock-http: no route for ${method} ${url}`)
    used.set(route, (used.get(route) ?? 0) + 1)
    const answer = route.respond ? route.respond(calls[calls.length - 1]) : { status: route.status, body: route.body }
    const status = answer.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) },
    })
  }) as typeof fetch
  return { http: { fetch: fetchImpl, sleep: async (ms) => void waits.push(ms) }, calls, waits }
}

/** The JSON body a recorded call sent. */
export const sentJson = (call: RecordedCall | undefined): any => (call?.body ? JSON.parse(call.body) : null)
