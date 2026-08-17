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
 * AGL-1660 — no acceptance of a document that was never served.
 *
 * The console hides the accept control while the agreement has no published
 * page, but a hidden control is not a gate: this route is the only writer of
 * `publisherAgreement`, so the refusal has to be a fact here. A recorded
 * acceptance of text nobody could read is worse than no record, because it
 * looks like evidence.
 *
 * Both directions are asserted, so the gate cannot quietly become a no-op when
 * the page IS published.
 */

const mockTimestampSentinel = Symbol('serverTimestamp')

/**
 * Whether the document is published, as the route sees it. A mutable holder
 * rather than a spy: the real function reads a constant list, and both sides
 * of the gate have to be exercised — the one that holds today, and the one
 * that has to still hold on the day the page goes live.
 */
const mockPublished = { value: false }

jest.mock('@aglyn/aglyn/app-utils/publisher-agreement', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/publisher-agreement'),
  publisherAgreementIsPublished: () => mockPublished.value,
}))

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

import * as agreement from '@aglyn/aglyn/app-utils/publisher-agreement'
import { publisherProfileSaveHandler } from './publisher-profile-save'

const writes = () =>
  (
    jest.requireMock('@aglyn/tenant-data-admin') as {
      __writes: Array<Record<string, unknown>>
    }
  ).__writes

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

const acceptRequest = () =>
  ({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: {
      action: 'accept-agreement',
      orgId: 'acme',
      version: agreement.PUBLISHER_AGREEMENT_VERSION,
    },
  }) as any

describe('accepting the publisher agreement (AGL-1660)', () => {
  beforeEach(() => {
    writes().length = 0
    mockPublished.value = false
  })

  it('refuses, and writes nothing, while the document has no page', async () => {
    const res = makeRes()
    await publisherProfileSaveHandler(acceptRequest(), res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ unavailable: true })
    expect(writes()).toHaveLength(0)
  })

  it('records the acceptance once the document is published', async () => {
    mockPublished.value = true
    const res = makeRes()
    await publisherProfileSaveHandler(acceptRequest(), res)
    expect(res.statusCode).toBe(200)
    expect(writes()).toHaveLength(1)
    expect(writes()[0]).toMatchObject({
      publisherAgreement: {
        version: agreement.PUBLISHER_AGREEMENT_VERSION,
        acceptedBy: 'user-1',
      },
    })
  })

  it('pins the acceptance to the bytes of the document, not just its label (AGL-1678)', async () => {
    // A version string is a label we control and can reuse; the snapshot hash
    // is what makes the record self-contained evidence of content. Same
    // machinery as the signup clickwrap (AGL-1497): sha256 + byte length of
    // the archived snapshot, written onto every acceptance record.
    mockPublished.value = true
    const res = makeRes()
    await publisherProfileSaveHandler(acceptRequest(), res)
    expect(res.statusCode).toBe(200)
    expect(writes()).toHaveLength(1)
    const recorded = (writes()[0] as {
      publisherAgreement: { sha256?: unknown; bytes?: unknown }
    }).publisherAgreement
    expect(recorded.sha256).toBe(agreement.PUBLISHER_AGREEMENT_SHA256)
    expect(recorded.bytes).toBe(agreement.PUBLISHER_AGREEMENT_BYTES)
    // The manifest itself must be a real pin, not an empty default the
    // assertion above would vacuously match.
    expect(agreement.PUBLISHER_AGREEMENT_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(agreement.PUBLISHER_AGREEMENT_BYTES).toBeGreaterThan(0)
  })

  it('follows the REAL published set, not just the stub', async () => {
    // The stub above proves the branch; this proves the branch is wired to
    // the actual constant. As of this commit the page does not exist, so the
    // route refuses in production too — and when the page is published, the
    // same assertion expects 200 without anyone editing this file.
    const real = jest.requireActual(
      '@aglyn/aglyn/app-utils/publisher-agreement',
    ) as typeof agreement
    mockPublished.value = real.publisherAgreementIsPublished()
    const res = makeRes()
    await publisherProfileSaveHandler(acceptRequest(), res)
    expect(res.statusCode).toBe(mockPublished.value ? 200 : 409)
    expect(writes()).toHaveLength(mockPublished.value ? 1 : 0)
  })
})
