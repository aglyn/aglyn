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
 * What the export must NOT contain (AGL-1974).
 *
 * The coverage guard next door proves the export reaches everything the
 * erasure does. This file is the other half, and the more dangerous one:
 * answering an access request by handing back too much is itself a breach, and
 * unlike an omission it is irreversible the moment the file leaves.
 *
 * Three failure modes, one case each:
 *
 *  1. **Another person's data.** A member asking what we hold about THEM must
 *     not receive their colleagues' support messages. The org roster is the
 *     same shape and is exported only to the org subject.
 *  2. **A secret re-disclosed.** An `apiKeys` row confirms a credential
 *     exists and never returns it — including its document ID, which is the
 *     SHA-256 of the token. A hash handed back is a verifier handed back.
 *  3. **A silent omission.** A withheld source is reported as a count, so a
 *     collection with nothing to report is distinguishable from one nobody
 *     listed. That distinction is what makes an incomplete export detectable.
 */

import {
  exportFilename,
  exportOrgData,
  exportUserData,
  redactSecrets,
} from './personal-data-export'

/**
 * A Firestore double modelling the behaviours the export depends on: `where`
 * filters by the field it is given (a double that returned everything would
 * hide a missing bound, which is the estate-wide read this code must never
 * do), `exists` distinguishes absent from empty, and `listCollections`
 * enumerates only the subcollections a document actually has.
 */
function fakeDb(seed: {
  /** collection → docId → fields. */
  docs: Record<string, Record<string, Record<string, unknown>>>
  /** parent path → child collection → docId → fields. */
  sub?: Record<string, Record<string, Record<string, Record<string, unknown>>>>
  /** Documents matched by a collectionGroup query, by collection name. */
  group?: Record<string, Array<{ path: string; data: Record<string, unknown> }>>
}) {
  const reads: string[] = []

  const makeDoc = (path: string, collection: string, id: string): any => {
    const fields = seed.docs[collection]?.[id]
    return {
      id,
      path,
      ref: null as any,
      exists: fields !== undefined,
      data: () => fields,
      get: async () => makeDoc(path, collection, id),
      listCollections: async () =>
        Object.keys(seed.sub?.[path] ?? {}).map((child) =>
          makeSubCollection(path, child),
        ),
    }
  }

  const makeSubCollection = (parentPath: string, name: string) => ({
    get: async () => ({
      docs: Object.entries(seed.sub?.[parentPath]?.[name] ?? {}).map(
        ([id, fields]) => {
          const path = `${parentPath}/${name}/${id}`
          const doc: any = {
            id,
            path,
            exists: true,
            data: () => fields,
            get: async () => doc,
            listCollections: async () =>
              Object.keys(seed.sub?.[path] ?? {}).map((child) =>
                makeSubCollection(path, child),
              ),
          }
          doc.ref = doc
          return doc
        },
      ),
    }),
  })

  const db: any = {
    reads,
    collection: (name: string) => ({
      doc: (id: string) => {
        reads.push(`${name}/${id}`)
        const doc = makeDoc(`${name}/${id}`, name, id)
        doc.ref = doc
        return doc
      },
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => {
          reads.push(`${name}?${field}=${String(value)}`)
          const rows = Object.entries(seed.docs[name] ?? {})
            // The bound is REAL. Every one of these collections holds other
            // customers' rows, so a double that ignored `where` would let an
            // unbounded sweep pass its own test.
            .filter(([, fields]) => fields[field] === value)
            .map(([id, fields]) => {
              const path = `${name}/${id}`
              const doc: any = {
                id,
                path,
                exists: true,
                data: () => fields,
                get: async () => doc,
                listCollections: async () =>
                  Object.keys(seed.sub?.[path] ?? {}).map((child) =>
                    makeSubCollection(path, child),
                  ),
              }
              doc.ref = doc
              return doc
            })
          return { docs: rows, size: rows.length }
        },
      }),
    }),
    collectionGroup: (name: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: (seed.group?.[name] ?? [])
            .filter((row) => row.data[field] === value)
            .map((row) => ({ ref: { path: row.path }, data: () => row.data })),
        }),
      }),
    }),
  }
  return db
}

