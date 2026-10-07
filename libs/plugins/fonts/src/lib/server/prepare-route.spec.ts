/**
 * @jest-environment ./jest-environment-node-shared.cjs
 */
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONT_UPLOAD_MAX_BYTES, type PrepareFontResponse } from '../installer/constants'
import { prepareFontRoute } from './prepare-route'

const mockAuth: {
  token: Record<string, unknown> | null
  host: Record<string, unknown> | null
  outage?: boolean
} = {
  token: null,
  host: null,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => {
          if (mockAuth.outage) throw new Error('verifier unreachable')
          if (!mockAuth.token) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
          return mockAuth.token
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockAuth.host !== null,
              get: (field: string) => mockAuth.host?.[field],
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (token: Record<string, unknown>) => token['email_verified'] === true,
  isImpersonationSession: () => false,
}))

const INTER = readFileSync(join(__dirname, '../font-file/__fixtures__/inter-regular-latin-sample.ttf'))

const post = (body: Uint8Array, query = '?hostId=h1', headers: Record<string, string> = {}) =>
  prepareFontRoute(
    new Request(`https://console.test/api/fonts/prepare${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/octet-stream', ...headers },
      body: body as unknown as BodyInit,
    }),
  )

beforeEach(() => {
  mockAuth.token = { uid: 'u1', email_verified: true }
  mockAuth.host = { memberRoles: { u1: 'editor' } }
})

describe('POST /api/fonts/prepare (AGL-3656)', () => {
  it('answers a site editor with the facts and the WOFF2', async () => {
    const response = await post(INTER)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as PrepareFontResponse
    expect(body.face).toMatchObject({ family: 'Inter', weight: 400, style: 'normal', scripts: ['latin'] })
    expect(Buffer.from(body.woff2, 'base64').subarray(0, 4).toString('ascii')).toBe('wOF2')
  })

  it('refuses a caller without a valid token, or with an unverified address', async () => {
    mockAuth.token = null
    expect((await post(INTER)).status).toBe(401)
    mockAuth.token = { uid: 'u1', email_verified: false }
    expect((await post(INTER)).status).toBe(403)
  })

  it('answers 500, not 401, when the token could not be checked at all', async () => {
    mockAuth.outage = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect((await post(INTER)).status).toBe(500)
    } finally {
      mockAuth.outage = false
    }
  })

  it('refuses anyone but a site admin or editor, and lets staff through', async () => {
    mockAuth.host = { memberRoles: { u1: 'author' } }
    expect((await post(INTER)).status).toBe(403)
    mockAuth.token = { uid: 'staff1', email_verified: true, staff: true }
    expect((await post(INTER)).status).toBe(200)
  })

  it('needs a site that exists', async () => {
    expect((await post(INTER, '')).status).toBe(400)
    mockAuth.host = null
    expect((await post(INTER)).status).toBe(404)
  })

  it('refuses an oversized body before reading it', async () => {
    const response = await post(INTER, '?hostId=h1', { 'content-length': String(FONT_UPLOAD_MAX_BYTES + 1) })
    expect(response.status).toBe(413)
  })

  it('answers a restricted license with the reason', async () => {
    const restricted = new Uint8Array(INTER)
    const view = new DataView(restricted.buffer, restricted.byteOffset, restricted.byteLength)
    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16
      if (String.fromCharCode(...restricted.slice(at, at + 4)) === 'OS/2') view.setUint16(view.getUint32(at + 8) + 8, 2)
    }
    const response = await post(restricted)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'license-restricted', error: expect.stringMatching(/not embeddable/) })
  })
})
