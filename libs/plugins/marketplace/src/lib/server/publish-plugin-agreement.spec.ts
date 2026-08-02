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

import {
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementState,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { requiredAttestationIds } from '@aglyn/aglyn/app-utils/publisher-attestation'

/**
 * The publish route's publisher-agreement gate (AGL-1077).
 *
 * The point of versioning an agreement is that changing it re-asks. That
 * only holds if the refusal happens where the bytes are stored — a console
 * that hides the publish button is not a gate, it is a suggestion. These
 * cover the three properties the document's version string is worth
 * anything for: no acceptance refuses, a STALE acceptance refuses too, and
 * the refusal is distinguishable from the per-bundle 428 so a publisher is
 * not sent back to re-tick a checklist that is already complete.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: () => true,
  checkPluginBundle: () => ({ ok: true, problems: [] }),
  createResourceUid: () => 'listing-new',
  MAX_PLUGIN_BUNDLE_BYTES: 1_000_000,
  pluginArtifactPath: () => 'plugins/listing/1.0.0/sha.js',
  PLUGIN_VERIFIER_VERSION: 1,
  validatePluginManifest: (manifest: unknown) => ({ ok: true, manifest }),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => true,
  resolvePublisherProfile: async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = jest.requireMock('./publisher-profile') as {
      __agreement: { version?: string } | undefined
    }
    return {
      orgId: 'org-1',
      stripeChargesEnabled: true,
      agreement: store.__agreement,
    }
  },
  __agreement: undefined as { version?: string } | undefined,
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
      doc: () => listingRef,
      where: () => ({
        where: () => ({
          limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        }),
      }),
    }),
    runTransaction: async (work: (tx: unknown) => Promise<boolean>) =>
      work({ get: async () => ({ data: () => ({}) }), set: () => undefined }),
  }
  return {
    __versionWrites: [] as Array<Record<string, unknown>>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => firestore,
        storage: () => ({
          bucket: () => ({
            file: () => ({ exists: async () => [true], save: async () => undefined }),
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
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const profileMock = jest.requireMock('./publisher-profile') as {
  __agreement: { version?: string } | undefined
}

import { publishPluginHandler } from './publish-plugin'

function respond() {
  const result: { status: number; body: any } = { status: 0, body: null }
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

async function publish() {
  const { res, result } = respond()
  await publishPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        orgId: 'org-1',
        displayName: 'Widget',
        repositoryUrl: 'https://github.com/acme/widget',
        bundle: Buffer.from('export function register() {}').toString('base64'),
        manifest: { id: 'acme.widget', version: '1.0.0' },
        attestation: requiredAttestationIds(false),
      },
    } as never,
    res as never,
  )
  return result
}

describe('publish-plugin publisher-agreement gate (AGL-1077)', () => {
  const ORIGINAL_BUCKET = process.env.PLUGIN_ARTIFACTS_BUCKET

  beforeAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = 'test-bucket'
  })
  afterAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = ORIGINAL_BUCKET
  })
  beforeEach(() => {
    adminMock.__versionWrites.length = 0
    profileMock.__agreement = { version: PUBLISHER_AGREEMENT_VERSION }
  })

  it('refuses an org that has never accepted the agreement', async () => {
    profileMock.__agreement = undefined
    const result = await publish()
    expect(result.status).toBe(412)
    expect(result.body.agreement.state).toBe('none')
    // Nothing published under terms nobody agreed to.
    expect(adminMock.__versionWrites).toHaveLength(0)
  })

  it('refuses a STALE acceptance rather than carrying it forward', async () => {
    // The failure this whole mechanism exists to prevent: an agreement we
    // rewrote, and a publisher who never saw the rewrite.
    profileMock.__agreement = { version: '1999-01-01.1' }
    const result = await publish()
    expect(result.status).toBe(412)
    expect(result.body.agreement.state).toBe('outdated')
    expect(result.body.agreement.accepted).toBe('1999-01-01.1')
    expect(result.body.agreement.required).toBe(PUBLISHER_AGREEMENT_VERSION)
    expect(adminMock.__versionWrites).toHaveLength(0)
  })

  it('is a different refusal from the per-bundle attestation 428', async () => {
    // "You did not confirm the checklist" and "your org never agreed to our
    // terms" are fixed in different places. One status for both sends a
    // publisher to re-tick six boxes that are already ticked.
    profileMock.__agreement = undefined
    const result = await publish()
    expect(result.status).not.toBe(428)
    expect(result.body.missingAttestations).toBeUndefined()
    expect(String(result.body.error)).toMatch(/Publisher Profile/)
  })

  it('publishes once the current version is accepted', async () => {
    const result = await publish()
    expect(result.status).toBe(200)
    expect(adminMock.__versionWrites).toHaveLength(1)
  })

  it('reads state from the accepted version, not from presence', async () => {
    // A record with no version is not an acceptance of anything.
    expect(publisherAgreementState({ acceptedBy: 'uid-1' })).toBe('none')
    expect(publisherAgreementState({ version: '' })).toBe('none')
  })
})
