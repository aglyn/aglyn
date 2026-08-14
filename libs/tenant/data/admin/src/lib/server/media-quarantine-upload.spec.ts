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

/**
 * The INGESTION refusal (AGL-1613) — the deny list consulted before bytes
 * are accepted, not only before they are served.
 *
 * `serve-media-cdn.quarantine.spec.ts` holds the delivery half. This one
 * holds the property AGL-1512 promised and did not keep: the deny list is
 * keyed by digest so that RE-UPLOADING the same bytes stays quarantined, and
 * that is worth nothing if the upload succeeds and merely 410s afterwards.
 *
 * Four things are asserted against the REAL function and the REAL deny-list
 * read, with only Firestore mocked:
 *
 *  1. Quarantined bytes produce a refusal; clean bytes produce `null`, so the
 *     gate is a gate and not a wall.
 *  2. The refusal EXPLAINS itself. Unlike the CDN's neutral 410 this caller
 *     is the authenticated owner, so the AGL-1506 discipline applies.
 *  3. The staff `note` never reaches it. That field is a DMCA notice number
 *     or an internal rationale, and the customer is not its audience.
 *  4. Every key still matches — strong digest, legacy truncated hash, and the
 *     per-asset fallback — because an entry in force was written under
 *     whichever field existed when staff pressed the button.
 */

import {
  MEDIA_QUARANTINE_SUPPORT_EMAIL,
  MEDIA_QUARANTINE_UPLOAD_STATUS,
} from '@aglyn/aglyn/server'
import {
  invalidateMediaQuarantineCache,
  quarantinedUploadRefusal,
} from './media-quarantine'

const mockState: {
  quarantine: Record<string, unknown> | null
  reads: number
  readThrows: boolean
} = { quarantine: null, reads: 0, readThrows: false }

jest.mock('./firebase-admin', () => {
  const firestoreApi = {
    collection: (name: string) => ({
      doc: () => ({
        get: async () => {
          if (name !== 'mediaQuarantines') {
            throw new Error(`Unexpected collection ${name}`)
          }
          if (mockState.readThrows) throw new Error('UNAVAILABLE')
          mockState.reads++
          return {
            get exists() {
              return mockState.quarantine != null
            },
            get: (field: string) =>
              (mockState.quarantine as Record<string, unknown> | null)?.[field],
          }
        },
      }),
    }),
  }
  const firebaseAdmin = { app: () => ({ firestore: () => firestoreApi }) }
  return { __esModule: true, firebaseAdmin, default: firebaseAdmin }
})

const STRONG =
  'a'.repeat(64)
const LEGACY = '0123456789abcdef'

const denyList = (entries: Record<string, unknown>) => ({ entries })

const entry = (overrides: Record<string, unknown> = {}) => ({
  reason: 'dmca',
  message: null,
  // The field the customer must never see — a real one carries a notice
  // number, a complainant name, or a lawyer's assessment.
  note: 'DMCA-2026-0041, complainant Northwind Media, counsel advises hold',
  atMs: 1,
  untilMs: null,
  actorUid: 'staff-1',
  ...overrides,
})

beforeEach(() => {
  mockState.quarantine = null
  mockState.reads = 0
  mockState.readThrows = false
  invalidateMediaQuarantineCache()
})

