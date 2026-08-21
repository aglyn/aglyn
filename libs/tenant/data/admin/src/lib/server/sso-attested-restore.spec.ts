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
 * PART 2 HAS LANDED (AGL-1887), and the `it.failing` marker this file was
 * built around is gone. The representation is a claim document carrying
 * `attestedBy` — a named staff member vouching — written by `attestSsoDomain`
 * and read by `publishSsoDomains` alongside `verified === true`.
 *
 * ⚠️ The way NOT to have made it pass was to let `publishSsoDomains` accept a
 * domain with neither marker, or to infer permission from a routing doc that
 * already names the org. Either would stop `unpublish` being final and let a
 * domain whose claim was revoked come back. The cases at the bottom pin that
 * boundary: an unverified claim is still refused, and an `attestedBy` that is
 * blank, or truthy-but-not-a-string, is not an attestation by anybody.
 *
 * The attestation is trustworthy only because nothing a customer can reach
 * writes it: `orgs/{orgId}/ssoDomains/{domain}` is deny-all for clients in the
 * Firestore rules, and `issueDomainClaim` — the one claim writer on the org's
 * own path — never sets the field. The last case here holds that.
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

import {
  attestSsoDomain,
  isStaffAttestedClaim,
  issueDomainClaim,
  publishSsoDomains,
  unpublishSsoDomains,
} from './sso-provisioning'

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

  it('restores an attested org too, once the attestation exists', async () => {
    // PART 2, and the `.failing` marker this case carried is gone.
    //
    // The representation is a claim document holding `attestedBy` — a named
    // staff member vouching — written by `attestSsoDomain`. Note it does NOT
    // set `verified`: DNS proof and a person vouching are different facts and
    // the data keeps them apart.
    seedAttestedOrg()
    const attested = await attestSsoDomain({
      orgId: ORG,
      domain: DOMAIN,
      attestedByUid: 'staff-uid-1',
      note: 'Onboarded by hand before self-serve; ownership checked 2026-07.',
    })
    expect(attested).toEqual({ domain: DOMAIN, error: null })
    expect(mockDocs.get(`orgs/${ORG}/ssoDomains/${DOMAIN}`)).toMatchObject({
      attestedBy: 'staff-uid-1',
    })
    expect(
      mockDocs.get(`orgs/${ORG}/ssoDomains/${DOMAIN}`)?.['verified'],
    ).toBeUndefined()

    await unpublishSsoDomains(ORG)
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(false)

    // The door opens both ways now.
    expect(await publish()).toEqual([DOMAIN])
    expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(true)
  })

  it('an attestation SURVIVES the round trip, so it is not single-use', async () => {
    // Off, on, off, on. A fix that consumed the attestation — or that leaned
    // on the routing doc still being there — would pass the case above and
    // strand the org on the second cycle, which is the harder failure to see.
    seedAttestedOrg()
    await attestSsoDomain({
      orgId: ORG,
      domain: DOMAIN,
      attestedByUid: 'staff-uid-1',
    })
    for (const _ of [1, 2]) {
      await unpublishSsoDomains(ORG)
      expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(false)
      expect(await publish()).toEqual([DOMAIN])
      expect(mockDocs.get(`ssoDomains/${DOMAIN}`)?.['active']).toBe(true)
    }
  })

  it('is still stranded when NOTHING was attested — the backfill is real work', async () => {
    // The honest statement of what part 2 does and does not do. Accepting
    // `attestedBy` fixes the MECHANISM; an org that has no claim document at
    // all still cannot publish, because there is nothing saying anyone ever
    // checked. The rejected alternative — inferring permission from a routing
    // doc that already names this org — is what would have made this case
    // pass, and it makes `unpublish` non-final for everybody.
    //
    // So a real org is unstranded by RUNNING `attestSsoDomain` against it, not
    // by deploying this commit. `aglyn-org` is the one that needs it.
    seedAttestedOrg()
    await unpublishSsoDomains(ORG)
    expect(await publish()).toEqual([])
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

describe('what an attestation is, and is not', () => {
  beforeEach(() => {
    mockDocs.clear()
  })

  it('refuses an attestedBy that is blank or not a string', () => {
    // A field satisfiable by any truthy value is one a careless future write
    // satisfies by accident. `true` is not a person.
    for (const value of [true, 1, {}, [], null, undefined, '', '   ']) {
      expect([value, isStaffAttestedClaim(value)]).toEqual([value, false])
    }
    expect(isStaffAttestedClaim('staff-uid-1')).toBe(true)
  })

  it('does not publish on a truthy-but-not-string attestedBy', () => {
    // The same rule, reached through the real publish path rather than the
    // predicate — a refactor could keep the predicate and stop calling it.
    mockDocs.set(`orgs/${ORG}`, { sso: { domains: [DOMAIN] } })
    mockDocs.set(`orgs/${ORG}/ssoDomains/${DOMAIN}`, {
      domain: DOMAIN,
      verified: false,
      attestedBy: true,
    })
    return publish().then((published) => {
      expect(published).toEqual([])
      expect(mockDocs.has(`ssoDomains/${DOMAIN}`)).toBe(false)
    })
  })

  it('requires the attesting staff uid', async () => {
    expect(
      await attestSsoDomain({ orgId: ORG, domain: DOMAIN, attestedByUid: '  ' }),
    ).toMatchObject({ domain: null })
    expect(mockDocs.has(`orgs/${ORG}/ssoDomains/${DOMAIN}`)).toBe(false)
  })

  it('cannot attest a domain another org already routes', async () => {
    // An attestation must not be a way around "one domain, one org". The
    // conflict is for a human to resolve before anything is written, not for
    // whoever attests last to win.
    mockDocs.set(`ssoDomains/${DOMAIN}`, { orgId: 'someone-else', active: true })
    const result = await attestSsoDomain({
      orgId: ORG,
      domain: DOMAIN,
      attestedByUid: 'staff-uid-1',
    })
    expect(result.domain).toBeNull()
    expect(result.error).toMatch(/another organization/i)
    expect(mockDocs.has(`orgs/${ORG}/ssoDomains/${DOMAIN}`)).toBe(false)
  })

  it('keeps a token and a verified state it did not create', async () => {
    // Merge, not overwrite. An org midway through proving a domain by DNS
    // must not have its claim reset by an attestation landing on top.
    mockDocs.set(`orgs/${ORG}/ssoDomains/${DOMAIN}`, {
      domain: DOMAIN,
      token: 'tok',
      verified: true,
    })
    await attestSsoDomain({
      orgId: ORG,
      domain: DOMAIN,
      attestedByUid: 'staff-uid-1',
    })
    expect(mockDocs.get(`orgs/${ORG}/ssoDomains/${DOMAIN}`)).toMatchObject({
      token: 'tok',
      verified: true,
      attestedBy: 'staff-uid-1',
    })
  })

  it('THE HOLE THIS MUST NOT BE: the customer claim path cannot self-attest', async () => {
    // `issueDomainClaim` is what an org admin reaches through
    // `/api/orgs/sso` → `add-domain`. If it ever wrote `attestedBy`, any org
    // could publish routing for any domain by asking for it — which is the
    // whole account-takeover vector, handed over through the front door.
    const { claim } = await issueDomainClaim(ORG, DOMAIN)
    expect(claim?.domain).toBe(DOMAIN)
    const stored = mockDocs.get(`orgs/${ORG}/ssoDomains/${DOMAIN}`) ?? {}
    expect(stored['attestedBy']).toBeUndefined()
    expect(stored['verified']).toBe(false)
    expect(await publish()).toEqual([])
  })
})
