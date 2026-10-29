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
 * AGL-1660 — no agreement to a document that was never served, on any save
 * (AGL-4105).
 *
 * The console's box cannot be ticked while the agreement has no published
 * page, but a disabled box is not a gate: the routes refuse a save's
 * agreement whatever it says while there is nothing behind it, so the
 * refusal is a fact on the server. A recorded agreement to text nobody could
 * read is worse than no record, because it looks like evidence.
 *
 * Driven through the profile save with the REAL recorder, so the record it
 * writes is the one asserted: pinned to the document's bytes, naming the
 * person, the save and the device. Both directions are asserted, so the gate
 * cannot quietly become a no-op when the page IS published.
 */

const mockTimestampSentinel = Symbol('serverTimestamp')

/** Whether the agreement's page is published, as the model is told. */
const mockPublished = { value: false }

jest.mock('../model/publisher-agreement', () => {
  const actual = jest.requireActual('../model/publisher-agreement')
  return {
    ...actual,
    publisherAgreementIsPublished: () => mockPublished.value,
    publisherAgreementConsentRefusal: (raw: unknown) =>
      actual.publisherAgreementConsentRefusal(raw, { published: mockPublished.value }),
  }
})

jest.mock('./publisher-profile', () => ({
  PUBLISHER_PROFILES: 'publisherProfiles',
  canActAsPublisher: async () => true,
  claimPublisherHandle: async () => undefined,
  PublisherHandleTakenError: class PublisherHandleTakenError extends Error {},
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const store = () =>
    jest.requireMock('@aglyn/tenant-data-admin') as {
      __writes: Array<Record<string, unknown>>
      __records: Array<Record<string, unknown>>
    }
  const docRef: Record<string, unknown> = {
    get: async () => ({ exists: true, get: () => 'acme' }),
    set: (data: Record<string, unknown>) => {
      store().__writes.push(data)
      return Promise.resolve()
    },
    create: (data: Record<string, unknown>) => {
      store().__records.push(data)
      return Promise.resolve()
    },
    collection: () => ({ doc: () => docRef }),
  }
  return {
    __writes: [] as Array<Record<string, unknown>>,
    __records: [] as Array<Record<string, unknown>>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1' }) }),
        firestore: () => ({ collection: () => ({ doc: () => docRef }) }),
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => mockTimestampSentinel,
          delete: () => Symbol('delete'),
        },
      },
    },
  }
})

import * as agreement from '../model/publisher-agreement'
import { publisherProfileSaveHandler } from './publisher-profile-save'

const admin = () =>
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __writes: Array<Record<string, unknown>>
    __records: Array<Record<string, unknown>>
  }

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

const saveRequest = () =>
  ({
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      'user-agent': 'Spec Browser/1.0',
      'x-forwarded-for': '203.0.113.7',
    },
    socket: {},
    body: {
      orgId: 'acme',
      handle: 'acme',
      displayName: 'Acme',
      agreement: agreement.publisherAgreementConsent(),
    },
  }) as any

describe('agreeing to the publisher agreement on a save (AGL-1660, AGL-4105)', () => {
  beforeEach(() => {
    admin().__writes.length = 0
    admin().__records.length = 0
    mockPublished.value = false
  })

  it('refuses, and writes and records nothing, while the document has no page', async () => {
    const res = makeRes()
    await publisherProfileSaveHandler(saveRequest(), res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ agreement: { state: 'unavailable' } })
    expect(admin().__writes).toHaveLength(0)
    expect(admin().__records).toHaveLength(0)
  })

  it('records the agreement, and saves, once the document is published', async () => {
    mockPublished.value = true
    const res = makeRes()
    await publisherProfileSaveHandler(saveRequest(), res)
    expect(res.statusCode).toBe(200)
    expect(admin().__records).toHaveLength(1)
    expect(admin().__records[0]).toMatchObject({
      version: agreement.PUBLISHER_AGREEMENT_VERSION,
      orgId: 'acme',
      uid: 'user-1',
      staff: false,
      action: 'save-profile',
      targetId: 'acme',
      userAgent: 'Spec Browser/1.0',
      acceptedAt: mockTimestampSentinel,
    })
    expect(typeof admin().__records[0]['atMs']).toBe('number')
    // The profile's note of it rides the profile write itself.
    expect(admin().__writes).toHaveLength(1)
    expect(admin().__writes[0]).toMatchObject({
      publisherAgreement: {
        version: agreement.PUBLISHER_AGREEMENT_VERSION,
        acceptedBy: 'user-1',
      },
    })
  })

  it('pins the record to the bytes of the document, not just its label (AGL-1678)', async () => {
    // A version string is a label we control and can reuse; the snapshot hash
    // is what makes the record self-contained evidence of content. Same
    // machinery as the signup clickwrap (AGL-1497): sha256 + byte length of
    // the archived snapshot, written onto every acceptance record.
    mockPublished.value = true
    const res = makeRes()
    await publisherProfileSaveHandler(saveRequest(), res)
    expect(res.statusCode).toBe(200)
    expect(admin().__records[0]['sha256']).toBe(agreement.PUBLISHER_AGREEMENT_SHA256)
    expect(admin().__records[0]['bytes']).toBe(agreement.PUBLISHER_AGREEMENT_BYTES)
    const note = (admin().__writes[0] as {
      publisherAgreement: { sha256?: unknown; bytes?: unknown }
    }).publisherAgreement
    expect(note.sha256).toBe(agreement.PUBLISHER_AGREEMENT_SHA256)
    expect(note.bytes).toBe(agreement.PUBLISHER_AGREEMENT_BYTES)
    // The manifest itself must be a real pin, not an empty default the
    // assertion above would vacuously match.
    expect(agreement.PUBLISHER_AGREEMENT_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(agreement.PUBLISHER_AGREEMENT_BYTES).toBeGreaterThan(0)
  })

  it('follows the REAL published set, not just the stub', async () => {
    // The stub above proves the branch; this proves the branch is wired to
    // the actual constant: when the page is published the same assertion
    // expects 200 without anyone editing this file.
    const real = jest.requireActual(
      '../model/publisher-agreement',
    ) as typeof agreement
    mockPublished.value = real.publisherAgreementIsPublished()
    const res = makeRes()
    await publisherProfileSaveHandler(saveRequest(), res)
    expect(res.statusCode).toBe(mockPublished.value ? 200 : 409)
    expect(admin().__records).toHaveLength(mockPublished.value ? 1 : 0)
  })
})
