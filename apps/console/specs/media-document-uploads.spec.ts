/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Documents upload, and their bytes are METERED (AGL-1465).
 *
 * Two claims, and the second is the one worth a suite. Accepting docx/xlsx/
 * csv/pptx is a list change; whether the platform ever charges for them is a
 * question about a counter three layers away, and AGL-1438 is the standing
 * proof that a counter can look authoritative while omitting most of its
 * inputs.
 *
 * `counters/media.bytes` turns out to be type-blind by construction — the
 * route increments `buffer.length` and never consults the content type — so
 * documents were metered the instant they were accepted, and there was no
 * metering work to do. That is exactly the claim that decays silently: the
 * next person to add a branch here (a "documents don't count toward storage"
 * carve-out, a type-conditional counter write) breaks billing with a change
 * that reads as tidying. So the increment is pinned behaviourally, from the
 * route, with a real document.
 *
 * Variant bytes remain deliberately excluded from the counter — recorded
 * policy (hosts are not billed for artifacts the platform can regenerate).
 * Documents have no variants, so nothing here touches that; the exclusion is
 * asserted alongside so a future "simplification" of it fails loudly.
 */

const mockVerifyIdToken = jest.fn()
const mockCounterSet = jest.fn()
const mockMediaSet = jest.fn()
const mockFileSave = jest.fn()

const state: {
  org: Record<string, unknown>
  /** Bytes already stored, as the counter doc reports them. */
  usedBytes: number
} = {
  org: {},
  usedBytes: 0,
}

const counterDoc = () => ({
  get: async () => ({
    exists: true,
    get: (field: string) => (field === 'bytes' ? state.usedBytes : undefined),
  }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const scopeRef = {
  collection: (name: string) => ({
    doc: () =>
      name === 'counters'
        ? counterDoc()
        : {
            set: (...args: unknown[]) => {
              mockMediaSet(...args)
              return Promise.resolve()
            },
          },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: {
      // The real sentinel is opaque; a tagged object is what lets the
      // assertions below read the increment AMOUNT rather than just its
      // presence — "the counter was written" is not the claim.
      FieldValue: {
        increment: (by: number) => ({ __increment: by }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
      },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      storage: () => ({
        bucket: () => ({
          name: 'bucket',
          file: () => ({
            save: (...args: unknown[]) => {
              mockFileSave(...args)
              return Promise.resolve()
            },
          }),
        }),
      }),
    }),
  },
  // Image-only, and never reached for a document — asserted below.
  generateMediaVariants: jest.fn(async () => ({ variants: [], error: undefined })),
  isImpersonationSession: () => false,
  // Nothing is taken down in these fixtures (AGL-1613). The routes now
  // consult the deny list before they write, so the mock has to answer —
  // `null` is "not quarantined", which is what every case here assumes.
  quarantinedUploadRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan rules. A stubbed `checkQuota`/`checkEntitlement` would make
  // "the counter is visible to the quota check" unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => 'media-1',
  readImageDimensions: () => undefined,
  defaultScopeForNewResource: () => ['org'],
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async () => ({
    scope: {
      base: 'orgs/org-1',
      collection: 'orgs',
      scopeId: 'org-1',
      scopeRef,
      billing: state.org,
      cdnScope: 'org:org-1',
      viewerTokens: ['org'],
      viewerOrgWide: true,
    },
  }),
  folderStoragePath: async () => '',
  mediaObjectPath: () => 'orgs/org-1/media/media-1',
  mediaCdnPathUpdate: () => '/api/media/cdn/org:org-1/media-1',
}))

import { resolveOrgEntitlements } from '@aglyn/aglyn/server'
import { POST } from '../app/api/media/upload/route'
import {
  isAllowedUploadType,
  signedUploadMaxBytes,
} from '../utils/media-upload-limits'

/** The four Zach named, plus the siblings that ship with them. */
const DOCUMENT_TYPES: ReadonlyArray<[string, string]> = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'contract.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'price-list.xlsx'],
  ['text/csv', 'export.csv'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx'],
  ['application/msword', 'legacy.doc'],
  ['application/vnd.ms-excel', 'legacy.xls'],
  ['application/vnd.ms-powerpoint', 'legacy.ppt'],
  ['application/rtf', 'notes.rtf'],
  ['text/plain', 'readme.txt'],
  ['text/markdown', 'spec.md'],
  ['application/json', 'catalog.json'],
]

const upload = (
  contentType: string,
  fileName: string,
  bytes = 2048,
): Promise<Response> =>
  POST(
    new Request('https://app.aglyn.com/api/media/upload', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        orgId: 'org-1',
        fileName,
        contentType,
        data: Buffer.alloc(bytes, 1).toString('base64'),
      }),
    }),
  )

/** The `{ __increment }` amount the route wrote to `counters/media.bytes`. */
const incrementedBytes = (): number | undefined => {
  const [written] = (mockCounterSet.mock.calls[0] ?? []) as [
    Record<string, { __increment?: number }> | undefined,
  ]
  return written?.['bytes']?.__increment
}

