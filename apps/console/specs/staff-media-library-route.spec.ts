/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * The staff media library card's two routes: a page of a library, and one
 * asset opened. Read-only, staff only, paged on the query, private bytes
 * through a staff-minted signature, and every read recorded in the staff
 * audit log as an access before it is served.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let calls: Array<[string, ...unknown[]]> = []
let claims: Record<string, unknown> = {}
let parentExists = true
let auditFails = false
const audits: Array<Record<string, unknown>> = []

const MEDIA: Record<string, Record<string, unknown>> = {
  pub: {
    fileName: 'hero.png',
    contentType: 'image/png',
    sizeBytes: 2048,
    createdAt: { toDate: () => new Date(2_000) },
    cdnPath: '/api/media/cdn/org:o1/pub',
    url: 'https://firebasestorage.googleapis.com/v0/b/x/o/orgs%2Fo1%2Fmedia%2Fpub?alt=media&token=PUBLIC',
    storagePath: 'orgs/o1/media/pub',
    uploadedBy: 'u-owner',
  },
  priv: {
    fileName: 'contract.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 4096,
    createdAt: { toDate: () => new Date(1_000) },
    private: true,
    url: 'https://firebasestorage.googleapis.com/v0/b/x/o/orgs%2Fo1%2Fmedia%2Fpriv?alt=media&token=SECRET',
    storagePath: 'orgs/o1/media/priv',
    visibleTo: ['host:h1'],
    uploadedBy: 'u-owner',
  },
}

const snap = (id: string, data: Record<string, unknown> | undefined, path: string) => ({
  id,
  exists: data !== undefined,
  ref: { id, path },
  data: () => data,
  get: (key: string) => data?.[key],
})

function mediaQuery(): any {
  return {
    orderBy: (path: string, direction: string) => (calls.push(['orderBy', path, direction]), mediaQuery()),
    startAfter: (after: { id: string }) => (calls.push(['startAfter', after.id]), mediaQuery()),
    limit: (count: number) => (calls.push(['limit', count]), mediaQuery()),
    get: async () => ({
      docs: Object.entries(MEDIA).map(([id, data]) => snap(id, data, `orgs/o1/media/${id}`)),
    }),
  }
}

