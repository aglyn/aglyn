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
 *
 * @jest-environment node
 */

/**
 * The publisher-profile save route's contact/link discipline (AGL-1009).
 *
 * The fields are server-owned like the handle: the rules freeze them against
 * client writes, so THIS route is the only writer — which means the https
 * check has to refuse here, not in a form a caller can skip. Three
 * properties: a hostile URL is refused before any write, a valid payload
 * lands with every field, and an explicit empty string DELETES the stored
 * field rather than leaving a link nobody can take down.
 */

const mockDeleteSentinel = Symbol('delete')
const mockTimestampSentinel = Symbol('serverTimestamp')

jest.mock('./publisher-profile', () => ({
  PUBLISHER_PROFILES: 'publisherProfiles',
  canActAsPublisher: async () => true,
  claimPublisherHandle: async () => undefined,
  PublisherHandleTakenError: class PublisherHandleTakenError extends Error {},
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const docRef = {
    get: async () => ({ get: () => 'acme' }),
    set: (data: Record<string, unknown>) => {
      const store = jest.requireMock('@aglyn/tenant-data-admin') as {
        __writes: Array<Record<string, unknown>>
      }
      store.__writes.push(data)
      return Promise.resolve()
    },
  }
  return {
    __writes: [] as Array<Record<string, unknown>>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1' }) }),
        firestore: () => ({
          collection: () => ({ doc: () => docRef }),
        }),
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => mockTimestampSentinel,
          delete: () => mockDeleteSentinel,
        },
      },
    },
  }
})

import { publisherProfileSaveHandler } from './publisher-profile-save'

const writes = () =>
  (jest.requireMock('@aglyn/tenant-data-admin') as {
    __writes: Array<Record<string, unknown>>
  }).__writes

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const baseBody = {
  orgId: 'acme',
  handle: 'acme',
  displayName: 'Acme',
}

function makeReq(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { ...baseBody, ...body },
  } as any
}

describe('publisherProfileSaveHandler contact/link fields (AGL-1009)', () => {
  beforeEach(() => {
    writes().length = 0
  })

  it('refuses a javascript: avatar and an http website before any write', async () => {
    for (const body of [
      { avatarUrl: 'javascript:alert(1)' },
      { website: 'http://example.com' },
      { githubUrl: 'https://evil.example.com/' },
    ]) {
      const res = makeRes()
      await publisherProfileSaveHandler(makeReq(body), res)
      expect(res.statusCode).toBe(400)
    }
    expect(writes()).toHaveLength(0)
  })

  it('writes every valid field through one merge', async () => {
    const res = makeRes()
    await publisherProfileSaveHandler(
      makeReq({
        avatarUrl: 'https://cdn.example.com/logo.png',
        website: 'https://example.com',
        supportEmail: 'help@example.com',
        supportUrl: 'https://example.com/support',
        githubUrl: 'https://github.com/acme',
        xUrl: 'https://x.com/acme',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toMatchObject({
      handle: 'acme',
      displayName: 'Acme',
      avatarUrl: 'https://cdn.example.com/logo.png',
      website: 'https://example.com',
      supportEmail: 'help@example.com',
      supportUrl: 'https://example.com/support',
      githubUrl: 'https://github.com/acme',
      xUrl: 'https://x.com/acme',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
    })
  })

  it('deletes a field the caller explicitly clears, and skips absent ones', async () => {
    const res = makeRes()
    await publisherProfileSaveHandler(makeReq({ website: '' }), res)
    expect(res.statusCode).toBe(200)
    const write = writes()[0]
    expect(write['website']).toBe(mockDeleteSentinel)
    // Absent fields are untouched — a save from a stale form must not wipe
    // the links it never rendered.
    expect('githubUrl' in write).toBe(false)
  })
})
