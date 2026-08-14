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
 * The deny list is consulted at every INGESTION chokepoint (AGL-1613).
 *
 * AGL-1512 keyed asset quarantine by content digest for one stated reason —
 * "re-uploading the same bytes stays quarantined" — and then enforced it at
 * DELIVERY only. The measured outcome was that a customer whose malicious PDF
 * had been taken down could re-upload it: it landed in their DAM, it moved
 * `counters/media`, which AGL-1473 made a billing input, and it 410'd for
 * every visitor with nothing anywhere to explain why. The security control
 * held; the product lied about it.
 *
 * `media-quarantine-upload.spec.ts` (tenant-data-admin) proves the refusal
 * itself — status, copy, `note` suppression, fail-open. This file proves the
 * part that decays: that each of the three routes actually CALLS it, and
 * calls it early enough. So these drive the REAL handlers and assert on what
 * reached Storage and Firestore.
 *
 * Three properties, in descending order of how badly they bite:
 *
 *  1. **Refused before the write.** No `file.save`, no media document, and
 *     above all no `counters/media` movement. A refused upload that still
 *     incremented the counter would bill a customer for a file the platform
 *     refuses to keep — a worse bug than the one being fixed.
 *  2. **No orphan.** The signed-upload route cannot look at the bytes until
 *     they are already in the bucket, so its refusal must DELETE the object.
 *  3. **Told, not silently dropped.** The caller here is the authenticated
 *     owner, so the AGL-1506 discipline applies: the refusal explains itself
 *     in the field the console's snackbars already render.
 */

import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'

const mockVerifyIdToken = jest.fn()
const mockFileSave = jest.fn()
const mockFileDelete = jest.fn()
const mockMediaSet = jest.fn()
const mockCounterSet = jest.fn()
const mockFileDownload = jest.fn()

/**
 * The deny list, as the routes see it through `quarantinedUploadRefusal`.
 * The REAL pure half builds the body and the status — only the Firestore
 * read is replaced, so the copy these routes emit is the copy the customer
 * gets.
 */
const mockQuarantineLib = jest.requireActual(
  '../../../libs/aglyn/src/lib/app-utils/media-quarantine',
)

const state: {
  org: Record<string, unknown>
  objectMetadata: Record<string, unknown>
  existing: Record<string, unknown>
  /** Quarantine key → entry. Empty means nothing is taken down. */
  denyList: Record<string, Record<string, unknown>>
  /** Every asset the routes asked about, in order. */
  consulted: Array<Record<string, unknown>>
} = {
  org: { plan: 'pro' },
  objectMetadata: {},
  existing: {},
  denyList: {},
  consulted: [],
}

const counterDoc = () => ({
  get: async () => ({ exists: true, get: () => 0 }),
  set: (...args: unknown[]) => {
    mockCounterSet(...args)
    return Promise.resolve()
  },
})

const mediaDoc = (): Record<string, unknown> => ({
  get: async () => ({
    exists: true,
    get: (field: string) => state.existing[field],
    data: () => state.org,
  }),
  set: (...args: unknown[]) => {
    mockMediaSet(...args)
    return Promise.resolve()
  },
  delete: async () => undefined,
  collection: () => ({ doc: () => mediaDoc() }),
})

const scopeRef = {
  collection: (name: string) => ({
    doc: () => (name === 'counters' ? counterDoc() : mediaDoc()),
  }),
}

