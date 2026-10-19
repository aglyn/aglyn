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
 * A SITE'S PHOTO LINKS (AGL-3957): the member route that mints, lists and
 * revokes them, and the public route the phone page talks to.
 *
 * The link model is the REAL one (`media-photo-links.ts`), run against an
 * in-memory Firestore, so a token here is minted, digested, parsed and
 * claimed exactly as in production. Only the edges are replaced: the ID
 * token check, the member's media scope, the rate limiter, the re-encode
 * (held by the model's own spec) and the media ingest.
 */

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'

type Data = Record<string, unknown>

/** Documents by full path, e.g. `photoLinks/abc` or `hosts/host-1/mediaFolders/f1`. */
const mockDocs = new Map<string, Data>()
const mockIngests: Array<Record<string, unknown>> = []
const mockAudits: Array<Record<string, unknown>> = []
const mockScopeCalls: unknown[] = []
let mockIngestRefusal: { status: number } | null = null
let mockDecoded: Record<string, unknown> | null = null

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() ?? '',
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

function mockDocRef(path: string): Record<string, unknown> {
  return {
    id: path.split('/').pop(),
    path,
    firestore: mockFirestore,
    get: async () => mockSnapshot(path),
    create: async (data: Data) => {
      if (mockDocs.has(path)) throw new Error(`already exists: ${path}`)
      mockDocs.set(path, { ...data })
    },
    set: async (data: Data) => {
      mockDocs.set(path, { ...data })
    },
    update: async (patch: Data) => {
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...patch })
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

function mockCollection(path: string, filters: Array<[string, string, unknown]> = []): Record<string, unknown> {
  return {
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => mockCollection(path, [...filters, [field, op, value]]),
    limit: () => mockCollection(path, filters),
    get: async () => {
      const depth = path.split('/').length + 1
      const docs = [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === depth)
        .filter((key) =>
          filters.every(([field, op, value]) => {
            const actual = mockDocs.get(key)?.[field] ?? null
            return op === '==' ? actual === value : (actual as number) > (value as number)
          }),
        )
        .map((key) => mockSnapshot(key))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  }
}

const mockFirestore: Record<string, unknown> = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async (run: (transaction: unknown) => Promise<unknown>) =>
    run({
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: (ref: { update: (patch: Data) => Promise<void> }, patch: Data) => {
        void ref.update(patch)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/media-photo-links'),
  firebaseAdmin: Object.assign(
    {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => {
            if (!mockDecoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
            return mockDecoded
          },
        }),
        firestore: () => mockFirestore,
      }),
    },
    { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
  ),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  consumeRateLimit: async () => ({ allowed: true }),
  loadSharp: async () => ({}),
  // The re-encode (orientation, EXIF/GPS stripped) is held by the model's own spec.
  storedPhotoLinkBytes: async (_sharp: unknown, bytes: Buffer, contentType: string) => ({ bytes, contentType }),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async (_firestore: unknown, entry: Record<string, unknown>) => {
    mockAudits.push(entry)
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  createResourceUid: () => `folder-${mockDocs.size}`,
  readImageDimensions: () => null,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('../utils/server/media-scope', () => ({
  __esModule: true,
  resolveMediaScope: async (...args: unknown[]) => {
    mockScopeCalls.push(args)
    return {
      scope: {
        base: 'hosts/host-1',
        collection: 'hosts',
        scopeId: 'host-1',
        scopeRef: mockDocRef('hosts/host-1'),
      },
    }
  },
}))

jest.mock('../utils/server/media-ingest', () => ({
  __esModule: true,
  ingestMedia: async (request: Record<string, unknown>) => {
    mockIngests.push(request)
    if (mockIngestRefusal) return { ok: false, status: mockIngestRefusal.status, reason: 'Storage limit reached' }
    return { ok: true, mediaId: `media-${mockIngests.length}` }
  },
}))

import { POST as members } from '../app/api/media/photo-links/route'
import { POST as publicRoute } from '../app/api/media/photo-links/public/route'

const { createPhotoLink, PHOTO_LINKS_COLLECTION, PHOTO_LINK_TTL_MS } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/media-photo-links',
)

const CONSOLE = 'https://console.example.test'
const JPEG_BASE64 = Buffer.from('a photo, as far as this spec cares').toString('base64')

const memberCall = (body: Record<string, unknown>, token: string | null = 'id-token') =>
  members(
    new Request(`${CONSOLE}/api/media/photo-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )

/** The phone page's calls: the token in the body, never in the address. */
const phoneCall = (body: Record<string, unknown>) =>
  publicRoute(
    new Request(`${CONSOLE}/api/media/photo-links/public`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
  )

const phoneGet = (token: string) => phoneCall({ action: 'open', token })

const phonePost = (token: string, body: Record<string, unknown>) => phoneCall({ action: 'store', token, ...body })

/** A live link for host-1 minted by member-1 into folder `owner`, straight through the model. */
async function mintedLink(now = Date.now()): Promise<{ linkId: string; token: string }> {
  mockDocs.set('hosts/host-1', { displayName: 'Harbor Street Bakery' })
  return createPhotoLink(mockFirestore, { hostId: 'host-1', uid: 'member-1', folderId: 'owner', now })
}

const linkDoc = (linkId: string) => mockDocs.get(`${PHOTO_LINKS_COLLECTION}/${linkId}`) as Data

beforeEach(() => {
  mockDocs.clear()
  mockIngests.length = 0
  mockAudits.length = 0
  mockScopeCalls.length = 0
  mockIngestRefusal = null
  mockDecoded = { uid: 'member-1', email_verified: true }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the member route', () => {
  it('refuses a request with no ID token', async () => {
    const response = await memberCall({ hostId: 'host-1', action: 'list' }, null)
    expect(response.status).toBe(401)
    expect(mockScopeCalls).toHaveLength(0)
  })

  it('resolves the site library with the uploads gate, never the organization library', async () => {
    await memberCall({ hostId: 'host-1', orgId: 'org-1', action: 'create' })
    const [scopeInput, , uid, options] = mockScopeCalls[0] as [Record<string, unknown>, unknown, string, Record<string, unknown>]
    expect(scopeInput).toEqual({ hostId: 'host-1' })
    expect(uid).toBe('member-1')
    expect(options).toMatchObject({ staff: false, feature: 'uploads' })
  })

  it('makes the "From the owner" folder once and answers an address on the console origin', async () => {
    const first = await (await memberCall({ hostId: 'host-1', action: 'create' })).json()
    const second = await (await memberCall({ hostId: 'host-1', action: 'create' })).json()

    const folders = [...mockDocs.entries()].filter(([path]) => path.startsWith('hosts/host-1/mediaFolders/'))
    expect(folders).toHaveLength(1)
    expect(folders[0][1]).toMatchObject({ name: 'From the owner', parentId: null })
    expect(first.folderId).toBe(folders[0][0].split('/').pop())
    expect(second.folderId).toBe(first.folderId)

    // The id in the path, the secret in the fragment the browser never sends.
    const address = new URL(first.url)
    expect(`${address.origin}${address.pathname}`).toBe(`${platformConsoleOrigin()}/p/${first.linkId}`)
    const secret = address.hash.slice(1)
    expect(secret).toMatch(/^[a-f0-9]{48}$/)
    expect(first.url).not.toBe(second.url)
    // The address is never stored: only the digest of its secret is.
    const stored = linkDoc(first.linkId)
    expect(JSON.stringify(stored)).not.toContain(secret)
    // The page composes `{linkId}.{secret}` from path and fragment, and the link opens.
    expect((await phoneGet(`${first.linkId}.${secret}`)).status).toBe(200)
    expect(stored).toMatchObject({ hostId: 'host-1', createdBy: 'member-1', folderId: first.folderId, uploads: 0 })
    expect(mockAudits).toHaveLength(0)
  })

  it("lists the site's open links and stops one on revoke", async () => {
    const { linkId } = (await (await memberCall({ hostId: 'host-1', action: 'create' })).json()) as { linkId: string }
    const listed = await (await memberCall({ hostId: 'host-1', action: 'list' })).json()
    expect(listed.links.map((link: { linkId: string }) => link.linkId)).toEqual([linkId])

    expect((await memberCall({ hostId: 'host-1', action: 'revoke', linkId })).status).toBe(200)
    expect(linkDoc(linkId)).toMatchObject({ revokedBy: 'member-1' })
    expect((await (await memberCall({ hostId: 'host-1', action: 'list' })).json()).links).toEqual([])
    expect((await memberCall({ hostId: 'host-1', action: 'revoke', linkId: 'f'.repeat(24) })).status).toBe(404)
  })

  it("writes a staff member's mint to the Audit Log", async () => {
    mockDecoded = { uid: 'staff-1', email_verified: true, staff: true }
    await memberCall({ hostId: 'host-1', action: 'create' })
    expect(mockAudits).toEqual([expect.objectContaining({ actorUid: 'staff-1', action: 'media.photo-link-created', target: 'hosts/host-1' })])
  })
})

describe('the public route the phone page talks to', () => {
  it("answers the site's name and what the link still takes, never cached", async () => {
    const { token } = await mintedLink()
    const response = await phoneGet(token)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, site: { name: 'Harbor Street Bakery' }, link: { state: 'live', remainingUploads: 40 } })
  })

  it('refuses a malformed, unknown, expired or revoked token with its own status', async () => {
    expect((await phoneGet('not-a-token')).status).toBe(404)
    expect((await phoneCall({ token: 'not-a-token' })).status).toBe(400)

    const { linkId, token } = await mintedLink()
    const wrongSecret = `${linkId}.${'0'.repeat(48)}`
    const unknown = await phoneGet(wrongSecret)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ ok: false, reason: 'invalid' })

    const old = await mintedLink(Date.now() - PHOTO_LINK_TTL_MS - 1000)
    const expired = await phoneGet(old.token)
    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({ ok: false, reason: 'expired' })

    await memberCall({ hostId: 'host-1', action: 'revoke', linkId })
    const revoked = await phoneGet(token)
    expect(revoked.status).toBe(410)
    expect(await revoked.json()).toEqual({ ok: false, reason: 'revoked' })
  })

  it('refuses a file that is not a JPEG, PNG or WebP photo before claiming a place', async () => {
    const { linkId, token } = await mintedLink()
    const response = await phonePost(token, { fileName: 'clip.gif', contentType: 'image/gif', data: JPEG_BASE64 })
    expect(response.status).toBe(415)
    expect((await response.json()).reason).toBe('type')
    expect(mockIngests).toHaveLength(0)
    expect(linkDoc(linkId)).toMatchObject({ uploads: 0, bytes: 0 })
  })

  it('claims a place, then stores the photo as the minting member in the link folder', async () => {
    const { linkId, token } = await mintedLink()
    const response = await phonePost(token, { fileName: 'porch.jpg', contentType: 'image/jpeg', data: JPEG_BASE64 })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, mediaId: 'media-1', link: { uploads: 1, remainingUploads: 39 } })

    expect(mockIngests).toEqual([
      expect.objectContaining({
        hostId: 'host-1',
        uid: 'member-1',
        fileName: 'porch.jpg',
        contentType: 'image/jpeg',
        folderId: 'owner',
        ownerPhotoLinkId: linkId,
      }),
    ])
    const sent = Buffer.from(JPEG_BASE64, 'base64').length
    expect(linkDoc(linkId)).toMatchObject({ uploads: 1, bytes: sent })
  })

  it('gives the place back when the ingest refuses, and words the refusal for the phone', async () => {
    const { linkId, token } = await mintedLink()
    mockIngestRefusal = { status: 403 }
    const response = await phonePost(token, { fileName: 'porch.jpg', contentType: 'image/jpeg', data: JPEG_BASE64 })
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, reason: 'refused' })
    expect(body.error).not.toContain('Storage limit')
    expect(mockIngests).toHaveLength(1)
    expect(linkDoc(linkId)).toMatchObject({ uploads: 0, bytes: 0 })
  })
})
