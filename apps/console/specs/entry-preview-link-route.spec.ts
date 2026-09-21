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
 * `/api/content/preview-link` (AGL-3205): the ONE place a capability to see an
 * unpublished post is created.
 *
 * Minting is REAL here — the returned URL's token is pulled apart and handed
 * to the real verifier — because the thing worth asserting is not that the
 * route answered 200. It is that what it signed matches what it was asked
 * for, and nothing wider: the same token is checked against a neighbouring
 * entry and must be refused.
 *
 * The refusal cases matter as much. A route that answered 403 for everything
 * would pass the authorization half of this suite while being completely
 * broken, so the happy path and the refusals are asserted together.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'preview-link-spec-secret'

let mockDecoded: Record<string, unknown> | null
/** What the wrapped `verifyIdToken` throws for any token but the good one. */
let mockVerifyError: unknown
/** The `hosts/{hostId}` document, or null for "no such site". */
let mockHost: Record<string, unknown> | null
/** What the shared content-edit gate answers — null means "allowed". */
let mockRefusal: Response | null

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/host-naming'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => null),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/collection-preview-token',
  ),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email not verified' }, { status: 403 }),
  isImpersonationSession: () => false,
  hostContentEditRefusal: async () => mockRefusal,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token !== 'good-id-token' || !mockDecoded) throw mockVerifyError
          return mockDecoded
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockHost !== null,
              id: 'host-1',
              data: () => mockHost,
              get: (key: string) => mockHost?.[key],
            }),
          }),
        }),
      }),
    }),
  },
}))

import { verifyCollectionPreviewToken } from '@aglyn/tenant-data-admin'
import { ENTRY_PREVIEW_PARAM } from '@aglyn/aglyn/app-utils/entry-preview-link'
import { POST } from '../app/api/content/preview-link/route'

const authError = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

const SCOPE = {
  hostId: 'host-1',
  collectionSlug: 'blog',
  entrySlug: 'shipping-the-export',
}

function mintRequest(
  body: Record<string, unknown> = SCOPE,
  // `null`, never `undefined`: passing `undefined` to a defaulted parameter
  // uses the DEFAULT, so the "no credential" case would silently send a good
  // one and assert 401 against a 200.
  authorization: string | null = 'Bearer good-id-token',
  method = 'POST',
): Request {
  return new Request('https://app.aglyn.com/api/content/preview-link', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

/** The token out of a minted URL, as the tenant would receive it. */
function tokenFrom(url: string): string {
  return new URL(url).searchParams.get(ENTRY_PREVIEW_PARAM) ?? ''
}

beforeEach(() => {
  mockDecoded = { uid: 'uid-editor', email_verified: true }
  mockVerifyError = authError(
    'auth/argument-error',
    'Firebase ID token has invalid signature.',
  )
  mockHost = { orgId: 'org-1', subdomain: 'acme' }
  mockRefusal = null
})

describe('it mints a link scoped to exactly the entry it was asked for', () => {
  it('answers a URL on the site’s own public origin', async () => {
    const response = await POST(mintRequest())
    expect(response.status).toBe(200)
    const { url } = await response.json()
    expect(url.startsWith('https://acme.')).toBe(true)
    expect(new URL(url).pathname).toBe('/blog/shipping-the-export')
  })

  it('signs a token the tenant’s real verifier accepts for that scope', async () => {
    const { url } = await (await POST(mintRequest())).json()
    expect(verifyCollectionPreviewToken(tokenFrom(url), SCOPE)).toBe(true)
  })

  it('signs nothing wider: the same token is refused for a sibling post', async () => {
    const { url } = await (await POST(mintRequest())).json()
    expect(
      verifyCollectionPreviewToken(tokenFrom(url), {
        ...SCOPE,
        entrySlug: 'some-other-post',
      }),
    ).toBe(false)
  })

  it('signs nothing wider: the same token is refused on another site', async () => {
    const { url } = await (await POST(mintRequest())).json()
    expect(
      verifyCollectionPreviewToken(tokenFrom(url), {
        ...SCOPE,
        hostId: 'host-2',
      }),
    ).toBe(false)
  })

  it('reports when the link stops working', async () => {
    const { expiresAtMs } = await (await POST(mintRequest())).json()
    expect(expiresAtMs).toBeGreaterThan(Date.now())
    // Hours, not days. The exact figure lives with the constant; what this
    // pins is that the route is not handing out something open-ended.
    expect(expiresAtMs - Date.now()).toBeLessThanOrEqual(6 * 60 * 60 * 1000)
  })

  it('prefers a live custom domain, the way the site’s canonical does', async () => {
    // Otherwise the link would bounce off the tenant's canonical-domain
    // redirect, which drops the query string and therefore the token.
    mockHost = { orgId: 'org-1', subdomain: 'acme', cname: 'example.com' }
    const { url } = await (await POST(mintRequest())).json()
    expect(url.startsWith('https://example.com/blog/')).toBe(true)
  })

  it('does not accept an origin from the caller', async () => {
    const { url } = await (
      await POST(
        mintRequest({ ...SCOPE, origin: 'https://attacker.example' }),
      )
    ).json()
    expect(url).not.toContain('attacker.example')
  })
})

describe('it refuses anything it cannot scope or authorize', () => {
  it('refuses a GET', async () => {
    expect((await POST(mintRequest(SCOPE, 'Bearer good-id-token', 'GET'))).status).toBe(
      405,
    )
  })

  it('refuses an unauthenticated call', async () => {
    expect((await POST(mintRequest(SCOPE, null))).status).toBe(401)
  })

  it('refuses a bad credential as a 401, not a 500', async () => {
    const response = await POST(mintRequest(SCOPE, 'Bearer nope'))
    expect(response.status).toBe(401)
  })

  it('answers 500 when verification BREAKS rather than refuses', async () => {
    // Paired with the case above on purpose: a route that answered 401 for
    // everything would pass that one while hiding an outage.
    mockVerifyError = new Error('the network is down')
    const response = await POST(mintRequest(SCOPE, 'Bearer nope'))
    expect(response.status).toBe(500)
  })

  it('refuses an unverified email', async () => {
    mockDecoded = { uid: 'uid-editor', email_verified: false }
    expect((await POST(mintRequest())).status).toBe(403)
  })

  it.each([
    ['no hostId', { ...SCOPE, hostId: '' }],
    ['no collection', { ...SCOPE, collectionSlug: '' }],
    ['no entry', { ...SCOPE, entrySlug: '' }],
  ])('refuses %s with a 400 rather than a wildcard token', async (_l, body) => {
    expect((await POST(mintRequest(body))).status).toBe(400)
  })

  it('refuses an unknown site', async () => {
    mockHost = null
    expect((await POST(mintRequest())).status).toBe(404)
  })

  it('refuses a site with no public address to preview at', async () => {
    mockHost = { orgId: 'org-1' }
    expect((await POST(mintRequest())).status).toBe(409)
  })

  it('passes the shared content-edit refusal through verbatim', async () => {
    // The gate is `hostContentEditRefusal`, the same one the edit bar uses
    // minus its release flag. This route must not soften or reword it.
    mockRefusal = Response.json({ error: 'No edit access' }, { status: 403 })
    const response = await POST(mintRequest())
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('No edit access')
  })

  it('signs nothing when the gate refuses', async () => {
    mockRefusal = Response.json({ error: 'No edit access' }, { status: 403 })
    const body = await (await POST(mintRequest())).json()
    expect(body.url).toBeUndefined()
  })
})
