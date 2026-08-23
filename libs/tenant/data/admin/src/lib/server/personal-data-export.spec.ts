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

import { createHmac, scryptSync, randomBytes } from 'node:crypto'
import {
  exportFilename,
  exportOrgData,
  exportUserData,
  fieldNameTokens,
  looksLikeCredential,
  redactSecrets,
  scrubUrlCredentials,
  secretByName,
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

/**
 * The AGL-1881 finding, and the shape of the fix.
 *
 * The old redactor was a denylist of names anchored on separators, so it read
 * `password_hash` and missed `passwordScrypt`, read `webhooks.secret` and
 * missed `supplierToken`. Those two are not hypothetical: `supplierToken` is
 * the live bearer credential a dropship supplier authenticates an order
 * update with (`billing-webhook.ts`, HMAC-SHA256 truncated to 32 hex), and
 * `passwordScrypt` is a shopper's password hash (`membership.ts`,
 * `{salt}:{scrypt}`). Both live under `hosts/{hostId}/…`, which the org
 * export walks whole.
 *
 * Every case below therefore carries a REAL credential value, produced the
 * same way the producing module produces it. A fixture that never carries a
 * secret proves a redactor works the way an empty inbox proves a spam filter
 * works — which is exactly the failure mode the review found five times in
 * its own suite.
 */
describe('redactSecrets — camelCase names and credential shapes', () => {
  /** As `libs/plugins/commerce/src/lib/server/billing-webhook.ts` mints it. */
  const supplierToken = createHmac('sha256', 'signing-secret')
    .update('h1:ord_1:sup_1')
    .digest('hex')
    .slice(0, 32)
  /** As `libs/plugins/commerce/src/lib/server/membership.ts` stores it. */
  const salt = randomBytes(16).toString('hex')
  const passwordScrypt = `${salt}:${scryptSync('hunter2', salt, 64).toString('hex')}`

  it('produces fixtures with the shape the real producers emit', () => {
    // The guard on the guard. If `billing-webhook` ever stops truncating, or
    // `membership` moves off scrypt, these fixtures silently stop resembling
    // the thing under test and every assertion below becomes decorative.
    expect(supplierToken).toMatch(/^[0-9a-f]{32}$/)
    expect(passwordScrypt).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
  })

  it('redacts a camelCase credential the old separator denylist missed', () => {
    const out = redactSecrets({ supplierToken, passwordScrypt }) as any
    expect(out.supplierToken).toEqual({
      redacted: true,
      present: true,
      reason: 'secret',
    })
    expect(out.passwordScrypt).toEqual({
      redacted: true,
      present: true,
      reason: 'secret',
    })
  })

  it('reads every naming convention as the same field', () => {
    // The point of tokenizing: the convention stops being load-bearing.
    for (const name of [
      'supplierToken',
      'supplier_token',
      'SUPPLIER-TOKEN',
      'Supplier.Token',
      'supplierToken2',
      'hostSupplierTokenValue',
    ]) {
      expect([name, secretByName(name, 'x')]).toEqual([name, true])
    }
    expect(fieldNameTokens('SSOTokenId')).toEqual(['sso', 'token', 'id'])
  })

  it('catches the SHAPE even when the field name says nothing', () => {
    // The half a denylist can never have. Whatever a customer, a plugin or
    // next quarter's schema calls the field, the VALUE is still a credential.
    //
    // The Stripe prefix is ASSEMBLED rather than written out. GitHub's push
    // protection matches `sk_live_` followed by a key-shaped body and blocks
    // the push — correctly, since it cannot know a literal is invented. The
    // value handed to the redactor is byte-for-byte what the literal was, so
    // the assertion is unchanged; only the source text is.
    const stripeishKey = ['sk', 'live', 'AbCdEfGhIjKlMnOpQrStUvWx0123'].join('_')
    const out = redactSecrets({
      notes: supplierToken,
      v: passwordScrypt,
      blob: stripeishKey,
      jot: 'eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ1MSJ9.c2lnbmF0dXJlLXZhbHVl',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----',
      legacy: '$2b$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012',
    }) as any
    for (const key of ['notes', 'v', 'blob', 'jot', 'pem', 'legacy']) {
      expect([key, out[key]?.redacted]).toEqual([key, true])
    }
  })

  it('detects each shape on its own, not only through the redactor', () => {
    // Tested limb by limb: a shape detector exercised only through the
    // redactor is one whose gaps are invisible.
    expect(looksLikeCredential(supplierToken)).toBe(true)
    expect(looksLikeCredential(passwordScrypt)).toBe(true)
    expect(looksLikeCredential('whsec_9f8e7d6c5b4a39281706')).toBe(true)
    expect(looksLikeCredential('AKIAIOSFODNN7EXAMPLE')).toBe(true)
    expect(looksLikeCredential('$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA')).toBe(
      true,
    )
    // …and the negative control, without which the above would pass on a
    // detector that simply returned true.
    expect(looksLikeCredential('Dana Shopper')).toBe(false)
    expect(looksLikeCredential('https://acme.example/products/blue-widget')).toBe(
      false,
    )
    expect(looksLikeCredential('')).toBe(false)
  })

  it('does NOT gut the export — content, prose and ids survive', () => {
    // The counterweight. "Redact everything" would pass every assertion
    // above and destroy the feature, so the useful half is pinned too.
    const out = redactSecrets({
      buyerEmail: 'dana@example.com',
      shipTo: '1 Main St, Austin TX',
      total: 4200,
      publicKey: 'pQECAyYgASFYIH1234567890abcdefghijklmnopqrstuvwxyzABCD',
      contentSha256:
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      etag: 'a5b3c1d4e6f7a8b9c0d1e2f3a4b5c6d7',
      storagePath: 'orgs/o1/media/2026/08/photo-of-the-team-at-the-picnic.jpg',
      body: 'We noticed the invoice total did not match the order total.',
      dataUri: `data:image/png;base64,${'A'.repeat(400)}`,
      tokensUsed: 14203,
      tokenBudgetExceeded: false,
    }) as any
    expect(out.buyerEmail).toBe('dana@example.com')
    expect(out.shipTo).toBe('1 Main St, Austin TX')
    expect(out.total).toBe(4200)
    // A passkey's public key is public, and a SHA-256 has exactly the shape
    // of a 64-character secret without being one.
    expect(typeof out.publicKey).toBe('string')
    expect(typeof out.contentSha256).toBe('string')
    expect(typeof out.etag).toBe('string')
    expect(out.storagePath).toContain('photo-of-the-team')
    expect(out.body).toContain('invoice total')
    expect(out.dataUri).toContain('data:image/png')
    // The metering carve-out: a token COUNT is a disclosure, not a credential.
    expect(out.tokensUsed).toBe(14203)
    expect(out.tokenBudgetExceeded).toBe(false)
  })

  it('strips a credential OUT of a URL and keeps the URL', () => {
    // A media object's `url` is a live unauthenticated download credential in
    // a query parameter, and where the customer's own file lives is exactly
    // what an access request asks for. Blanking it answers nothing.
    const out = redactSecrets({
      url: 'https://firebasestorage.googleapis.com/v0/b/b/o/orgs%2Fo1%2Fa.jpg?alt=media&token=8b1f0c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e',
      updateUrl: `https://acme.example/api/commerce/supplier-update?hostId=h1&orderId=ord_1&token=${supplierToken}`,
    }) as any
    expect(out.url).toContain('orgs%2Fo1%2Fa.jpg')
    expect(out.url).toContain('alt=media')
    expect(out.url).not.toContain('8b1f0c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e')
    expect(out.updateUrl).toContain('orderId=ord_1')
    expect(out.updateUrl).not.toContain(supplierToken)
    expect(scrubUrlCredentials('not a url at all')).toBe('not a url at all')
  })

  it('still distinguishes an absent credential from a held one', () => {
    expect(redactSecrets({ supplierToken: '' }) as any).toEqual({
      supplierToken: { redacted: true, present: false, reason: 'secret' },
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

/**
 * Real credential values, produced the way the producing modules produce
 * them, for the end-to-end export proof below. Module scope so the assertion
 * and the seed cannot drift apart into two different strings — which is the
 * only way a "the secret is not in the file" test can pass vacuously.
 */
const LIVE_SUPPLIER_TOKEN = createHmac('sha256', 'signing-secret')
  .update('h1:ord_1:sup_1')
  .digest('hex')
  .slice(0, 32)
const LIVE_SCRYPT_SALT = randomBytes(16).toString('hex')
const LIVE_PASSWORD_SCRYPT = `${LIVE_SCRYPT_SALT}:${scryptSync(
  'hunter2',
  LIVE_SCRYPT_SALT,
  64,
).toString('hex')}`

describe('exportOrgData', () => {
  const seed = {
    docs: {
      orgs: { o1: { name: 'Acme', slug: 'acme' } },
      hosts: { h1: { orgId: 'o1', name: 'Site' }, h9: { orgId: 'other', name: 'Theirs' } },
      hostIndex: { h1: { subdomain: 'acme' } },
      supplierDeliveries: {
        d1: {
          hostId: 'h1',
          status: 'failed',
          body: {
            buyerName: 'Dana Shopper',
            buyerEmail: 'dana@example.com',
            shipTo: '1 Main St',
          },
        },
        d9: { hostId: 'h9', body: { buyerName: 'Theirs' } },
      },
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
      // The AGL-1881 credentials, in the tree the org export walks whole.
      // `hosts/{h}/orders` carries the supplier's live bearer token and
      // `hosts/{h}/members` carries a shopper's password hash, both under
      // camelCase names the old separator-anchored denylist could not see.
      'hosts/h1': {
        orders: {
          ord_1: {
            total: 4200,
            buyerEmail: 'dana@example.com',
            supplierToken: LIVE_SUPPLIER_TOKEN,
            updateUrl: `https://acme.example/api/commerce/supplier-update?hostId=h1&orderId=ord_1&token=${LIVE_SUPPLIER_TOKEN}`,
          },
        },
        members: {
          mem_1: {
            email: 'dana@example.com',
            displayName: 'Dana Shopper',
            passwordScrypt: LIVE_PASSWORD_SCRYPT,
          },
        },
      },
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

  it('DISCLOSES the dropship outbox, and reads it rather than claiming it', async () => {
    // The AGL-1448 sweep destroys these rows, so the export has to produce
    // them — and a coverage entry is a promise, not a read. This asserts the
    // read: a `PERSONAL_DATA_SOURCES` row for a collection `exportOrgData`
    // never touches is an under-disclosure with documentation on top.
    //
    // It is also the one source whose personal data is a THIRD PARTY's, which
    // is why the shopper's own fields are named here: the merchant is the
    // controller of them and an org access request is entitled to them, so
    // silently thinning the body would be a second, quieter omission.
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    expect(result.data['supplierDeliveries']).toHaveLength(1)
    expect(result.data['supplierDeliveries'][0].data).toMatchObject({
      body: { buyerEmail: 'dana@example.com', shipTo: '1 Main St' },
    })
    // Bounded by `hostId`, the same field `eraseHostSupplierDeliveries` sweeps
    // by — this collection holds every other merchant's orders.
    expect(JSON.stringify(result.data['supplierDeliveries'])).not.toContain(
      'Theirs',
    )
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

  /**
   * THE END-TO-END PROOF (AGL-1881).
   *
   * A unit test on the redactor is not the same as proving the export path
   * calls it. This one generates a real org export whose host tree carries a
   * live `supplierToken` and a real `passwordScrypt` hash, serializes the
   * whole file the customer downloads, and asserts neither string survives —
   * the literal values, not a pattern that might match something else.
   */
  it('SHIPS NEITHER a supplierToken NOR a passwordScrypt hash', async () => {
    const result = await exportOrgData('o1', { firestore: fakeDb(seed) })
    const file = JSON.stringify(result)

    // The credentials themselves — gone, and gone from the URL that carried
    // one as a query parameter too.
    expect(file).not.toContain(LIVE_SUPPLIER_TOKEN)
    expect(file).not.toContain(LIVE_PASSWORD_SCRYPT)
    expect(file).not.toContain(LIVE_SCRYPT_SALT)

    // …and the export is still an export. Without this half, deleting the
    // host walk entirely would pass the three assertions above.
    const order = result.data['hosts'].find(
      (row) => row.path === 'hosts/h1/orders/ord_1',
    )
    expect(order).toBeDefined()
    expect((order?.data as any).total).toBe(4200)
    expect((order?.data as any).buyerEmail).toBe('dana@example.com')
    expect((order?.data as any).supplierToken).toEqual({
      redacted: true,
      present: true,
      reason: 'secret',
    })
    expect((order?.data as any).updateUrl).toContain('orderId=ord_1')

    const member = result.data['hosts'].find(
      (row) => row.path === 'hosts/h1/members/mem_1',
    )
    expect(member).toBeDefined()
    expect((member?.data as any).displayName).toBe('Dana Shopper')
    expect((member?.data as any).passwordScrypt).toMatchObject({
      redacted: true,
      present: true,
    })
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