const storageFile = () => ({
  name: 'object',
  exists: async () => [true],
  getMetadata: async () => [state.objectMetadata],
  download: async () => [mockFileDownload()],
  setMetadata: async () => undefined,
  save: (...args: unknown[]) => {
    mockFileSave(...args)
    return Promise.resolve()
  },
  delete: (...args: unknown[]) => {
    mockFileDelete(...args)
    return Promise.resolve()
  },
  getSignedUrl: async () => ['https://storage.test/put'],
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/media-variants',
  ),
  firebaseAdmin: {
    firestore: {
      FieldValue: {
        increment: (by: number) => ({ __increment: by }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        delete: () => ({ __delete: true }),
      },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({ collection: () => ({ doc: () => mediaDoc() }) }),
      storage: () => ({
        bucket: () => ({ name: 'bucket', file: storageFile }),
      }),
    }),
  },
  generateMediaVariants: jest.fn(async () => ({ variants: [], error: undefined })),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  /**
   * The REAL refusal, with only the Firestore read swapped for the test's
   * deny list. Stubbing the whole function would have made this file assert
   * that a mock was called, which is the shape of a test that keeps passing
   * after the feature is removed.
   */
  quarantinedUploadRefusal: async (asset: Record<string, unknown>) => {
    state.consulted.push(asset)
    const keys = mockQuarantineLib.mediaQuarantineKeys(asset) as string[]
    for (const key of keys) {
      const found = mockQuarantineLib.normalizeMediaQuarantine(
        state.denyList[key],
        key,
      )
      if (mockQuarantineLib.isMediaQuarantineActive(found, Date.now())) {
        return Response.json(mockQuarantineLib.mediaQuarantineRefusalBody(found), {
          status: mockQuarantineLib.MEDIA_QUARANTINE_UPLOAD_STATUS,
          headers: { 'cache-control': 'no-store' },
        })
      }
    }
    return null
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => 'media-1',
  readImageDimensions: () => undefined,
  defaultScopeForNewResource: () => ['org'],
  newResourceScopeFields: (visibleTo: string[] | null) =>
    visibleTo ? { visibleTo } : {},
  orgRoleAtLeast: () => true,
  ORG_SCOPE_TOKEN: 'org',
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
  scopeAllows: () => true,
}))

import { POST as uploadPost } from '../app/api/media/upload/route'
import { POST as replacePost } from '../app/api/media/replace/route'
import { PATCH as finalize } from '../app/api/media/upload-url/route'

/** The file staff took down. Any bytes will do — the digest is the key. */
const INFECTED = 'MZ  pretend this is the malicious PDF'
const CLEAN = 'PNG an ordinary logo'

const sha256 = (text: string) =>
  createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

/** GCS reports md5 base64; `storageContentHash` truncates its hex to 16. */
const md5Truncated = (text: string) =>
  createHash('md5').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16)

const md5Base64 = (text: string) =>
  createHash('md5').update(Buffer.from(text, 'utf8')).digest('base64')

const takenDown = (overrides: Record<string, unknown> = {}) => ({
  reason: 'malware',
  message: null,
  note: 'internal: sample 41c9, confirmed dropper',
  atMs: 1,
  untilMs: null,
  actorUid: 'staff-1',
  ...overrides,
})

const json = (body: unknown) =>
  JSON.stringify(body as Record<string, unknown>)

const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  state.org = { plan: 'pro' }
  state.existing = { contentType: 'image/png', visibleTo: ['org'] }
  state.objectMetadata = {
    contentType: 'application/pdf',
    size: INFECTED.length,
    md5Hash: md5Base64(INFECTED),
  }
  state.denyList = {}
  state.consulted = []
  mockFileDownload.mockReturnValue(Buffer.from(INFECTED, 'utf8'))
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

/** Nothing was written anywhere — the whole point of refusing BEFORE. */
function expectNoWrites() {
  expect(mockFileSave).not.toHaveBeenCalled()
  expect(mockMediaSet).not.toHaveBeenCalled()
  // The billing input. AGL-1512 argued at length that quarantine must not
  // change storage accounting; a refused upload that still bumped it would
  // have inverted that in the other direction.
  expect(mockCounterSet).not.toHaveBeenCalled()
}