describe('AGL-1613 · quarantined bytes are refused at ingestion', () => {
  it('returns null for bytes nobody took down — the gate is not a wall', async () => {
    mockState.quarantine = denyList({ [`hash--${LEGACY}`]: entry() })
    expect(
      await quarantinedUploadRefusal({ contentSha256: STRONG }),
    ).toBeNull()
  })

  it('refuses the re-upload of bytes that are on the deny list', async () => {
    mockState.quarantine = denyList({ [`hash--${STRONG}`]: entry() })
    const refusal = await quarantinedUploadRefusal({ contentSha256: STRONG })
    expect(refusal?.status).toBe(MEDIA_QUARANTINE_UPLOAD_STATUS)
  })

  it('matches the LEGACY truncated hash — takedowns in force keep biting', async () => {
    // AGL-1614 added the strong digest beside the old one. An entry written
    // before that must not stop biting because the document gained a better
    // field; a takedown that lifts itself is the one failure this lever
    // cannot have.
    mockState.quarantine = denyList({ [`hash--${LEGACY}`]: entry() })
    const refusal = await quarantinedUploadRefusal({
      contentSha256: STRONG,
      contentHash: LEGACY,
    })
    expect(refusal?.status).toBe(MEDIA_QUARANTINE_UPLOAD_STATUS)
  })

  it('matches the per-asset fallback key — the hashless assets are covered too', async () => {
    mockState.quarantine = denyList({
      'asset--org:acme--media-1': entry({ reason: 'malware' }),
    })
    const refusal = await quarantinedUploadRefusal({
      scopeSegment: 'org:acme',
      mediaId: 'media-1',
    })
    expect(refusal?.status).toBe(MEDIA_QUARANTINE_UPLOAD_STATUS)
  })

  it('ignores an EXPIRED entry — a lapsed takedown lets the file back in', async () => {
    mockState.quarantine = denyList({
      [`hash--${STRONG}`]: entry({ untilMs: Date.now() - 1000 }),
    })
    expect(
      await quarantinedUploadRefusal({ contentSha256: STRONG }),
    ).toBeNull()
  })

  it('fails OPEN when Firestore is unreachable — an outage is not a takedown', async () => {
    // Same posture as the CDN half and as the lockdown core. Inverting it
    // here would mean a database blip refuses every upload in the product.
    mockState.quarantine = denyList({ [`hash--${STRONG}`]: entry() })
    mockState.readThrows = true
    expect(
      await quarantinedUploadRefusal({ contentSha256: STRONG }),
    ).toBeNull()
  })

  it('costs ONE Firestore read for a burst of distinct uploads', async () => {
    // The consult moved onto an authenticated path, but it is the same
    // single TTL-cached document — a bulk drop of fifty files pays one read,
    // not fifty.
    mockState.quarantine = denyList({ [`hash--${STRONG}`]: entry() })
    await quarantinedUploadRefusal({ contentSha256: STRONG })
    await quarantinedUploadRefusal({ contentSha256: 'b'.repeat(64) })
    await quarantinedUploadRefusal({ contentSha256: 'c'.repeat(64) })
    expect(mockState.reads).toBe(1)
  })
})

describe('AGL-1613 · the refusal explains itself to the owner', () => {
  beforeEach(() => {
    mockState.quarantine = denyList({ [`hash--${STRONG}`]: entry() })
  })

  const body = async (): Promise<Record<string, unknown>> => {
    const refusal = await quarantinedUploadRefusal({ contentSha256: STRONG })
    return (await refusal?.json()) as Record<string, unknown>
  }

  it('says the file was disabled, and that it was NOT deleted', async () => {
    // A customer whose upload is refused must not conclude their data is
    // gone — for every reason in this vocabulary, it is not.
    const payload = await body()
    expect(String(payload['error'])).toContain('has not been deleted')
    expect(payload['title']).toBe('This file was disabled')
    expect(payload['quarantined']).toBe(true)
  })

  it('puts the explanation in `error`, where the upload surfaces read it', async () => {
    // Every console upload path renders `payload.error` into its snackbar. A
    // refusal whose explanation lands anywhere else is a silent failure.
    const payload = await body()
    expect(typeof payload['error']).toBe('string')
    expect(String(payload['error']).length).toBeGreaterThan(40)
  })

  it('offers the way back — the lever is reversible and must look it', async () => {
    expect((await body())['contact']).toBe(MEDIA_QUARANTINE_SUPPORT_EMAIL)
  })

  it('NEVER leaks the staff note', async () => {
    const serialized = JSON.stringify(await body())
    expect(serialized).not.toContain('DMCA-2026-0041')
    expect(serialized).not.toContain('Northwind')
    expect(serialized).not.toContain('counsel')
  })

  it('prefers the staff-typed customer message when there is one', async () => {
    mockState.quarantine = denyList({
      [`hash--${STRONG}`]: entry({ message: 'Rights cleared through 2025 only.' }),
    })
    invalidateMediaQuarantineCache()
    expect((await body())['error']).toBe('Rights cleared through 2025 only.')
  })

  it('is uncacheable — a refusal must not outlive the takedown', async () => {
    const refusal = await quarantinedUploadRefusal({ contentSha256: STRONG })
    expect(refusal?.headers.get('cache-control')).toBe('no-store')
  })
})
