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

import { requiredAttestationIds } from '@aglyn/aglyn/app-utils/publisher-attestation'

/** A valid subject for the `repository` attestation (AGL-1076). */
const REPO_URL = 'https://github.com/acme/widget'

/**
 * The publish route's attestation gate (AGL-969).
 *
 * The dialog can be bypassed — it is a form posting JSON — so the statement
 * a publisher makes has to be enforced where the bytes are actually stored.
 * These cover the three things that matter and that a UI test cannot reach:
 * a submission short of the required set is REFUSED (not warned), an update
 * is held to the larger set decided from server state rather than a client
 * flag, and what lands on the version doc is pinned to the bundle's sha256
 * so a republish re-asks.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: () => true,
  checkPluginBundle: () => ({ ok: true, problems: [] }),
  createResourceUid: () => 'listing-new',
  MAX_PLUGIN_BUNDLE_BYTES: 1_000_000,
  pluginArtifactPath: () => 'plugins/listing/1.0.0/sha.js',
  PLUGIN_VERIFIER_VERSION: 1,
  validatePluginManifest: (manifest: unknown) => ({
    ok: true,
    manifest,
  }),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => true,
  resolvePublisherProfile: async () => ({
    orgId: 'org-1',
    stripeChargesEnabled: true,
    // The org-level publisher agreement (AGL-1077) is a separate gate with
    // its own spec; hold it satisfied here so these assertions stay about
    // the per-bundle attestation.
    agreement: {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      version: (
        jest.requireActual(
          '@aglyn/aglyn/app-utils/publisher-agreement',
        ) as { PUBLISHER_AGREEMENT_VERSION: string }
      ).PUBLISHER_AGREEMENT_VERSION,
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const versionDoc = {
    set: (data: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const store = jest.requireMock('@aglyn/tenant-data-admin') as {
        __versionWrites: Array<Record<string, unknown>>
      }
      store.__versionWrites.push(data)
      return Promise.resolve()
    },
  }
  const listingRef = {
    id: 'listing-1',
    set: async () => undefined,
    get: async () => ({ data: () => ({}) }),
    collection: () => ({ doc: () => versionDoc }),
  }
  const firestore = {
    collection: () => ({
      // Every doc behaves like the listing ref, so the version write is
      // captured whether the listing was found or freshly created.
      doc: () => listingRef,
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const store = jest.requireMock('@aglyn/tenant-data-admin') as {
                __listingExists: boolean
              }
              return store.__listingExists
                ? { empty: false, docs: [{ ref: listingRef }] }
                : { empty: true, docs: [] }
            },
          }),
        }),
      }),
    }),
    runTransaction: async (work: (tx: unknown) => Promise<boolean>) =>
      work({
        get: async () => ({ data: () => ({}) }),
        set: () => undefined,
      }),
  }
  return {
    __versionWrites: [] as Array<Record<string, unknown>>,
    __listingExists: false,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => firestore,
        storage: () => ({
          bucket: () => ({
            file: () => ({
              exists: async () => [true],
              save: async () => undefined,
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    getOrgForUser: async () => ({ orgId: 'org-1', org: {} }),
    notifyStaff: async () => undefined,
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __versionWrites: Array<Record<string, unknown>>
  __listingExists: boolean
}

import { publishPluginHandler } from './publish-plugin'

function respond() {
  const result: { status: number; body: unknown } = { status: 0, body: null }
  const res = {
    status(code: number) {
      result.status = code
      return {
        json(body: unknown) {
          result.body = body
          return body
        },
      }
    },
  }
  return { res, result }
}

async function publish(
  attestation: string[] | undefined,
  overrides: Record<string, unknown> = { repositoryUrl: REPO_URL },
) {
  const { res, result } = respond()
  await publishPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        orgId: 'org-1',
        displayName: 'Widget',
        bundle: Buffer.from('export function register() {}').toString('base64'),
        manifest: { id: 'acme.widget', version: '1.0.0' },
        ...(attestation ? { attestation } : {}),
        ...overrides,
      },
    } as never,
    res as never,
  )
  return result
}

describe('publish-plugin attestation gate (AGL-969)', () => {
  const ORIGINAL_BUCKET = process.env.PLUGIN_ARTIFACTS_BUCKET

  beforeAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = 'test-bucket'
  })
  afterAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = ORIGINAL_BUCKET
  })
  beforeEach(() => {
    adminMock.__versionWrites.length = 0
    adminMock.__listingExists = false
  })

  it('refuses a submission with no attestation at all', async () => {
    const result = await publish(undefined)
    expect(result.status).toBe(428)
    expect((result.body as { missingAttestations: string[] })
      .missingAttestations).toEqual(requiredAttestationIds(false))
    // Refused means refused: nothing reached the version doc.
    expect(adminMock.__versionWrites).toHaveLength(0)
  })

  it('refuses a partial attestation', async () => {
    const result = await publish(requiredAttestationIds(false).slice(1))
    expect(result.status).toBe(428)
    expect(adminMock.__versionWrites).toHaveLength(0)
  })

  it('publishes a first version once the required items are stated', async () => {
    const result = await publish(requiredAttestationIds(false))
    expect(result.status).toBe(200)
    expect(adminMock.__versionWrites).toHaveLength(1)
  })

  it('holds an UPDATE to the larger set, decided from server state', async () => {
    adminMock.__listingExists = true
    // Exactly what a first publish is allowed to send. An update needs more,
    // and the client never says which case it is.
    const result = await publish(requiredAttestationIds(false))
    expect(result.status).toBe(428)
    expect((result.body as { missingAttestations: string[] })
      .missingAttestations).toEqual(['changelog'])

    adminMock.__versionWrites.length = 0
    const ok = await publish(requiredAttestationIds(true))
    expect(ok.status).toBe(200)
  })

  it('stores each attestation pinned to the bundle sha256', async () => {
    const result = await publish(requiredAttestationIds(false))
    expect(result.status).toBe(200)
    const written = adminMock.__versionWrites[0] as {
      sha256: string
      publisherAttestation: Record<
        string,
        { by: string; at: unknown; sha256: string }
      >
    }
    expect(Object.keys(written.publisherAttestation).sort()).toEqual(
      [...requiredAttestationIds(false)].sort(),
    )
    for (const entry of Object.values(written.publisherAttestation)) {
      // The bytes it was made against — this is what makes a republish
      // under the same version string re-ask instead of inheriting.
      expect(entry.sha256).toBe(written.sha256)
      expect(entry.by).toBe('uid-1')
    }
  })

  /**
   * The subject gate (AGL-1076).
   *
   * `repository` shipped as a confirmable claim about a field the form never
   * collected, so listings reached review carrying a signed statement that a
   * URL was public and matched — with nothing behind the reviewer's first
   * link. A tick with no subject is refused like a missing tick.
   */
  describe('attested fields must actually be submitted', () => {
    it('refuses a full attestation with no repository URL', async () => {
      const result = await publish(requiredAttestationIds(false), {})
      expect(result.status).toBe(428)
      expect(
        (result.body as { missingAttestationSubjects: string[] })
          .missingAttestationSubjects,
      ).toEqual(['repositoryUrl'])
      // Refused means refused — no bytes, no version doc, no claim recorded.
      expect(adminMock.__versionWrites).toHaveLength(0)
    })

    it('refuses a blank repository URL, not only an absent one', async () => {
      const result = await publish(requiredAttestationIds(false), {
        repositoryUrl: '   ',
      })
      // `validateListingContent` rejects a non-https string first; either
      // way the publish does not land, which is the property under test.
      expect(result.status).not.toBe(200)
      expect(adminMock.__versionWrites).toHaveLength(0)
    })

    it('gates an UPDATE on the request, never on the stored listing', async () => {
      adminMock.__listingExists = true
      // The listing doc in this mock answers `{}` to everything, so a gate
      // reading the listing would behave identically here — but a gate
      // reading the listing would also let an update omit the field and
      // inherit last year's URL as this version's attested subject.
      const result = await publish(requiredAttestationIds(true), {})
      expect(result.status).toBe(428)
      expect(adminMock.__versionWrites).toHaveLength(0)
    })

    it('pins the declared repository to the version, not only the listing', async () => {
      const result = await publish(requiredAttestationIds(false))
      expect(result.status).toBe(200)
      const written = adminMock.__versionWrites[0] as {
        repositoryUrl?: string
      }
      // A reviewer opening v1.0.0 gets the repo declared for v1.0.0's bytes,
      // whatever the listing says after the next publish.
      expect(written.repositoryUrl).toBe(REPO_URL)
    })
  })

  it('ignores ids that are not attestation items', async () => {
    const result = await publish([
      ...requiredAttestationIds(false),
      'made-up-item',
    ])
    expect(result.status).toBe(200)
    const written = adminMock.__versionWrites[0] as {
      publisherAttestation: Record<string, unknown>
    }
    expect(written.publisherAttestation['made-up-item']).toBeUndefined()
  })
})