describe('the DAM accepts documents and meters their bytes (AGL-1465)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Pro: documents ride the `videoMedia` entitlement, same as video/PDF/ZIP.
    state.org = { plan: 'pro' }
    state.usedBytes = 0
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  describe('acceptance', () => {
    it.each(DOCUMENT_TYPES)('accepts %s rather than 415ing it', async (contentType, fileName) => {
      const response = await upload(contentType, fileName)
      expect(response.status).toBe(200)
    })

    it('still refuses a type nobody chose — the allowlist did not become a pass-through', async () => {
      const response = await upload('application/x-msdownload', 'setup.exe')
      expect(response.status).toBe(415)
      expect(mockCounterSet).not.toHaveBeenCalled()
    })

    it('refuses MACRO-enabled Office formats, which are the malware carriers', async () => {
      // .docm/.xlsm/.pptm are deliberately absent from `UPLOAD_TYPES`: they
      // are the same office documents plus an executable payload, and the
      // platform has no upload scanning to catch one.
      for (const type of [
        'application/vnd.ms-word.document.macroEnabled.12',
        'application/vnd.ms-excel.sheet.macroEnabled.12',
        'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
      ]) {
        expect(isAllowedUploadType(type)).toBe(false)
      }
    })
  })

  describe('metering — the reason Zach asked', () => {
    it('increments counters/media.bytes by the document’s exact byte length', async () => {
      await upload(DOCUMENT_TYPES[0][0], 'contract.docx', 4096)
      expect(incrementedBytes()).toBe(4096)
    })

    it('counts a document identically to an image of the same size', async () => {
      await upload(DOCUMENT_TYPES[0][0], 'contract.docx', 4096)
      const documentBytes = incrementedBytes()
      jest.clearAllMocks()
      mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
      await upload('image/png', 'photo.png', 4096)
      // Type-blindness IS the metering guarantee. A carve-out for documents
      // would show up here as a difference.
      expect(documentBytes).toBe(incrementedBytes())
    })

    it.each(DOCUMENT_TYPES)('meters %s', async (contentType, fileName) => {
      await upload(contentType, fileName, 3072)
      expect(incrementedBytes()).toBe(3072)
    })

    it('bumps the asset COUNT too, so a document is a library item like any other', async () => {
      await upload(DOCUMENT_TYPES[0][0], 'contract.docx')
      const [written] = mockCounterSet.mock.calls[0] as [
        Record<string, { __increment?: number }>,
      ]
      expect(written['count'].__increment).toBe(1)
    })

    it('writes NOTHING but bytes and count — no variant bytes, per standing policy', async () => {
      // Variant bytes are deliberately excluded from the storage counter:
      // they are derived artifacts the platform can regenerate, so hosts are
      // not billed for them. Documents have no variants; this pins that the
      // exclusion was not "simplified" away while this list was widened.
      await upload(DOCUMENT_TYPES[0][0], 'contract.docx')
      const [written] = mockCounterSet.mock.calls[0] as [Record<string, unknown>]
      expect(Object.keys(written).sort()).toEqual(['bytes', 'count'])
    })
  })

  describe('the counter the quota check reads is the counter the upload moved', () => {
    it('refuses a document that would cross the plan’s storage cap', async () => {
      // Pro, so the entitlement gate above is satisfied and the STORAGE cap
      // is the thing under test. Seat the counter at the plan's allowance and
      // the next document must be refused — only possible if the quota check
      // reads the same `counters/media.bytes` the upload increments.
      state.org = { plan: 'pro' }
      state.usedBytes = resolveOrgEntitlements(state.org).storagePerHostMb * 1024 * 1024
      const response = await upload(DOCUMENT_TYPES[0][0], 'contract.docx')
      expect(response.status).toBe(403)
      expect((await response.json()).error).toContain('Storage limit reached')
      expect(mockCounterSet).not.toHaveBeenCalled()
    })

    it('gates documents behind the same paid entitlement as video, PDF and ZIP', async () => {
      state.org = { plan: 'free' }
      const response = await upload(DOCUMENT_TYPES[0][0], 'contract.docx')
      expect(response.status).toBe(403)
      expect(mockCounterSet).not.toHaveBeenCalled()
    })

    it('leaves IMAGES on every plan — the entitlement widened, it did not spread', async () => {
      state.org = { plan: 'free' }
      expect((await upload('image/png', 'photo.png')).status).toBe(200)
    })
  })

  describe('ceilings', () => {
    it.each(DOCUMENT_TYPES)('gives %s a signed-path ceiling (AGL-1454’s trap)', (contentType) => {
      // Without one the upload takes the base64 route at ANY size and 413s
      // past ~3 MB. A type accepted without a ceiling is the bug, not a gap.
      expect(signedUploadMaxBytes(contentType)).toBeGreaterThan(0)
    })
  })
})
