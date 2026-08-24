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
 * AGL-1888 — who counts as an org owner the IdP cannot lock out.
 *
 * This is the security control, so the NEGATIVES are the point. An org with
 * nobody qualifying must come back empty; every rejection below is a shape
 * that would otherwise read as protection and provide none.
 *
 * The doubles model the semantics that actually matter rather than the whole
 * Admin SDK:
 *
 *  - **two pools, keyed separately.** A fake with one user table could not
 *    tell "outside the pool" from "inside it", which is the entire question.
 *  - **`getUser` throws `auth/user-not-found`** for an absent uid, and a
 *    DIFFERENT code for an outage — the resolver distinguishes them, and a
 *    double that threw one generic error could not prove it does.
 *  - **`where('role','==','owner')` really filters**, so the role gate is
 *    exercised rather than assumed.
 */

interface FakeRecord {
  uid: string
  email?: string | null
  emailVerified?: boolean
  disabled?: boolean
  providerData?: Array<{ providerId: string }>
}

const notFound = () =>
  Object.assign(new Error('no user record'), { code: 'auth/user-not-found' })
const outage = () =>
  Object.assign(new Error('backend unavailable'), {
    code: 'auth/internal-error',
  })

/** uid -> record, per pool. `null` key is the project pool. */
let pools: Record<string, Record<string, FakeRecord>> = {}
/** Pools whose reads should fail with an outage rather than answer. */
let poolOutage = new Set<string>()
/** `orgs/{orgId}/members` for one test: uid -> role. */
let members: Record<string, string> = {}
let membersThrow = false

const PROJECT = '__project__'

