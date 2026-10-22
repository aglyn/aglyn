/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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
 * A server-error body is fixed copy, never a thrown error's message (AGL-2797).
 *
 * `media/folders` answered `{ error: error?.message }` from its catch-all, so
 * whatever threw inside the handler reached the client verbatim: a Firestore or
 * Storage error naming our project's internals, and the verifier's own text,
 * which told a deleted account ("The user record no longer exists.") from a
 * revoked one. `orgs/sso` carried the same leak as a `detail` field on the 502
 * it answers when provisioning the identity pool fails.
 *
 * The one message thrown inside `media/folders` that IS copy — a folder too
 * large to move in one request — now travels as its own 422, and it is refused
 * before the rename it belongs to is written, so the answer cannot describe a
 * refusal while the folder already carries its new name.
 */

const STAFF = {
  uid: 'uid-1',
  email: 'admin@example.com',
  email_verified: true,
  staff: true,
}

let mockVerifyOutcome: Record<string, unknown> | Error = STAFF
let mockFolderRead: () => Promise<unknown>
let mockSubtreeMedia: unknown[] = []
const mockFolderUpdate = jest.fn()
const mockProvision = jest.fn()

function mockOpenModule(named: Record<string, unknown>): Record<string, unknown> {
  const stubs = new Map<string, jest.Mock>()
  return new Proxy(
    { __esModule: true, ...named },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        if (typeof key !== 'string' || key === 'then') return undefined
        if (!stubs.has(key)) stubs.set(key, jest.fn())
        return stubs.get(key)
      },
    },
  )
}

/** A query document over plain data. */
function mockQueryDoc(id: string, data: Record<string, unknown>) {
  return { id, exists: true, ref: { id }, data: () => data, get: (key: string) => data[key] }
}

const mockFoldersRef = {
  doc: () => ({
    get: () => mockFolderRead(),
    update: (...args: unknown[]) => mockFolderUpdate(...args),
  }),
  limit: () => ({
    get: async () => ({
      docs: [mockQueryDoc('folder-1', { name: 'Old name', parentId: null })],
    }),
  }),
}

const mockMediaRef = {
  where: () => ({ get: async () => ({ docs: mockSubtreeMedia }) }),
}

jest.mock('@aglyn/tenant-data-admin', () =>
  mockOpenModule({
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => {
            if (mockVerifyOutcome instanceof Error) throw mockVerifyOutcome
            return mockVerifyOutcome
          },
        }),
        storage: () => ({ bucket: () => ({ name: 'test-bucket', file: () => ({}) }) }),
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => mockQueryDoc('org-1', { slug: 'acme', sso: {} }),
              set: async () => undefined,
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'now' } },
    },
    lockdownRefusal: async () => null,
    resolveOrgMembership: async () => null,
    provisionSsoPool: (...args: unknown[]) => mockProvision(...args),
  }),
)

// The real library, so folder names and the request body are normalized the
// way production normalizes them; only the SSO entitlement is opened.
jest.mock('@aglyn/aglyn/server', () => ({
  ...(jest.requireActual('@aglyn/aglyn/server') as Record<string, unknown>),
  __esModule: true,
  checkEntitlement: () => true,
}))

jest.mock('../utils/server/media-scope', () =>
  mockOpenModule({
    resolveMediaScope: async () => ({
      scope: {
        scopeRef: {
          collection: (name: string) =>
            name === 'mediaFolders' ? mockFoldersRef : mockMediaRef,
        },
        base: 'orgs/org-1',
        viewerOrgWide: true,
        collection: 'orgs',
      },
    }),
    isFolderScopePreviewRequest: () => false,
    folderStoragePath: async () => '',
  }),
)

import * as foldersRoute from '../app/api/media/folders/route'
import * as ssoRoute from '../app/api/orgs/sso/route'

const { IdTokenRevokedError } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/token-revocation',
) as typeof import('../../../libs/tenant/data/admin/src/lib/server/token-revocation')

function request(path: string, body: unknown): Request {
  return new Request(`https://app.aglyn.com${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer caller-id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const rename = () =>
  foldersRoute.POST(
    request('/api/media/folders', {
      orgId: 'org-1',
      action: 'rename',
      folderId: 'folder-1',
      name: 'New name',
    }),
  )

beforeEach(() => {
  mockVerifyOutcome = STAFF
  mockFolderRead = async () => mockQueryDoc('folder-1', { name: 'Old name', parentId: null })
  mockSubtreeMedia = []
  mockFolderUpdate.mockReset().mockResolvedValue(undefined)
  mockProvision.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('media/folders (AGL-2797)', () => {
  it('CONTROL — renames a folder whose subtree fits in one request', async () => {
    const response = await rename()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, moved: 0 })
    expect(mockFolderUpdate).toHaveBeenCalledWith({ name: 'New name' })
  })

  it('answers a fixed 500 when Firestore throws, never the error text', async () => {
    mockFolderRead = async () => {
      throw Object.assign(
        new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'),
        { code: 7 },
      )
    }
    const response = await rename()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Folder operation failed' })
  })

  it('tells a deleted account nothing its revoked twin would not also hear', async () => {
    mockVerifyOutcome = new IdTokenRevokedError('The user record no longer exists.')
    const response = await rename()
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthenticated' })
    expect(JSON.stringify(body)).not.toContain('no longer exists')
  })

  it('refuses a folder too large to move with its own copy, before renaming it', async () => {
    mockSubtreeMedia = Array.from({ length: 501 }, (_, index) =>
      mockQueryDoc(`asset-${index}`, { folderId: 'folder-1' }),
    )
    const response = await rename()
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Folder too large to move in one operation',
    })
    expect(mockFolderUpdate).not.toHaveBeenCalled()
  })
})

describe('orgs/sso save-idp (AGL-2797)', () => {
  it('answers its 502 without the provisioning error’s text', async () => {
    mockProvision.mockRejectedValue(
      new Error(
        'PERMISSION_DENIED: identitytoolkit.tenants.create denied for ' +
          'sa-console@aglyn-main.iam.gserviceaccount.com',
      ),
    )
    const response = await ssoRoute.POST(
      request('/api/orgs/sso', {
        orgId: 'org-1',
        action: 'save-idp',
        entityId: 'https://idp.example.com/entity',
        ssoUrl: 'https://idp.example.com/sso',
        certificate: 'MIIC-test-certificate',
      }),
    )
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['error'])
    expect(JSON.stringify(body)).not.toMatch(/PERMISSION_DENIED|iam\.gserviceaccount/)
  })
})