describe('/api/media/upload · the same bytes cannot come back (AGL-1613)', () => {
  const upload = (text: string, contentType = 'application/pdf') =>
    uploadPost(
      new Request('https://app.aglyn.com/api/media/upload', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: json({
          orgId: 'org-1',
          fileName: 'invoice.pdf',
          contentType,
          data: Buffer.from(text, 'utf8').toString('base64'),
        }),
      }),
    )

  it('accepts an ordinary upload — the gate is not a wall', async () => {
    expect((await upload(CLEAN, 'image/png')).status).toBe(200)
    expect(mockFileSave).toHaveBeenCalled()
    expect(mockCounterSet).toHaveBeenCalled()
  })

  it('refuses a re-upload of quarantined bytes', async () => {
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    expect((await upload(INFECTED)).status).toBe(403)
  })

  it('writes NOTHING when it refuses — no object, no document, no counter', async () => {
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    await upload(INFECTED)
    expectNoWrites()
  })

  it('still refuses when only the LEGACY truncated hash was taken down', async () => {
    // Entries written before AGL-1614 are keyed on the 16-hex truncation.
    // They are live takedowns; widening the digest must not strand them.
    state.denyList = {
      [`hash--${sha256(INFECTED).slice(0, 16)}`]: takenDown({ reason: 'dmca' }),
    }
    expect((await upload(INFECTED)).status).toBe(403)
    expectNoWrites()
  })

  it('tells the owner why, in the field the DAM snackbar renders', async () => {
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    const payload = await bodyOf(await upload(INFECTED))
    expect(payload['quarantined']).toBe(true)
    expect(String(payload['error'])).toContain('has not been deleted')
  })

  it('never leaks the staff note to the uploader', async () => {
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    const serialized = JSON.stringify(await bodyOf(await upload(INFECTED)))
    expect(serialized).not.toContain('dropper')
    expect(serialized).not.toContain('41c9')
  })

  it('keys on the SANITIZED bytes, not the ones that arrived', async () => {
    // An SVG is rewritten before it is stored (AGL-1474), so the digest the
    // quarantine is checked against has to be the digest of what would
    // actually be served — otherwise the key on the deny list and the key on
    // the document describe different files.
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await upload(hostile, 'image/svg+xml')
    const asked = String(state.consulted[0]?.['contentSha256'] ?? '')
    expect(asked).not.toBe(sha256(hostile))
    expect(asked).toBe(sha256(String(mockFileSave.mock.calls[0]?.[0] ?? '')))
  })
})

describe('/api/media/replace · the second door is closed too (AGL-1613)', () => {
  const replace = (text: string) =>
    replacePost(
      new Request('https://app.aglyn.com/api/media/replace', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: json({
          orgId: 'org-1',
          mediaId: 'media-1',
          contentType: 'image/png',
          data: Buffer.from(text, 'utf8').toString('base64'),
        }),
      }),
    )

  it('replaces ordinary bytes — the gate is not a wall', async () => {
    expect((await replace(CLEAN)).status).toBe(200)
    expect(mockFileSave).toHaveBeenCalled()
  })

  it('refuses quarantined bytes swapped in under an existing cdnPath', async () => {
    // Replace deliberately keeps the stable `cdnPath`, so without this an
    // upload of anything followed by a replace would launder a takedown
    // straight back onto a URL already embedded in published pages.
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    expect((await replace(INFECTED)).status).toBe(403)
    expectNoWrites()
  })

  it('refuses when the TARGET asset is quarantined, even with clean bytes', async () => {
    // The per-asset key keeps biting at the CDN after a replace, so allowing
    // the swap would produce a "successful" replace whose result still 410s —
    // the exact confusing outcome this issue exists to end.
    state.denyList = { 'asset--org:org-1--media-1': takenDown({ reason: 'abuse' }) }
    expect((await replace(CLEAN)).status).toBe(403)
    expectNoWrites()
  })

  it('refuses when the target was taken down by its OLD content hash', async () => {
    state.existing = {
      contentType: 'image/png',
      visibleTo: ['org'],
      contentSha256: sha256(INFECTED),
    }
    state.denyList = { [`hash--${sha256(INFECTED)}`]: takenDown() }
    expect((await replace(CLEAN)).status).toBe(403)
    expectNoWrites()
  })
})

