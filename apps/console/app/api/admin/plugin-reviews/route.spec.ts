/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * Approving a version must not RESURRECT a deleted listing (AGL-1766).
 *
 * Firestore deletes are not recursive, so `pluginVersions` outlives whatever
 * removed its parent. The handler read the parent as
 * `(await listingRef.get()).data() ?? {}` and then branched on that default —
 * and both surviving branches are TRUE on `{}`, so the merge-sets below them
 * wrote a listing back into existence. The `reviewStatus` one is the bad one:
 * `{ reviewStatus: 'listed' }` is the state `isListingBrowsable` tests, so a
 * plugin nobody can see in the console reappears in the marketplace with no
 * name, no publisher and no description.
 *
 * The third mirror in the same block is the control and it is asserted here
 * too: `latestVersionReviewState` compares `String(latestVersion ?? '')` to a
 * non-empty version and is FALSE on `{}`. Two of three — which is why
 * AGL-1763 could not turn this into a lint rule.
 *
 * Counting what LANDED, not what the handler returned: every assertion reads
 * the in-memory store by document path and checks each stored field
 * individually. The fake's `update()` reproduces Firestore's reject-on-missing
 * with the real gRPC `NOT_FOUND` code, and its `set({ merge: true })` merges
 * maps RECURSIVELY and honours delete sentinels at any depth — a shallow
 * spread would invent reds by dropping the version doc's own sentinels.
 *
 * No Stripe path is reachable from this route and nothing here touches
 * `fetch`. The seeded listings carry no `profileId`, so the publisher
 * notification and email are out of the picture by construction rather than
 * by stubbing.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** gRPC `Status.NOT_FOUND`, the code Firestore rejects a missing update with. */
const GRPC_NOT_FOUND = 5

const DELETE_SENTINEL = { __sentinel: 'delete' }

/** Every document, keyed by its full path. */
let docs = new Map<string, Record<string, unknown>>()
/** Appended `adminAudit` rows, in order. */
let audit: Record<string, unknown>[] = []
/**
 * Fires immediately before a `set()` lands, so a test can delete a document in
 * the exact mid-handler window the race needs.
 */
let onSet: ((path: string, data: Record<string, unknown>) => void) | null = null

const mockVerifyIdToken = jest.fn()

function mockIsPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value !== DELETE_SENTINEL &&
    typeof (value as { __sentinel?: unknown }).__sentinel !== 'string'
  )
}