jest.mock('./auth-pools', () => ({
  authForPool: (tenantId: string | null) => {
    const key = tenantId ?? PROJECT
    return {
      getUser: async (uid: string) => {
        if (poolOutage.has(key)) throw outage()
        const record = pools[key]?.[uid]
        if (!record) throw notFound()
        return record
      },
    }
  },
  // The real predicate, copied in shape: an address or a provider is what
  // shows a human ever authenticated as this record (AGL-2005).
  isIdentifiedUserRecord: (record: FakeRecord) =>
    Boolean(record?.email) || (record?.providerData?.length ?? 0) > 0,
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              where: (field: string, op: string, value: string) => ({
                get: async () => {
                  if (membersThrow) throw new Error('firestore unavailable')
                  const docs = Object.entries(members)
                    .filter(([, role]) =>
                      field === 'role' && op === '==' ? role === value : true,
                    )
                    .map(([uid]) => ({ id: uid }))
                  return { docs }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { findBreakGlassOrgOwners } from './sso-break-glass-owners'
import { SSO_REQUIRED_DOMAINS_ENV } from './sso-domain-policy'

const SAML = 'saml.acme-okta'
const TENANT = 'acme-org-ab12'
const ORG = 'acme-org'

const record = (over: Partial<FakeRecord> & { uid: string }): FakeRecord => ({
  email: `${over.uid}@acme.com`,
  emailVerified: true,
  disabled: false,
  providerData: [{ providerId: 'password' }],
  ...over,
})

const find = () => findBreakGlassOrgOwners(ORG, SAML, TENANT)

beforeEach(() => {
  pools = { [PROJECT]: {}, [TENANT]: {} }
  poolOutage = new Set()
  members = {}
  membersThrow = false
  delete process.env[SSO_REQUIRED_DOMAINS_ENV]
})

describe('finding an org owner the IdP cannot lock out', () => {
  it('THE POSITIVE: a project-pool owner with a password qualifies', async () => {
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder' })
    const lookup = await find()
    expect(lookup).toEqual({
      owners: [
        {
          uid: 'founder',
          email: 'founder@acme.com',
          providers: ['password'],
        },
      ],
      unavailable: false,
    })
  })

  it('a project-pool social login qualifies too', async () => {
    // The org's SAML application being deleted does not touch a Google link
    // at project level, which is the failure this exists for.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({
      uid: 'founder',
      providerData: [{ providerId: 'google.com' }],
    })
    expect((await find()).owners).toHaveLength(1)
  })

  it('THE NEGATIVE THAT MATTERS: an owner who lives in the POOL does not', async () => {
    // The `aglyn-org` shape, live today: the only owner is the SSO account,
    // holding nothing but the SAML link. Enforcing would strand them.
    members = { founder: 'owner' }
    pools[TENANT]['founder'] = record({
      uid: 'founder',
      providerData: [{ providerId: SAML }],
    })
    expect(await find()).toEqual({ owners: [], unavailable: false })
  })

  it('an ADMIN outside the pool does not count — only an owner', async () => {
    // Narrow by decision. The org can promote them, which is self-serve;
    // widening the role here is not reversible by the customer.
    members = { helper: 'admin', viewer: 'viewer' }
    pools[PROJECT]['helper'] = record({ uid: 'helper' })
    pools[PROJECT]['viewer'] = record({ uid: 'viewer' })
    expect((await find()).owners).toEqual([])
  })

  it('rejects the EMAILLESS TWIN a cross-pool token mint manufactures', async () => {
    // AGL-1962/2005: `signInWithCustomToken` creates the account when the uid
    // is absent, so a project-pool record can exist that nobody can sign in
    // as — no address, no providers. It is precisely what a bare existence
    // check would accept.
    //
    // Rejected by the ADDRESS requirement, not by an `isIdentifiedUserRecord`
    // call: that predicate is strictly weaker than the address and provider
    // requirements, so a call to it here would be a guard no mutation could
    // break. The two cases below hold each half of what actually rejects it.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = {
      uid: 'founder',
      email: null,
      providerData: [],
    }
    expect((await find()).owners).toEqual([])
  })

  it('rejects an owner with a credential but NO email address', async () => {
    // ADDED BECAUSE A MUTATION SURVIVED WITHOUT IT. Dropping the `!record.
    // email` half passed every other case, because the twin above is caught
    // by the provider requirement instead. This is the shape where the two
    // diverge: a phone-only project-pool account, which really can sign in —
    // and still cannot reach an organization setting, because the console
    // gates every one of them on a verified EMAIL. It would look like a
    // break-glass owner and be unable to turn enforcement off.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({
      uid: 'founder',
      email: null,
      emailVerified: false,
      providerData: [{ providerId: 'phone' }],
    })
    expect((await find()).owners).toEqual([])
  })

  it('rejects a project-pool record with NO sign-in provider at all', async () => {
    // The other half of the twin's shape, isolated: an address alone is not a
    // credential. A custom-token-only record can look like this, and it has
    // no interactive way in.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder', providerData: [] })
    expect((await find()).owners).toEqual([])
  })

  it('rejects a uid that is in BOTH pools', async () => {
    // The same collision from the other side. The sweep will touch the pool
    // copy, and "which record is this owner" has no answer at the moment it
    // matters most.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder' })
    pools[TENANT]['founder'] = record({
      uid: 'founder',
      providerData: [{ providerId: SAML }],
    })
    expect((await find()).owners).toEqual([])
  })

  it('rejects a disabled owner', async () => {
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder', disabled: true })
    expect((await find()).owners).toEqual([])
  })

  it('rejects an owner whose address is not verified', async () => {
    // The console refuses an unverified session before any org setting, so
    // this account could not turn enforcement back off — which is the whole
    // job. A credential that cannot be used is not a credential.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder', emailVerified: false })
    expect((await find()).owners).toEqual([])
  })

  it('rejects a project-pool record holding ONLY the org’s own IdP', async () => {
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({
      uid: 'founder',
      providerData: [{ providerId: SAML }],
    })
    expect((await find()).owners).toEqual([])
  })

  it('rejects an owner on a domain the OPERATOR requires SSO for', async () => {
    // The subtle one. A project-pool `@acme.com` password is a fine
    // credential right up until `AGLYN_SSO_DOMAIN_ENFORCEMENT` is switched
    // on, at which point that identity is refused at sign-in and the
    // break-glass account silently stops being one. Read from the rule, not
    // from today's switch.
    process.env[SSO_REQUIRED_DOMAINS_ENV] = `acme.com=${TENANT}`
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder' })
    expect((await find()).owners).toEqual([])
  })

  it('and still counts an owner on an UNGOVERNED domain', async () => {
    // The positive control for the rule above: it is the domain that decides,
    // not the presence of the setting.
    process.env[SSO_REQUIRED_DOMAINS_ENV] = `acme.com=${TENANT}`
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({
      uid: 'founder',
      email: 'founder@personal.example',
    })
    expect((await find()).owners).toHaveLength(1)
  })

  it('FAILS SAFE when the owner roster cannot be read', async () => {
    membersThrow = true
    expect(await find()).toEqual({ owners: [], unavailable: true })
  })

  it('FAILS SAFE, and says so, when the project pool is unreachable', async () => {
    // An outage is not a clean negative. `unavailable` is what lets the
    // refusal say "we could not check" instead of "you have nobody" — a
    // swallowed query rendering as a measured zero is the worse bug, because
    // nothing about it looks wrong.
    members = { founder: 'owner' }
    poolOutage.add(PROJECT)
    expect(await find()).toEqual({ owners: [], unavailable: true })
  })

  it('an absent uid is a clean negative, NOT an outage', async () => {
    // The other half of the same distinction: `auth/user-not-found` is the
    // ordinary answer for an owner who signs in through the IdP, and must
    // not be reported as a failed check.
    members = { founder: 'owner' }
    expect(await find()).toEqual({ owners: [], unavailable: false })
  })

  it('a tenant-pool outage disqualifies the candidate rather than passing it', async () => {
    // We could not establish that the uid is absent from the pool, so the
    // collision above cannot be ruled out. Refuse and report.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({ uid: 'founder' })
    poolOutage.add(TENANT)
    expect(await find()).toEqual({ owners: [], unavailable: true })
  })

  it('returns every qualifying owner, so the card can name them', async () => {
    members = { founder: 'owner', second: 'owner', helper: 'admin' }
    pools[PROJECT]['founder'] = record({ uid: 'founder' })
    pools[PROJECT]['second'] = record({ uid: 'second' })
    pools[PROJECT]['helper'] = record({ uid: 'helper' })
    expect((await find()).owners.map((owner) => owner.uid)).toEqual([
      'founder',
      'second',
    ])
  })

  it('strips the org’s IdP from the providers it reports', async () => {
    // A project-pool record could in principle carry both. Reporting the SAML
    // link as a surviving credential would describe the protection as coming
    // from the thing that just failed.
    members = { founder: 'owner' }
    pools[PROJECT]['founder'] = record({
      uid: 'founder',
      providerData: [{ providerId: SAML }, { providerId: 'password' }],
    })
    expect((await find()).owners[0].providers).toEqual(['password'])
  })
})
