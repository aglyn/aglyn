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

/** One request the mock saw. */
export interface MockCall {
  method: string
  url: string
  headers: Record<string, string>
  body: any
}

/** One canned answer: a status and a JSON body, or a thrown network failure. */
export type MockAnswer = { status: number; body?: unknown; headers?: Record<string, string> } | 'network-error'

/**
 * A `fetch` for specs (AGL-3695): answers each request from `respond`, by
 * method and URL, and records what was sent. Sleeps resolve at once.
 */
export function createMockHttp(respond: (call: MockCall) => MockAnswer) {
  const calls: MockCall[] = []
  const http: ProviderHttp = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: MockCall = {
        method: String(init?.method ?? 'GET'),
        url: String(input),
        headers: { ...((init?.headers as Record<string, string>) ?? {}) },
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      const answer = respond(call)
      if (answer === 'network-error') throw new TypeError('fetch failed')
      return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json', ...(answer.headers ?? {}) },
      })
    }) as typeof fetch,
    sleep: async () => undefined,
  }
  return { http, calls }
}