/** What `set(…, { merge: true })` really does: deep merge, sentinels honoured. */
function mockMergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
      delete next[key]
    } else if (mockIsPlainObject(value)) {
      next[key] = mockMergeInto(
        mockIsPlainObject(next[key])
          ? (next[key] as Record<string, unknown>)
          : {},
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

/** In-memory Firestore, keyed by document path. */
function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      data: () => docs.get(path),
      // Dotted lookups, as `versionSnapshot.get('manifest.hostAbi')` needs.
      get: (field: string) =>
        field
          .split('.')
          .reduce<unknown>(
            (value, key) =>
              mockIsPlainObject(value) ? value[key] : undefined,
            docs.get(path) as unknown,
          ),
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      onSet?.(path, data)
      docs.set(
        path,
        options?.merge
          ? mockMergeInto(docs.get(path) ?? {}, data)
          : mockMergeInto({}, data),
      )
      return undefined
    },
    // Faithful to the real thing: rejects rather than creating. Everything
    // the second-line claim rests on is this line.
    update: async (data: Record<string, unknown>) => {
      if (!docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `5 NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = GRPC_NOT_FOUND
        throw error
      }
      docs.set(path, mockMergeInto(docs.get(path) ?? {}, data))
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
    add: async (data: Record<string, unknown>) => {
      if (prefix === 'adminAudit') audit.push({ ...data })
      const id = `auto-${docs.size}`
      docs.set(`${prefix}/${id}`, { ...data })
      return { id }
    },
  })
  return { collection: (name: string) => makeCollection(name) }
}

/**
 * The REAL helper and the REAL constants, reached by module path so the
 * barrel — and firebase-admin behind it — stays out of this suite (AGL-1715).
 * Stubbing any of them would turn the claims below into claims about a stub.
 */
const mockUpdateExisting = jest.requireActual(
  '../../../../../../libs/tenant/data/admin/src/lib/server/update-existing',
).updateExisting
const mockUpdateState = jest.requireActual(
  '../../../../../../libs/aglyn/src/lib/app-utils/marketplace-update-state',
)
const mockChecklist = jest.requireActual(
  '../../../../constants/plugin-review-checklist',
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        getUsers: async () => ({ users: [] }),
      }),
      firestore: () => mockMakeFirestore(),
      storage: () => ({
        bucket: () => ({ file: () => ({ download: async () => [''] }) }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  updateExisting: (...args: unknown[]) => mockUpdateExisting(...args),
  listOrgMembers: async () => [],
  meterPlatformEmail: async () => undefined,
  notifyOrgAdmins: async () => undefined,
  findUserByUidAcrossPools: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__now__',
    delete: () => DELETE_SENTINEL,
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  compareArtifactVersions: mockUpdateState.compareArtifactVersions,
  checkPluginBundle: () => ({ ok: true, findings: [] }),
  isPluginRevoked: () => false,
  isStoredVerdictCurrent: () => true,
  nextRevocationState: () => null,
  PLUGIN_HOST_ABI_VERSION: 1,
  PLUGIN_VERIFIER_VERSION: 5,
  pluginArtifactPath: () => 'artifacts/x',
  buildRoute: () => '/',
  Route: {},
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    query: {},
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async () => ({ sent: true }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

function post(body: unknown) {
  return new Request('https://app.aglyn.com/api/admin/plugin-reviews', {
    method: 'POST',
    headers: {
      authorization: 'Bearer staff-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const LISTING = 'listing-1'
const VERSION = '1.2.0'
const SHA = 'a'.repeat(64)

/** A version doc whose required checklist is ticked against these bytes. */
function seedVersion(version = VERSION, sha = SHA): void {
  const checklist: Record<string, unknown> = {}
  for (const id of mockChecklist.REQUIRED_CHECKLIST_IDS) {
    checklist[id] = { by: 'staff-1', at: '__then__', sha256: sha }
  }
  docs.set(`marketplaceListings/${LISTING}/pluginVersions/${version}`, {
    version,
    sha256: sha,
    reviewChecklist: checklist,
  })
}

/** The listing its parent should be. No `profileId`: no publisher email. */
function seedListing(fields: Record<string, unknown> = {}): void {
  docs.set(`marketplaceListings/${LISTING}`, {
    type: 'plugin',
    displayName: 'Smoke Test Widget',
    reviewStatus: 'in_review',
    latestVersion: VERSION,
    ...fields,
  })
}

beforeEach(() => {
  docs = new Map()
  audit = []
  onSet = null
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a version verdict refuses an orphaned listing (AGL-1766)', () => {
  it('404s when the listing is gone and writes NOTHING, not even the verdict', async () => {
    // The orphan: the version survives, the parent does not.
    seedVersion()
    expect(docs.has(`marketplaceListings/${LISTING}`)).toBe(false)

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown listing' })
    // No resurrection, under any shape.
    expect(docs.has(`marketplaceListings/${LISTING}`)).toBe(false)
    // And the check happens BEFORE the verdict write, so the version doc is
    // untouched too — refusing after stamping it would leave an approval
    // recorded against a 404.
    const stored = docs.get(
      `marketplaceListings/${LISTING}/pluginVersions/${VERSION}`,
    ) as Record<string, unknown>
    expect(stored['reviewState']).toBe(undefined)
    expect(stored['reviewedBy']).toBe(undefined)
    expect(audit).toHaveLength(0)
  })

  it('the resurrected listing would have been BROWSABLE — the field that matters', async () => {
    // Naming the specific damage rather than the fact of a write: on `{}`,
    // `!['listed','verified'].includes('')` is true, so the mirror wrote
    // `reviewStatus: 'listed'` — the state the marketplace browses by.
    seedVersion()

    await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )

    expect(docs.get(`marketplaceListings/${LISTING}`)?.['reviewStatus']).toBe(
      undefined,
    )
    expect(
      docs.get(`marketplaceListings/${LISTING}`)?.['latestApprovedVersion'],
    ).toBe(undefined)
  })

  it('a REJECT of an orphaned version is refused the same way', async () => {
    // The reject path reaches the same block. Its only listing write is the
    // control mirror, so a reader could reasonably assume it was safe — but
    // it is refused for the same reason, and the version doc keeps no verdict.
    seedVersion()

    const response = await POST(
      post({
        listingId: LISTING,
        action: 'reject-version',
        version: VERSION,
        reason: 'The README is one line.',
        category: 'quality',
      }),
    )

    expect(response.status).toBe(404)
    expect(docs.has(`marketplaceListings/${LISTING}`)).toBe(false)
    expect(
      docs.get(`marketplaceListings/${LISTING}/pluginVersions/${VERSION}`)?.[
        'reviewState'
      ],
    ).toBe(undefined)
  })

  it('BEHAVIOUR PIN: a real approval still lands, every stored field checked', async () => {
    seedListing()
    seedVersion()

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      version: VERSION,
      reviewState: 'approved',
      liveInstalls: 0,
      stranded: false,
    })

    const version = docs.get(
      `marketplaceListings/${LISTING}/pluginVersions/${VERSION}`,
    ) as Record<string, unknown>
    expect(version['reviewState']).toBe('approved')
    expect(version['reviewedBy']).toBe('staff-1')
    expect(version['reviewedSha256']).toBe(SHA)

    const listing = docs.get(`marketplaceListings/${LISTING}`) as Record<
      string,
      unknown
    >
    expect(listing['latestVersionReviewState']).toBe('approved')
    expect(listing['reviewStatus']).toBe('listed')
    expect(listing['latestApprovedVersion']).toBe(VERSION)
    expect(listing['updatedAt']).toBe('__now__')
    // The mirrors PATCH: fields they never mention have to survive.
    expect(listing['displayName']).toBe('Smoke Test Widget')
    expect(listing['type']).toBe('plugin')
    expect(listing['latestVersion']).toBe(VERSION)

    expect(audit).toHaveLength(1)
    expect(audit[0]['action']).toBe('plugins.review.version.approve')
  })

  it('BEHAVIOUR PIN: approving an OLDER version never walks the offer back', async () => {
    // The `latestApprovedVersion` guard, which the `?? {}` default also
    // defeated. A fix that dropped it would demote a live plugin.
    seedListing({ latestVersion: '2.0.0', latestApprovedVersion: '2.0.0' })
    seedVersion('1.2.0')

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: '1.2.0' }),
    )
    expect(response.status).toBe(200)

    const listing = docs.get(`marketplaceListings/${LISTING}`) as Record<
      string,
      unknown
    >
    expect(listing['latestApprovedVersion']).toBe('2.0.0')
    // Not the latest version, so the per-bytes claim is left alone as well.
    expect(listing['latestVersionReviewState']).toBe(undefined)
  })

  it('BEHAVIOUR PIN: an already-listed plugin keeps the status it had', async () => {
    // `verified` outranks `listed`; the mirror must not demote it on the next
    // approval. This is the branch whose condition the empty default flipped.
    seedListing({ reviewStatus: 'verified' })
    seedVersion()

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )
    expect(response.status).toBe(200)
    expect(docs.get(`marketplaceListings/${LISTING}`)?.['reviewStatus']).toBe(
      'verified',
    )
  })

  it('SECOND LINE: a listing erased between the check and the mirror is not reborn', async () => {
    // The window the read cannot close. `updateExisting` is the only thing
    // standing here — a merge-set would recreate the listing from the patch,
    // which is the same phantom by a slower route.
    seedListing()
    seedVersion()
    // Erase the listing at the moment the verdict lands on the version doc:
    // after the existence check, before the three mirrors.
    const versionPath = `marketplaceListings/${LISTING}/pluginVersions/${VERSION}`
    onSet = (path, data) => {
      if (path === versionPath && data['reviewState']) {
        docs.delete(`marketplaceListings/${LISTING}`)
      }
    }

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )

    // The verdict on the bytes is real work that already happened, so it
    // stands and the reviewer is told it did (AGL-1760).
    expect(response.status).toBe(200)
    expect(
      docs.get(versionPath)?.['reviewState'],
    ).toBe('approved')
    // Not resurrected by any of the three mirrors.
    expect(docs.has(`marketplaceListings/${LISTING}`)).toBe(false)
  })

  it('NEGATIVE CONTROL: a non-staff caller is refused before any read', async () => {
    seedListing()
    seedVersion()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email_verified: true,
    })

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: VERSION }),
    )
    expect(response.status).toBe(403)
    expect(docs.get(`marketplaceListings/${LISTING}`)?.['reviewStatus']).toBe(
      'in_review',
    )
  })

  it('NEGATIVE CONTROL: an unknown VERSION still 404s on the version, not the listing', async () => {
    // Ordering pin: the version check stays first, so the reviewer is told
    // which of the two ids was wrong.
    seedListing()

    const response = await POST(
      post({ listingId: LISTING, action: 'approve-version', version: '9.9.9' }),
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown version' })
  })
})
