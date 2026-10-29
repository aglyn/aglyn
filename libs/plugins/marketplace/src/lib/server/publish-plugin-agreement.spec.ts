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
  PUBLISHER_AGREEMENT_CONSENT_REQUIRED,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementConsent,
  publisherAgreementState,
} from '../model/publisher-agreement'
import { requiredAttestationIds } from '../model/publisher-attestation'

/**
 * The plugin publish route's publisher agreement (AGL-1077), agreed to on
 * every publish since AGL-4105.
 *
 * The refusal has to happen where the bytes are stored — a console that
 * disables the publish button is not a gate, it is a suggestion. These cover
 * what the per-save box is worth: a publish without it is refused whatever
 * the org agreed before, a box ticked for an older version is refused too,
 * the refusal names the box rather than the per-bundle checklist, and a
 * publish with it is recorded, as the plugin publish, before anything is
 * stored.
 */

// Each save's agreement is recorded through its own module (AGL-4105),
// faked here so the route's Firestore double does not have to model it.
jest.mock('./publisher-agreement-acceptance', () => ({
  recordPublisherAgreementAcceptance: jest.fn(async () => ({})),
  publisherAgreementNote: () => ({ version: 'noted' }),
}))
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
      handle: 'acme',
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
      work({
        get: async () => ({ data: () => ({}) }),
        set: () => undefined,
        // The identity claim (AGL-3390) creates its doc in the same kind of
        // transaction.
        create: () => undefined,
      }),
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

async function publish(agreement: unknown = publisherAgreementConsent()) {
  const { res, result } = respond()
  await publishPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        agreement,
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const acceptanceMock = jest.requireMock('./publisher-agreement-acceptance') as {
  recordPublisherAgreementAcceptance: jest.Mock
}

describe('publish-plugin publisher agreement, on every publish (AGL-1077, AGL-4105)', () => {
  const ORIGINAL_BUCKET = process.env.PLUGIN_ARTIFACTS_BUCKET

  beforeAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = 'test-bucket'
  })
  afterAll(() => {
    process.env.PLUGIN_ARTIFACTS_BUCKET = ORIGINAL_BUCKET
  })
  beforeEach(() => {
    adminMock.__versionWrites.length = 0
    acceptanceMock.recordPublisherAgreementAcceptance.mockClear()
    // The org agreed before: a note, which no longer lets a publish through.
    profileMock.__agreement = { version: PUBLISHER_AGREEMENT_VERSION }
  })

  it('refuses a publish that did not tick the box, even from an org that agreed before', async () => {
    const result = await publish(null)
    expect(result.status).toBe(428)
    expect(result.body.error).toBe(PUBLISHER_AGREEMENT_CONSENT_REQUIRED)
    expect(result.body.agreement).toEqual({ required: PUBLISHER_AGREEMENT_VERSION, state: 'missing' })
    // Nothing published, and nothing recorded as agreed.
    expect(adminMock.__versionWrites).toHaveLength(0)
    expect(acceptanceMock.recordPublisherAgreementAcceptance).not.toHaveBeenCalled()
  })

  it('refuses a box ticked for a version no longer in force', async () => {
    const result = await publish({ version: '1999-01-01.1', accepted: true })
    expect(result.status).toBe(409)
    expect(result.body.agreement).toMatchObject({ state: 'outdated', required: PUBLISHER_AGREEMENT_VERSION })
    expect(adminMock.__versionWrites).toHaveLength(0)
  })

  it('names the box, not the per-bundle checklist', async () => {
    // "You did not confirm the checklist" and "you did not agree to the
    // terms" are fixed in different places; the refusal says which.
    const result = await publish({ version: PUBLISHER_AGREEMENT_VERSION, accepted: false })
    expect(result.body.missingAttestations).toBeUndefined()
    expect(result.body.agreement).toMatchObject({ state: 'missing' })
  })

  it('publishes with the box ticked, recording it first, from an org that never agreed before', async () => {
    profileMock.__agreement = undefined
    const result = await publish()
    expect(result.status).toBe(200)
    expect(adminMock.__versionWrites).toHaveLength(1)
    expect(acceptanceMock.recordPublisherAgreementAcceptance).toHaveBeenCalledTimes(1)
    expect(acceptanceMock.recordPublisherAgreementAcceptance.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      uid: 'uid-1',
      action: 'publish-plugin',
      targetId: 'listing-1',
      staff: false,
    })
  })

  it('reads the org\'s note from the accepted version, not from presence', async () => {
    // A record with no version is not an acceptance of anything.
    expect(publisherAgreementState({ acceptedBy: 'uid-1' })).toBe('none')
    expect(publisherAgreementState({ version: '' })).toBe('none')
  })
})