describe('redactSecrets', () => {
  it('replaces a credential with PRESENCE, never content', () => {
    const out = redactSecrets({
      label: 'Zapier',
      secret: 'whsec_live_abc123',
      nested: { clientSecret: 'sk_live_xyz' },
    }) as any
    expect(out.label).toBe('Zapier')
    // Presence, not deletion — "we hold a webhook secret for you" is itself a
    // true and disclosable fact, and a missing key would make the export look
    // like it holds less than it does.
    expect(out.secret).toEqual({ redacted: true, present: true, reason: 'secret' })
    expect(out.nested.clientSecret).toMatchObject({ redacted: true, present: true })
  })

  it('distinguishes an absent secret from a held one', () => {
    const out = redactSecrets({ secret: '' }) as any
    expect(out.secret).toEqual({ redacted: true, present: false, reason: 'secret' })
  })

  it('catches every name the AGL-1443 dump was found to carry', () => {
    // The old erasure export contained exactly these, which is why they are
    // the list. `paymentLinkUrl` is a live bearer URL that lets its holder pay.
    const out = redactSecrets({
      'webhooks.secret': 'x',
      passwordHash: 'x',
      token: 'x',
      paymentLinkUrl: 'https://pay.example/abc',
      apiKey: 'x',
    }) as any
    for (const key of Object.keys(out)) {
      expect([key, out[key].redacted]).toEqual([key, true])
    }
  })

  it('renders a Firestore timestamp as a date a human can read', () => {
    const stamp = { toDate: () => new Date('2026-08-18T00:00:00.000Z') }
    expect(redactSecrets({ at: stamp } as any)).toEqual({
      at: '2026-08-18T00:00:00.000Z',
    })
  })
})

describe('exportUserData', () => {
  const seed = {
    docs: {
      users: { u1: { firstName: 'Zach', phoneNumber: '+15125550000' } },
      profiles: { u1: { handle: 'zach', stripeAccountId: 'acct_1' } },
    },
    sub: {
      'users/u1': {
        orgs: { o1: { role: 'owner', orgName: 'Acme' } },
        passkeys: { k1: { name: 'MacBook' } },
      },
    },
    group: {
      messages: [
        {
          path: 'supportTickets/t1/messages/m1',
          data: { authorId: 'u1', body: 'my invoice is wrong' },
        },
        {
          path: 'supportTickets/t1/messages/m2',
          data: { authorId: 'colleague', body: 'I approved that refund' },
        },
      ],
    },
  }

  it('returns the profile tree AND the subcollections under it', async () => {
    const result = await exportUserData('u1', { firestore: fakeDb(seed) })
    const paths = result.data['users'].map((row) => row.path)
    expect(paths).toContain('users/u1')
    expect(paths).toContain('users/u1/orgs/o1')
    expect(paths).toContain('users/u1/passkeys/k1')
  })

  it('reaches `profiles/{uid}`, which the user tree does NOT', async () => {
    // The AGL-1970 blind spot, on the access side. `recursiveDelete` could not
    // see it either, which is precisely why it is called out.
    const result = await exportUserData('u1', { firestore: fakeDb(seed) })
    expect(result.data['profiles']).toHaveLength(1)
    expect((result.data['profiles'][0].data as any).handle).toBe('zach')
  })

  it('EXCLUDES another person’s support messages', async () => {
    // The disclosure this could most easily become. A thread has other
    // authors; handing a member the whole conversation to answer their own
    // access request discloses colleagues' words to them.
    const result = await exportUserData('u1', { firestore: fakeDb(seed) })
    const bodies = result.data['supportTickets'].map(
      (row) => (row.data as any).body,
    )
    expect(bodies).toEqual(['my invoice is wrong'])
    expect(JSON.stringify(result)).not.toContain('I approved that refund')
  })

  it('does not export the org roster to a person', async () => {
    // The roster is where colleagues' emails live. A person's export carries
    // their own membership row (`users/{uid}/orgs`) and never the org's
    // `members` collection — a different subject with a different
    // authorization.
    const result = await exportUserData('u1', { firestore: fakeDb(seed) })
    expect(Object.keys(result.data)).not.toContain('orgs')
    expect(result.coverage.map((source) => source.collection)).not.toContain(
      'orgs',
    )
  })

  it('names where else we hold data', async () => {
    const result = await exportUserData('u1', { firestore: fakeDb(seed) })
    expect(result.elsewhere.join(' ')).toMatch(/Stripe/)
    expect(result.elsewhere.join(' ')).toMatch(/Resend/)
  })
})

