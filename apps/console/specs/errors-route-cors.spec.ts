/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
 *
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
 * AGL-1646 — /api/errors as the cross-origin collector for docs.aglyn.com.
 *
 * The docs site is static Docusaurus with no API of its own; its standalone
 * beacon (apps/docs/src/error-beacon.ts) posts here cross-origin. This spec
 * drives the ROUTE in-process and pins the contract that makes that work:
 * the OPTIONS preflight answer, the Access-Control-Allow-Origin on every
 * response, and the Origin-keyed service label that separates `docs-web`
 * from `console-web` in Error Reporting. The parser and reporter are
 * spec-covered in the shared lib (client-error-report.spec.ts); here they
 * are mocked so the assertions are about what the route HANDS them.
 */

const reportCalls: { events: unknown; service: string }[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  checkRateLimit: () => ({ allowed: true }),
  parseClientErrorEvents: (payload: unknown) =>
    (payload as { events?: unknown[] })?.events ?? [],
  reportClientErrors: (events: unknown, options: { service: string }) => {
    reportCalls.push({ events, service: options.service })
    return Promise.resolve(Array.isArray(events) ? events.length : 0)
  },
}))

import { OPTIONS, POST } from '../app/api/errors/route'

const DOCS_ORIGIN = 'https://docs.aglyn.com'

const event = {
  kind: 'error',
  message: 'boom',
  url: 'https://docs.aglyn.com/getting-started/create-a-site',
}

function post(origin?: string): Promise<Response> {
  return POST(
    new Request('https://app.aglyn.com/api/errors', {
      method: 'POST',
      headers: origin ? { origin } : {},
      body: JSON.stringify({ events: [event] }),
    }),
  )
}

beforeEach(() => {
  reportCalls.length = 0
})

describe('OPTIONS /api/errors (docs preflight)', () => {
  it('answers 204 with the CORS grant a preflighting docs client needs', () => {
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(DOCS_ORIGIN)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Content-Type',
    )
  })
})

describe('POST /api/errors service labelling', () => {
  it('forwards a docs-origin batch under service docs-web', async () => {
    const response = await post(DOCS_ORIGIN)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(DOCS_ORIGIN)
    expect(reportCalls).toEqual([{ events: [event], service: 'docs-web' }])
  })

  it('keeps a same-origin console batch under console-web', async () => {
    await post('https://app.aglyn.com')
    expect(reportCalls).toEqual([{ events: [event], service: 'console-web' }])
  })

  it('defaults to console-web when no Origin header arrives', async () => {
    await post()
    expect(reportCalls).toEqual([{ events: [event], service: 'console-web' }])
  })
})
