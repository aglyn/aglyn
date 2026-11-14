/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * `/api/edit-context` refuses a token once the console browser it names has
 * signed out (AGL-1842 follow-on). The bar redeems its stored token here on
 * every page view, so this is where "an edit token already in localStorage
 * stops working on the next page load" is decided, even when the sign-out
 * tab closed before the hint cookies could be cleared.
 *
 * The token mint/verify and the ending rule are REAL; only Firestore is
 * faked. A token past the check falls through to the host read, which this
 * fake answers "no such site" (404): reaching it is the proof the check let
 * the token through.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'edit-context-signout-spec-secret'

/** `users/{uid}/editHintEnds/{did}` → endedAt, keyed `${uid}/${did}`. */
let mockHintEnds: Record<string, number>
let mockEndReads: number

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ? data[field] : undefined),
})

function mockFirestore() {
  return {
    collection: (name: string) => ({
      withConverter: () => ({
        doc: () => ({ get: async () => snapshotOf(null) }),
      }),
      doc: (id: string) => ({
        get: async () => snapshotOf(null),
        collection: (sub: string) => ({
          doc: (key: string) => ({
            get: async () => {
              if (name !== 'users' || sub !== 'editHintEnds') {
                throw new Error(`Unexpected read ${name}/${id}/${sub}/${key}`)
              }
              mockEndReads += 1
              const endedAt = mockHintEnds[`${id}/${key}`]
              return snapshotOf(endedAt ? { endedAt } : null)
            },
          }),
        }),
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
  ),
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-access-token',
  ),
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/edit-hint-end',
  ),
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore() }) },
  hostConverter: {},
  screenConverter: {},
  isServerReleaseFlagOnForOrg: jest.fn(async () => true),
  filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => ids),
}))

import { mintEditAccessToken } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/edit-context/route'

const UID = 'uid-editor'
const BROWSER_A = 'device-browser-a-0001'
const BROWSER_B = 'device-browser-b-0002'

function contextRequest(token: string): Request {
  return new Request('https://northwind-coffee.aglyn.app/api/edit-context', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'northwind-coffee.aglyn.app',
    },
    body: JSON.stringify({ token, path: '/' }),
  })
}

const tokenFor = (did: string, since: number) =>
  mintEditAccessToken('host-1', UID, Date.now(), { did, since }).token

describe('/api/edit-context after a console sign-out (AGL-1842 follow-on)', () => {
  beforeEach(() => {
    mockHintEnds = {}
    mockEndReads = 0
  })

  it('refuses a token from a browser that signed out since, and clears the hint', async () => {
    mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 1_000 }
    const response = await POST(
      contextRequest(tokenFor(BROWSER_A, Date.now() - 60_000)),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ended: true })
    expect(
      response.headers
        .getSetCookie()
        .map((cookie) => cookie.split('=')[0])
        .sort(),
    ).toEqual(['aglyn_edit_hint', 'aglyn_editor'])
  })

  it('lets the same person’s token from ANOTHER browser through', async () => {
    mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 1_000 }
    const response = await POST(
      contextRequest(tokenFor(BROWSER_B, Date.now() - 60_000)),
    )
    expect(response.status).toBe(404)
    expect(mockEndReads).toBe(1)
  })

  it('lets a token minted after signing back in through', async () => {
    mockHintEnds = { [`${UID}/${BROWSER_A}`]: Date.now() - 60_000 }
    const response = await POST(
      contextRequest(tokenFor(BROWSER_A, Date.now() - 1_000)),
    )
    expect(response.status).toBe(404)
  })

  it('reads nothing extra for a token that names no browser', async () => {
    const unbound = mintEditAccessToken('host-1', UID).token
    const response = await POST(contextRequest(unbound))
    expect(response.status).toBe(404)
    expect(mockEndReads).toBe(0)
  })
})
