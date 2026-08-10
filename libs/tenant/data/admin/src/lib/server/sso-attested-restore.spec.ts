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
 */

/**
 * AGL-1375: turning SSO off must not be a one-way door.
 *
 * An org onboarded before self-serve has its domain written straight onto
 * `sso.domains` by a staff attestation, with no claim document behind it.
 * `unpublishSsoDomains` deactivates its routing doc happily; `publishSsoDomains`
 * then refuses to bring it back, because it re-reads the claim and finds
 * nothing verified. Off works, on does not, and for `aglyn-org` the owner's
 * only credential lives inside the pool that stops answering.
 *
 * The round trip below is the whole issue in one test. It is RED on purpose:
 * part 1 (the card's gate) stops anyone walking through the door, and only
 * part 2 — a representation for a staff attestation that the publish path can
 * recognise — can make it green. `it.failing` keeps that honest in both
 * directions: the suite stays green while the gap is open, and the moment
 * part 2 lands this case fails until the `.failing` is removed.
 *
 * ⚠️ The way NOT to make it pass is to let `publishSsoDomains` accept a domain
 * without `verified === true`. That check is what stops an org routing another
 * company's sign-ins to its own IdP. The last case here pins it.
 */

/** Every document, keyed by its full path. */
const mockDocs = new Map<string, Record<string, unknown>>()

const mockRef = (path: string) => ({
  path,
  get: async () => ({
    exists: mockDocs.has(path),
    get: (field: string) => mockDocs.get(path)?.[field],
    data: () => mockDocs.get(path),
    ref: mockRef(path),
  }),
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockDocs.set(
      path,
      options?.merge ? { ...mockDocs.get(path), ...data } : data,
    )
  },
  delete: async () => {
    mockDocs.delete(path)
  },
  collection: (name: string) => mockCollection(`${path}/${name}`),
})

const mockCollection = (path: string) => ({
  doc: (id: string) => mockRef(`${path}/${id}`),
  where: (field: string, _op: string, value: unknown) => ({
    get: async () => {
      const matched = [...mockDocs.entries()].filter(
        ([key, data]) =>
          key.startsWith(`${path}/`) &&
          !key.slice(path.length + 1).includes('/') &&
          data[field] === value,
      )
      return {
        empty: matched.length === 0,
        docs: matched.map(([key]) => ({
          id: key.split('/').pop(),
          ref: mockRef(key),
          data: () => mockDocs.get(key),
        })),
      }
    },
  }),
})

const mockFirestore = {
  collection: (name: string) => mockCollection(name),
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    return {
      set: (
        ref: ReturnType<typeof mockRef>,
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => writes.push(() => ref.set(data, options)),
      commit: async () => {
        for (const write of writes) await write()
      },
    }
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ auth: () => ({}), firestore: () => mockFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'server-timestamp',
        delete: () => 'delete-sentinel',
        arrayUnion: (...values: unknown[]) => values,
        arrayRemove: () => [],
      },
    },
  },
}))

import { publishSsoDomains, unpublishSsoDomains } from './sso-provisioning'

const ORG = 'aglyn-org'
const DOMAIN = 'aglyn.com'

const publish = () =>
  publishSsoDomains({
    orgId: ORG,
    tenantId: 'aglyn-org-y5v14',
    providerId: 'saml.aglyn',
    protocol: 'saml',
    displayName: 'Aglyn SSO',
    domains: [DOMAIN],
  })

/** An org configured by hand: live routing doc, no claim document at all. */
const seedAttestedOrg = () => {
  mockDocs.set(`orgs/${ORG}`, {
    sso: { domains: [DOMAIN], status: 'active', domainVerified: true },
  })
  mockDocs.set(`ssoDomains/${DOMAIN}`, {
    orgId: ORG,
    tenantId: 'aglyn-org-y5v14',
    providerId: 'saml.aglyn',
    protocol: 'saml',
    active: true,
  })
}

beforeEach(() => {
  mockDocs.clear()
})

describe('SSO off-and-on round trip', () => {
  it('restores a verified org, because its claim is still there', async () => {
    // The control. Everything about the round trip works for a self-serve org,
    // which is why the gap only shows up on the ones onboarded by hand.
    seedAttestedOrg()
    mockDocs.set(`orgs/${ORG}/ssoDomains/${DOMAIN}`, {
      domain: DOMAIN,
      token: 'tok',
      verified: true,
    })

    await unpublishSsoDomains(ORG)
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(false)

    expect(await publish()).toEqual([DOMAIN])
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(true)
  })

  // RED UNTIL PART 2 (see the header). `it.failing` passes while the body
  // throws; when a staff attestation finally has a representation the publish
  // path recognises, this case starts passing and jest will report it as a
  // failure until the `.failing` comes off.
  it.failing('restores an attested org too', async () => {
    seedAttestedOrg()

    await unpublishSsoDomains(ORG)
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(false)

    // Today: `published` is [], and the route turns that into
    // 400 "No verified domains to publish". SSO is now off with no way back.
    expect(await publish()).toEqual([DOMAIN])
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(true)
  })

  it('never publishes a domain whose claim is unverified', async () => {
    // The boundary part 2 must not cross. An org that merely ASKED for a
    // domain — a claim document with `verified: false` — has proved nothing,
    // and a fix that made the attested case pass by relaxing this check would
    // hand any org the ability to intercept another company's sign-ins.
    mockDocs.set(`orgs/${ORG}`, { sso: { domains: [DOMAIN] } })
    mockDocs.set(`orgs/${ORG}/ssoDomains/${DOMAIN}`, {
      domain: DOMAIN,
      token: 'tok',
      verified: false,
    })

    expect(await publish()).toEqual([])
    expect(mockDocs.has(`ssoDomains/${DOMAIN}`)).toBe(false)
  })
})
