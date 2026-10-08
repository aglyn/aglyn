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

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/**
 * A mocked {@link ProviderHttp} (AGL-3694): records every request and answers
 * from a queue of `[status, body]` pairs, the last repeating. No network.
 */
export function createMockHttp(answers: Array<[number, unknown]> = [[200, {}]]) {
  const requests: RecordedRequest[] = []
  const queue = [...answers]
  const http: ProviderHttp = {
    sleep: async () => undefined,
    fetch: (async (input: unknown, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      })
      const [status, body] = queue.length > 1 ? (queue.shift() as [number, unknown]) : queue[0]
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  }
  return { http, requests }
}
