/**
 * @jest-environment node
 *
 * The docblock has to be the FIRST comment in the file: placed after the
 * license it is silently ignored and this runs on jsdom, where the route's
 * `Response` helpers are unavailable.
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
 * The console's `/api/health` can go red (AGL-2592).
 *
 * This is the door every external monitor and the GitHub probe read first,
 * and until this file existed nothing in the tree asserted it could answer
 * anything but 200. Its one check is a Firestore read of a document that is
 * meant to be missing: a missing document proves credentials, network and the
 * API all work, and a thrown read is the outage the door exists to report.
 *
 * The imaging probe is reported BESIDE the body, not inside `checks`, and the
 * route says why: an encoder that cannot make a WebP is a degraded
 * optimization, not an outage, and paging on it would teach everyone to
 * ignore the endpoint. That placement is pinned here from both sides — it is
 * present, and it cannot move the status code.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a fifteen-second TTL, so a shared module
 * would serve every test the first test's answer.
 */

// No static imports — with none this file would be a global script in the one
// program `tsc` builds over `apps/console`, so the export keeps it a module.
export {}

/** What the stubbed Firestore read should do: resolve, or throw this code. */
let mockRead: 'resolves' | { code: string }
/** Every `collection/doc` the route asked for, so the probe is measurable. */
let mockReads: string[]
/** What the stubbed image-variant probe answers with. */
let mockImaging: { ok: boolean; code?: string }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => {
              mockReads.push(`${name}/${id}`)
              if (mockRead !== 'resolves') {
                throw Object.assign(new Error('firestore is having a day'), {
                  code: mockRead.code,
                })
              }
              return { exists: false }
            },
          }),
        }),
      }),
    }),
  },
  probeMediaVariantSupport: async () => mockImaging,
}))

type RouteModule = typeof import('../app/api/health/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/route')
}

/** Drive GET and read back what a monitor and an operator each see. */
async function probe(route?: RouteModule): Promise<{
  status: number
  text: string
  body: Record<string, unknown>
  firestore: Record<string, unknown>
  cacheControl: string | null
}> {
  const { GET } = route ?? (await freshRoute())
  const response = await GET()
  const text = await response.text()
  const body = JSON.parse(text) as Record<string, unknown>
  const checks = body['checks'] as Record<string, Record<string, unknown>>
  return {
    status: response.status,
    text,
    body,
    firestore: checks['firestore'],
    cacheControl: response.headers.get('cache-control'),
  }
}

/** The literal the UptimeRobot keyword monitor looks for, byte for byte. */
const KEYWORD = '"status":"ok"'

beforeEach(() => {
  mockRead = 'resolves'
  mockReads = []
  mockImaging = { ok: true }
})

describe('Firestore answers the probe read', () => {
  it('answers 200 and carries the monitor keyword exactly once', async () => {
    const seen = await probe()
    expect(seen.status).toBe(200)
    expect(seen.body['status']).toBe('ok')
    expect(seen.body['service']).toBe('console')
    expect(seen.firestore['ok']).toBe(true)
    // Once: a nested check must never spell the top-level verdict, or a
    // degraded body would still satisfy a substring monitor.
    expect(seen.text.split(KEYWORD).length - 1).toBe(1)
  })

  it('reads a document that is meant to be missing, and nothing else', async () => {
    await probe()
    expect(mockReads).toEqual(['orgSlugs/console-health-probe-does-not-exist'])
  })

  it('memoizes the read, so a public endpoint cannot be turned into a bill', async () => {
    const route = await freshRoute()
    await probe(route)
    await probe(route)
    expect(mockReads).toHaveLength(1)
  })

  it('reports the imaging probe beside the body without letting it move the status', async () => {
    mockImaging = { ok: false, code: 'encoder-unavailable' }
    const seen = await probe()
    expect(seen.status).toBe(200)
    expect(seen.body['status']).toBe('ok')
    expect(seen.body['imaging']).toMatchObject({ ok: false, code: 'encoder-unavailable' })
    expect(seen.body['checks']).not.toHaveProperty('imaging')
  })
})

describe('Firestore refuses the probe read', () => {
  it('goes 503, drops the keyword, and carries the code but never the message', async () => {
    mockRead = { code: 'unavailable' }
    const seen = await probe()
    expect(seen.status).toBe(503)
    expect(seen.body['status']).toBe('degraded')
    expect(seen.firestore).toMatchObject({ ok: false, code: 'unavailable' })
    expect(seen.text).not.toContain(KEYWORD)
    expect(seen.text).not.toContain('having a day')
  })

  it('is uncacheable on the failure response too, which is the one that matters', async () => {
    mockRead = { code: 'unavailable' }
    const seen = await probe()
    expect(seen.cacheControl ?? '').toMatch(/no-store/)
  })

  it('answers HEAD with the same 503, so a HEAD monitor is not told calm', async () => {
    mockRead = { code: 'permission-denied' }
    const { HEAD } = await freshRoute()
    const response = await HEAD()
    expect(response.status).toBe(503)
  })
})
