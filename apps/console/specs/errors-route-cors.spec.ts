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

/**
 * The collector origin is configuration (AGL-2124).
 *
 * Note the shape of the suite above: `DOCS_ORIGIN` is a literal in the SPEC
 * too, so every assertion passed against a route that ignored configuration
 * entirely — the same both-directions failure `operator-identity.spec.ts`
 * documents, and the reason that module's guard is written the way it is.
 *
 * An operator running both halves of the open-source stack could not have
 * their own docs report to their own console: the browser blocked every POST
 * on CORS. Their beacon was inert; ours was the only origin the collector
 * would talk to.
 *
 * `DOCS_ORIGIN` is captured at module scope, so each shape needs a fresh
 * module registry — asserting against the already-imported handler would only
 * re-test the default.
 */
describe('the docs collector origin is configuration (AGL-2124)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_DOCS_ORIGIN

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_DOCS_ORIGIN
    else process.env.NEXT_PUBLIC_DOCS_ORIGIN = ORIGINAL
    jest.resetModules()
  })

  function loadWith(value: string | undefined) {
    if (value === undefined) delete process.env.NEXT_PUBLIC_DOCS_ORIGIN
    else process.env.NEXT_PUBLIC_DOCS_ORIGIN = value
    jest.resetModules()
    return require('../app/api/errors/route') as typeof import('../app/api/errors/route')
  }

  it('SELF-HOST shape: the operator\'s own docs origin is the one granted', () => {
    const route = loadWith('https://docs.example.com')
    const headers = route.OPTIONS().headers
    expect(headers.get('access-control-allow-origin')).toBe(
      'https://docs.example.com',
    )
    // The whole point: ours must not survive an operator's configuration.
    expect(headers.get('access-control-allow-origin')).not.toContain('aglyn')
  })

  it('tolerates a trailing slash, which a copied URL carries', () => {
    expect(
      loadWith('https://docs.example.com/').OPTIONS().headers.get(
        'access-control-allow-origin',
      ),
    ).toBe('https://docs.example.com')
  })

  it('AGLYN-OPERATED shape: unset still grants our docs site unchanged', () => {
    expect(
      loadWith(undefined).OPTIONS().headers.get('access-control-allow-origin'),
    ).toBe('https://docs.aglyn.com')
  })
})