function parentRef(path: string): any {
  return {
    path,
    id: path.split('/')[1],
    get: async () => snap(path.split('/')[1], parentExists ? { displayName: 'Acme' } : undefined, path),
    collection: () => ({
      ...mediaQuery(),
      doc: (id: string) => ({
        id,
        path: `${path}/media/${id}`,
        get: async () => snap(id, MEDIA[id], `${path}/media/${id}`),
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => (global as any).__claims() }),
      firestore: () => ({
        doc: (path: string) => (global as any).__parent(path),
        getAll: async (...refs: Array<{ get: () => Promise<unknown> }>) =>
          Promise.all(refs.map((ref) => ref.get())),
        collection: () => ({
          where: () => ({ limit: () => ({ get: async () => ({ size: 0, docs: [] }) }) }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  mintMediaSignature: (scope: string, mediaId: string, now: number, _ttl: unknown, aud: string) => ({
    exp: now + 900_000,
    sig: `sig(${scope}/${mediaId})`,
    aud,
  }),
  mediaSignatureQuery: (signature: { exp: number; sig: string; aud?: string }) =>
    `exp=${signature.exp}&sig=${signature.sig}&aud=${signature.aud}`,
  mediaStoragePathInScope: ({ storagePath, base, mediaId }: { storagePath: unknown; base: string; mediaId: string }) =>
    typeof storagePath === 'string' && storagePath.startsWith(`${base}/media/`) ? storagePath : `${base}/media/${mediaId}`,
  resolveUidsToPeople: async (uids: string[]) =>
    Object.fromEntries(uids.filter(Boolean).map((uid) => [uid, { uid, email: `${uid}@example.com`, displayName: null }])),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({
  __esModule: true,
  recordAdminAudit: async (entry: Record<string, unknown>) => {
    if ((global as any).__auditFails()) throw new Error('audit down')
    ;(global as any).__audits.push(entry)
  },
}))

jest.mock('../utils/server/scan-media-references', () => ({
  __esModule: true,
  HOSTS_PER_SCAN: 25,
  scanMediaReferences: async () => ({
    references: [{ kind: 'screen', id: 's1', name: 'Home', hostId: 'h1', hostSubdomain: 'acme', live: true }],
    complete: true,
    coverage: 'full',
  }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/server') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))
;(global as any).__claims = () => claims
;(global as any).__parent = (path: string) => parentRef(path)
;(global as any).__audits = audits
;(global as any).__auditFails = () => auditFails

import { GET as listGET } from '../app/api/admin/media-library/route'
import { GET as assetGET } from '../app/api/admin/media-library/asset/route'
import { adminAuditKind } from '@aglyn/aglyn/app-utils/admin-audit-index'
import { STAFF_MEDIA_COLUMN_SORTS } from '../utils/staff-media-library'

const call = (handler: (request: Request) => Promise<Response>, path: string, params: Record<string, string>) => {
  const url = new URL(`https://console.test${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return handler(new Request(url.toString(), { headers: { authorization: 'Bearer t' } }))
}
const list = (params: Record<string, string>) => call(listGET, '/api/admin/media-library', params)
const asset = (params: Record<string, string>) => call(assetGET, '/api/admin/media-library/asset', params)

beforeEach(() => {
  calls = []
  audits.length = 0
  auditFails = false
  parentExists = true
  claims = { uid: 'staff-1', email_verified: true, staff: true }
})

describe('a page of a media library, for staff', () => {
  it('is staff only, and writes nothing to the log for a refused caller', async () => {
    claims = { uid: 'member-1', email_verified: true }
    expect((await list({ orgId: 'o1' })).status).toBe(403)
    expect(audits).toEqual([])
  })

  it('needs exactly one library, named by a plain id', async () => {
    expect((await list({})).status).toBe(400)
    expect((await list({ orgId: 'o1', hostId: 'h1' })).status).toBe(400)
    expect((await list({ orgId: 'o1/hosts/h2' })).status).toBe(400)
  })

  it('is a 404 for a library whose parent does not exist', async () => {
    parentExists = false
    expect((await list({ orgId: 'nope' })).status).toBe(404)
  })

  it('pages on the query: one order, newest first, a limit of one more than the page', async () => {
    const response = await list({ orgId: 'o1', pageSize: '1' })
    expect(response.status).toBe(200)
    expect(calls).toEqual([
      ['orderBy', 'createdAt', 'desc'],
      ['limit', 2],
    ])
    const page = await response.json()
    expect(page.rows.map((row: any) => row.$id)).toEqual(['pub'])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('pub')
  })

  it('continues after the cursor document, and orders by a header it offers', async () => {
    expect((await list({ orgId: 'o1', cursor: 'pub', sort: 'sizeBytes:asc' })).status).toBe(200)
    expect(calls).toEqual([
      ['orderBy', 'sizeBytes', 'asc'],
      ['startAfter', 'pub'],
      ['limit', 26],
    ])
  })

  it('ignores an order it does not offer', async () => {
    expect((await list({ hostId: 'h1', sort: 'uploadedBy:asc' })).status).toBe(200)
    expect(calls[0]).toEqual(['orderBy', 'createdAt', 'desc'])
  })

  it('draws a private asset through a staff-minted signed CDN link, never its raw storage URL', async () => {
    const body = await (await list({ orgId: 'o1' })).json()
    const text = JSON.stringify(body)
    expect(text).not.toContain('token=SECRET')
    const priv = body.rows.find((row: any) => row.$id === 'priv')
    expect(priv.private).toBe(true)
    expect(priv.thumbSrc).toBe(
      `/api/media/cdn/org:o1/priv?exp=${priv.thumbSrc.match(/exp=(\d+)/)[1]}&sig=sig(org:o1/priv)&aud=team`,
    )
    const pub = body.rows.find((row: any) => row.$id === 'pub')
    expect(pub.thumbSrc).toBe('/api/media/cdn/org:o1/pub?w=320')
  })

  it("signs a site library's private asset over the site's CDN scope", async () => {
    const body = await (await list({ hostId: 'h1' })).json()
    expect(body.rows.find((row: any) => row.$id === 'priv').thumbSrc).toContain('/api/media/cdn/h1/priv?')
  })

  it('records the page as data staff looked at, before serving it', async () => {
    expect((await list({ orgId: 'o1' })).status).toBe(200)
    expect(audits).toEqual([
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'media.library-viewed',
        target: 'orgs/o1/media',
      }),
    ])
    expect(adminAuditKind('media.library-viewed')).toBe('access')
  })

  it("files a site library's read under the site", async () => {
    await list({ hostId: 'h1' })
    expect(audits[0]).toEqual(expect.objectContaining({ target: 'hosts/h1/media' }))
  })

  it('serves nothing when the read cannot be recorded', async () => {
    auditFails = true
    const response = await list({ orgId: 'o1' })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('contract.jpg')
  })
})

describe('one asset opened, for staff', () => {
  it('is staff only', async () => {
    claims = { uid: 'member-1', email_verified: true }
    expect((await asset({ orgId: 'o1', mediaId: 'priv' })).status).toBe(403)
    expect(audits).toEqual([])
  })

  it('is a 404 for an asset that does not exist', async () => {
    expect((await asset({ orgId: 'o1', mediaId: 'missing' })).status).toBe(404)
  })

  it('returns the metadata, owner, visibility and usage, with a signed preview for a private asset', async () => {
    const response = await asset({ orgId: 'o1', mediaId: 'priv' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('token=SECRET')
    expect(body.previewSrc).toContain('/api/media/cdn/org:o1/priv?')
    expect(body.previewExpiresAtMs).toEqual(expect.any(Number))
    expect(body.storagePath).toBe('orgs/o1/media/priv')
    expect(body.owner).toEqual({ uid: 'u-owner', email: 'u-owner@example.com', displayName: null })
    expect(body.visibleTo).toEqual(['host:h1'])
    expect(body.usage.coverage).toBe('full')
    expect(body.usedBy).toEqual([{ hostId: 'h1', name: 'h1' }])
  })

  it('records the opened asset as data staff looked at', async () => {
    await asset({ orgId: 'o1', mediaId: 'priv' })
    expect(audits).toEqual([
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'media.asset-viewed',
        target: 'orgs/o1/media/priv',
      }),
    ])
    expect(adminAuditKind('media.asset-viewed')).toBe('access')
  })

  it('serves nothing when the read cannot be recorded', async () => {
    auditFails = true
    expect((await asset({ orgId: 'o1', mediaId: 'priv' })).status).toBe(500)
  })
})

describe("the card's orders need no composite index", () => {
  it('every header order is one stored field that no index override exempts', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
    )
    const exempt = (file.fieldOverrides ?? [])
      .filter((override: any) => override.collectionGroup === 'media')
      .filter((override: any) => Array.isArray(override.indexes) && override.indexes.length === 0)
      .map((override: any) => override.fieldPath)
    const paths = [...new Set(STAFF_MEDIA_COLUMN_SORTS.map((sort) => sort.path))]
    expect(paths.sort()).toEqual(['contentType', 'createdAt', 'fileName', 'sizeBytes'])
    expect(paths.filter((path) => exempt.includes(path))).toEqual([])
  })
})