describe('/api/media/upload-url · finalize refuses and leaves no orphan (AGL-1613)', () => {
  const patch = () =>
    finalize(
      new Request('https://app.aglyn.com/api/media/upload-url', {
        method: 'PATCH',
        headers: { authorization: 'Bearer tok' },
        body: json({ orgId: 'org-1', mediaId: 'media-1', fileName: 'big.pdf' }),
      }),
    )

  it('finalizes an ordinary object — the gate is not a wall', async () => {
    expect((await patch()).status).toBe(200)
    expect(mockMediaSet).toHaveBeenCalled()
    expect(mockCounterSet).toHaveBeenCalled()
  })

  it('refuses the object when its GCS digest is on the deny list', async () => {
    state.denyList = { [`hash--${md5Truncated(INFECTED)}`]: takenDown() }
    expect((await patch()).status).toBe(403)
    expectNoWrites()
  })

  it('DELETES the orphaned object it refused', async () => {
    // The bytes reach the bucket before anything of ours can look at them —
    // that is the point of a signed upload. An object with no media document
    // is billed to nobody and readable by nobody; leaving it grows the
    // bucket forever.
    state.denyList = { [`hash--${md5Truncated(INFECTED)}`]: takenDown() }
    await patch()
    expect(mockFileDelete).toHaveBeenCalled()
  })

  it('refuses an SVG on its STRONG digest — the one branch that holds bytes', async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const clean = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    state.objectMetadata = {
      contentType: 'image/svg+xml',
      size: hostile.length,
      md5Hash: md5Base64(hostile),
    }
    mockFileDownload.mockReturnValue(Buffer.from(hostile, 'utf8'))
    // Keyed on the SANITIZED bytes, which is what finalize hashes and what
    // the bucket ends up holding.
    state.denyList = { [`hash--${sha256(clean)}`]: takenDown() }
    expect((await patch()).status).toBe(403)
    expect(mockMediaSet).not.toHaveBeenCalled()
    expect(mockCounterSet).not.toHaveBeenCalled()
  })

  it('carries NO strong digest for a plain video — the stated limit', async () => {
    // Honest coverage rather than an implied guarantee: the server never
    // holds these bytes, GCS computes md5 and crc32c, and a client-supplied
    // sha256 is a value a re-uploader can choose to miss with. So this route
    // matches on the md5-derived `contentHash` alone, and a file that
    // arrived through the direct route carries a sha256-derived one — the
    // takedown bites within an ingestion path, not across them (AGL-1614).
    state.objectMetadata = {
      contentType: 'video/mp4',
      size: 200 * 1024 * 1024,
      md5Hash: md5Base64(INFECTED),
    }
    await patch()
    expect(state.consulted[0]?.['contentSha256']).toBeUndefined()
    expect(state.consulted[0]?.['contentHash']).toBe(md5Truncated(INFECTED))
  })
})

/**
 * The inventory guard. AGL-1474 reasoned about "two chokepoints" and there
 * were four; AGL-1485 deleted the fourth. The failure both share is an
 * inventory that was remembered rather than discovered, so the routes that
 * put media bytes in the bucket are FOUND here and each is required to
 * consult the deny list. A fourth arriving fails this test rather than
 * shipping a takedown it does not honour.
 */
const REPO_ROOT = resolve(__dirname, '../../..')
const CONSOLE_API = resolve(REPO_ROOT, 'apps/console/app/api')
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.nx'])

function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...routeFiles(join(dir, entry.name)))
    } else if (entry.name === 'route.ts') {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

/**
 * An ingestion chokepoint: it mints or rewrites the bytes behind a media
 * document. `getSignedUrl` catches the route whose bytes never pass through
 * the server at all, which is precisely the one an inventory forgets.
 */
const INGESTORS = routeFiles(CONSOLE_API)
  .filter((file) => {
    const source = readFileSync(file, 'utf8')
    return (
      source.includes("collection('media')") &&
      (source.includes('file.save(') ||
        source.includes('getSignedUrl') ||
        source.includes('mediaRef.set'))
    )
  })
  .map((file) => relative(REPO_ROOT, file))
  .sort()

describe('AGL-1613 · every ingestion chokepoint consults the deny list', () => {
  it('discovers the chokepoints rather than trusting a list', () => {
    expect(INGESTORS).toEqual([
      'apps/console/app/api/media/replace/route.ts',
      'apps/console/app/api/media/upload-url/route.ts',
      'apps/console/app/api/media/upload/route.ts',
    ])
  })

  it.each(INGESTORS)('%s calls quarantinedUploadRefusal', (route) => {
    expect(readFileSync(resolve(REPO_ROOT, route), 'utf8')).toContain(
      'quarantinedUploadRefusal(',
    )
  })
})