describe('exportOrgData', () => {
  const seed = {
    docs: {
      orgs: { o1: { name: 'Acme', slug: 'acme' } },
      hosts: { h1: { orgId: 'o1', name: 'Site' }, h9: { orgId: 'other', name: 'Theirs' } },
      hostIndex: { h1: { subdomain: 'acme' } },
      apiKeys: {
        'sha256-of-the-token': {
          orgId: 'o1',
          label: 'Zapier',
          scopes: ['read'],
          createdByUid: 'u1',
        },
        'someone-elses': { orgId: 'other', label: 'Theirs' },
      },
      ssoDomains: { 'acme.com': { orgId: 'o1', token: 'sso-secret-value' } },
      consoleDomains: { 'app.acme.com': { orgId: 'o1' } },
      stripeCustomers: { cus_1: { orgId: 'o1' } },
      orgSlugs: { acme: { orgId: 'o1' }, 'acme-old': { orgId: 'o1', movedTo: 'acme' } },
      publisherHandles: { acme: { orgId: 'o1' } },
      publisherProfiles: { o1: { handle: 'acme', bio: 'We build things' } },
      marketplaceListings: { l1: { profileId: 'o1', title: 'Widget' } },
      platformRevenue: { r1: { orgId: 'o1', gross: 1000, tax: 82 } },
      storefrontTaxCollected: { s1: { orgId: 'o1', tax: 12 } },
      supportTickets: { t1: { orgId: 'o1', subject: 'Billing' } },
      apiIdempotency: {
        i1: { orgId: 'o1' },
        i2: { orgId: 'o1' },
        i3: { orgId: 'other' },
      },
    },
    sub: {
      'orgs/o1': { members: { u1: { role: 'owner', email: 'z@acme.com' } } },
      'supportTickets/t1': {
        messages: { m1: { authorEmail: 'z@acme.com', body: 'help' } },
      },
    },
  }

  it('reads every field-keyed collection the erasure sweeps', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    for (const collection of [
      'ssoDomains',
      'consoleDomains',
      'stripeCustomers',
      'publisherHandles',
      'apiKeys',
      'marketplaceListings',
      'platformRevenue',
      'storefrontTaxCollected',
    ]) {
      expect([collection, result.data[collection]?.length]).toEqual([
        collection,
        1,
      ])
    }
    // Every historical name, tombstones included.
    expect(result.data['orgSlugs']).toHaveLength(2)
  })

  it('is BOUNDED — never another customer’s rows', async () => {
    // Each of these collections holds the whole estate's credentials, routing
    // and billing correlations. An unbounded read here is the failure that
    // turns an access request into a breach of everybody else.
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Theirs')
    expect(result.data['hosts'].map((row) => row.path)).not.toContain('hosts/h9')
  })

  it('NEVER re-discloses an API credential, nor its id', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    const [key] = result.data['apiKeys']
    // The facts about the credential: yes.
    expect((key.data as any).label).toBe('Zapier')
    expect((key.data as any).scopes).toEqual(['read'])
    // The credential, or anything that verifies it: no. The document id IS
    // the SHA-256 of the token.
    expect(key.id).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('sha256-of-the-token')
  })

  it('redacts the SSO token while still saying the domain is configured', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    const [row] = result.data['ssoDomains']
    expect(JSON.stringify(result)).not.toContain('sso-secret-value')
    expect((row.data as any).token).toMatchObject({ redacted: true, present: true })
  })

  it('discloses the tax records that SURVIVE an erasure', async () => {
    // The export is the only place a customer can see what erasure left
    // behind. Art. 17(3)(b) exempts these from deletion; nothing exempts them
    // from access.
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    expect((result.data['platformRevenue'][0].data as any).tax).toBe(82)
    expect((result.data['storefrontTaxCollected'][0].data as any).tax).toBe(12)
  })

  it('reports a WITHHELD source as a count rather than omitting it', async () => {
    // A collection that appears in neither the data nor the counts is
    // indistinguishable from one nobody listed, and that ambiguity is what
    // makes an incomplete export undetectable.
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    expect(result.counts['apiIdempotency']).toBe(2)
    expect(result.data['apiIdempotency']).toBeUndefined()
    const withheld = result.coverage.find(
      (source) => source.collection === 'apiIdempotency',
    )
    expect(withheld?.exported).toBe(false)
    expect(withheld?.note.length).toBeGreaterThan(40)
  })

  it('carries the support thread WITH its messages', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    const paths = result.data['supportTickets'].map((row) => row.path)
    expect(paths).toContain('supportTickets/t1')
    expect(paths).toContain('supportTickets/t1/messages/m1')
  })

  it('carries the coverage decisions into the file itself', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    expect(result.coverage.length).toBeGreaterThan(10)
    for (const source of result.coverage) {
      expect([source.collection, source.note.length > 0]).toEqual([
        source.collection,
        true,
      ])
    }
  })
})

describe('exportFilename', () => {
  it('names the subject and the day', () => {
    expect(
      exportFilename({
        subject: { type: 'user', id: 'u1' },
        generatedAt: '2026-08-18T09:00:00.000Z',
      } as any),
    ).toBe('aglyn-user-data-u1-2026-08-18.json')
  })
})
