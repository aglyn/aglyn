/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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
 * `/api/auth/legal-acceptance` — the read that makes the write worth having
 * (AGL-2316), driven in-process.
 *
 * The properties, each of which a plausible implementation gets wrong
 * silently:
 *
 *  1. **The version compared against is THIS DEPLOY's constant.** Not a
 *     literal, not something off the request. `LEGAL_DOCUMENT_VERSION` is
 *     imported here rather than hard-coded so the assertion survives the next
 *     publish instead of pinning `v6` forever — and a route that answered
 *     against a literal would tell every customer they are up to date the
 *     moment the constant moves past it.
 *  2. **The uid comes from the verified token and from nowhere else.** There
 *     is no `?uid=`; somebody else's acceptance record carries their IP
 *     address and user agent.
 *  3. **The verdict travels, not the evidence.** The banner needs an answer;
 *     it does not need a stranger's — or even the owner's — IP on every page
 *     load. The staff surface is where the evidence lives.
 *  4. **The POST still stamps the server's version** for the re-acceptance
 *     door, exactly as it does for the sign-up doors.
 */

import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'

let mockStatusArgs: Array<{ uid: string; options: any }> = []
let mockStatusThrows = false
let mockRecorded: Array<{ uid: string; input: any }> = []
const mockDecodedToken: Record<string, unknown> = {}

/**
 * Built in `beforeEach` rather than at module scope: babel hoists the
 * `jest.mock` factory above the ES import bindings, so a top-level constant
 * that reads `LEGAL_DOCUMENT_VERSION` evaluates before that binding exists.
 * The `mock` prefix is what lets the factory reference it at all.
 */
let mockStatus: any

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token !== 'good-token') throw new Error('bad token')
          return mockDecodedToken
        },
      }),
    }),
  },
  featureLockdownRefusal: async () => null,
  getLegalAcceptanceStatus: async (uid: string, options: any) => {
    mockStatusArgs.push({ uid, options })
    if (mockStatusThrows) throw new Error('firestore unavailable')
    return mockStatus
  },
  recordLegalAcceptance: async (uid: string, input: any) => {
    mockRecorded.push({ uid, input })
    return { recorded: true, version: input.version }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/auth/legal-acceptance/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

function get(url = 'https://app.aglyn.com/api/auth/legal-acceptance', token = 'good-token') {
  return route.GET(
    new Request(url, { headers: { authorization: `Bearer ${token}` } }),
  )
}

beforeEach(() => {
  mockStatusArgs = []
  mockRecorded = []
  mockStatusThrows = false
  Object.assign(mockDecodedToken, { uid: 'caller-uid', email_verified: false })
  mockStatus = {
    currentVersion: LEGAL_DOCUMENT_VERSION,
    accepted: false,
    acceptedVersions: ['v1'],
    latestAcceptedVersion: 'v1',
    currentVersionAcceptedAt: null,
    reacceptanceRequired: true,
    reacceptanceReason: 'version-superseded',
    arbitration: {
      firstAcceptedAt: '2026-08-01T00:00:00.000Z',
      deadline: '2026-08-31T00:00:00.000Z',
      open: true,
      daysRemaining: 12,
    },
    acceptances: [
      {
        version: 'v1',
        acceptedAt: '2026-08-01T00:00:00.000Z',
        context: 'signup-password',
        method: 'clickwrap',
        // The evidence that must NOT reach a banner payload.
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        documents: [],
      },
    ],
  }
})

describe('AGL-2316 · GET answers for the caller, against this deploy', () => {
  it('compares against the deployed constant, not a literal', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(mockStatusArgs[0].options.currentVersion).toBe(LEGAL_DOCUMENT_VERSION)
    expect(payload.currentVersion).toBe(LEGAL_DOCUMENT_VERSION)
    expect(payload.reacceptanceRequired).toBe(true)
    expect(payload.reacceptanceReason).toBe('version-superseded')
  })

  it('reads the TOKEN’s uid and ignores a uid on the query string', async () => {
    await get(
      'https://app.aglyn.com/api/auth/legal-acceptance?uid=someone-else',
    )
    expect(mockStatusArgs[0].uid).toBe('caller-uid')
    expect(mockStatusArgs[0].uid).not.toBe('someone-else')
  })

  it('carries the §18.5 verdict a surface can act on', async () => {
    const payload = await (await get()).json()
    expect(payload.arbitration).toEqual(mockStatus.arbitration)
  })

  it('does NOT ship the clickwrap evidence to every page load', async () => {
    const payload = await (await get()).json()
    // The IP and user agent are what a dispute is answered with; a banner
    // needs the verdict. Serialised and searched rather than key-checked, so
    // burying them one level deeper does not sneak past.
    expect(payload.acceptances).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('203.0.113.7')
    expect(JSON.stringify(payload)).not.toContain('Mozilla/5.0')
  })

  it('refuses without a bearer token, and with an unverifiable one', async () => {
    const anonymous = await route.GET(
      new Request('https://app.aglyn.com/api/auth/legal-acceptance'),
    )
    expect(anonymous.status).toBe(401)
    expect((await get(undefined, 'forged')).status).toBe(401)
    expect(mockStatusArgs).toHaveLength(0)
  })

  it('does not answer at all when the record could not be read', async () => {
    // A 200 with `reacceptanceRequired: false` would be a lie of the exact
    // kind this issue is about — an unread record reported as a clean one.
    mockStatusThrows = true
    const response = await get()
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBeTruthy()
  })
})

describe('AGL-2316 · the re-acceptance door writes the deploy’s version', () => {
  it('stamps LEGAL_DOCUMENT_VERSION for a console re-acceptance', async () => {
    const response = await route.POST(
      new Request('https://app.aglyn.com/api/auth/legal-acceptance', {
        method: 'POST',
        headers: {
          authorization: 'Bearer good-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: LEGAL_DOCUMENT_VERSION,
          context: 'reaccept-console',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mockRecorded[0].uid).toBe('caller-uid')
    expect(mockRecorded[0].input.version).toBe(LEGAL_DOCUMENT_VERSION)
    expect(mockRecorded[0].input.context).toBe('reaccept-console')
  })

  it('refuses a client that names a version it was not shown', async () => {
    const response = await route.POST(
      new Request('https://app.aglyn.com/api/auth/legal-acceptance', {
        method: 'POST',
        headers: {
          authorization: 'Bearer good-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ version: 'v999', context: 'reaccept-console' }),
      }),
    )
    expect(response.status).toBe(409)
    expect(mockRecorded).toHaveLength(0)
  })
})
