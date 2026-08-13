/**
 * @jest-environment node
 */

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
 * An erasure leaves no copy of the workspace behind (AGL-1443).
 *
 * `eraseOrg` used to write `erasures/{orgId}/{requestedMs}.json` — and the
 * name understated it. `exportDocTree` recursed `listCollections()` with no
 * bound and copied `snapshot.data()` wholesale, so the object was a complete
 * verbatim copy of the org tree and every host tree: no counts, no summary,
 * not a manifest. It carried `webhooks.secret` (a plaintext HMAC key),
 * `orders.paymentLinkUrl` (a live bearer URL that lets its holder pay),
 * `screens.protection.passwordHash` and `ssoDomains.token`. A retained dump
 * is a file of WORKING CREDENTIALS belonging to a customer who has been told
 * their workspace is gone — and it landed on a prefix the erasure's own
 * storage sweep does not touch, in a bucket with no lifecycle rule.
 *
 * Both probes below are therefore seeded on purpose: `PII_PROBE` for the
 * personal data and `CREDENTIAL_PROBE` for the secret, because they are two
 * different arguments and only the second one is unarguable.
 *
 * The proof of erasure is NOT lost with it. `adminAudit`'s `org.erased` row
 * is written independently and is ids and counts — actor, action, target,
 * the inventory found, and what each sweep destroyed. That row already was
 * "the minimum that proves the erasure happened"; the dump was a second,
 * ungoverned full copy on top of a governed one (weekly Firestore backups,
 * 14-week retention). The one thing the object's NAME carried and the row did
 * not — which erasure request this run fulfilled — moves into the row as
 * `after.requestedAt`.
 *
 * Storage is STUBBED, deliberately and non-negotiably, as in every other
 * erasure spec: there is no Storage emulator and the admin app is initialized
 * with a real service-account credential, so an unstubbed `eraseOrg` writes
 * to — and runs `deleteFiles` against — the PRODUCTION bucket. Here the stub
 * is also the instrument: it records every `save`, PAYLOAD INCLUDED, which is
 * what lets this assert on the bytes rather than on the path.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-export.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-erase-export-org'
const HOST = 'e2e-erase-export-host'
const MEMBER_UID = 'e2e-erase-export-uid'

/** Personal data. Seeded in the org tree in two places. */
const PII_PROBE = 'erasure-export-fixture@example.invalid'
/**
 * A secret. The shape that makes a retained dump worse than a retained
 * record: `webhooks.secret` still signs, and it belongs to a customer whose
 * workspace no longer exists to rotate it from.
 */
const CREDENTIAL_PROBE = 'whsec-erasure-export-fixture-not-a-real-key'

// Before any module reads them: neither integration may be reachable from a
// fixture, and localhost carries the LIVE Stripe key.
delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/**
 * No Storage emulator, and the default app holds a production credential —
 * so every bucket call is a recorder here. The payload is kept, not just the
 * path: the claim is about what the bytes contain, and a spec that only
 * watched paths would pass on a dump written somewhere else.
 */
const mockSaved: Array<{ path: string; body: string }> = []
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        save: async (body: unknown) => {
          mockSaved.push({ path, body: String(body) })
        },
      }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('an org erasure persists no copy of the workspace (AGL-1443)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let result: import('./erase').EraseOrgResult
  let requestedAt = 0

  /** Every URL the run addressed to Stripe. Must stay empty. */
  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  const auditRows = async () => {
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${ORG}`)
      .get()
    return rows.docs.map((doc) => doc.data())
  }

  async function purge(): Promise<void> {
    const keys = await db.collection('apiKeys').where('orgId', '==', ORG).get()
    await Promise.all(keys.docs.map((doc) => doc.ref.delete()))
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${ORG}`)
      .get()
    await Promise.all(rows.docs.map((doc) => doc.ref.delete()))
    await db.collection('hostIndex').doc(HOST).delete().catch(() => undefined)
    await db.recursiveDelete(db.collection('hosts').doc(HOST))
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.recursiveDelete(db.collection('users').doc(MEMBER_UID))
  }

  /**
   * A workspace with personal data, a live secret and a credential, whose
   * hold has elapsed — without that last part `eraseOrg` skips on
   * `hold-active` and every assertion below passes for the wrong reason.
   */
  async function seed(): Promise<void> {
    requestedAt = Date.now() - erase.ERASURE_HOLD_MS - 60_000
    const orgRef = db.collection('orgs').doc(ORG)
    await orgRef.set({
      name: 'Erasure Export Fixture',
      erasureRequestedAt: Timestamp.fromMillis(requestedAt),
    })
    await orgRef.collection('members').doc(MEMBER_UID).set({
      email: PII_PROBE,
      role: 'owner',
    })
    await orgRef
      .collection('datasets')
      .doc('contacts')
      .set({ name: 'Contacts', primaryContact: PII_PROBE })
    await db
      .collection('users')
      .doc(MEMBER_UID)
      .collection('orgs')
      .doc(ORG)
      .set({ role: 'owner' })

    const hostRef = db.collection('hosts').doc(HOST)
    await hostRef.set({ orgId: ORG, displayName: 'Fixture Site' })
    // The two fields that make the dump a credential file rather than a
    // record: an HMAC key that still signs, and a URL that still takes money.
    await hostRef
      .collection('webhooks')
      .doc('fixture')
      .set({ url: 'https://example.invalid/hook', secret: CREDENTIAL_PROBE })
    await hostRef
      .collection('orders')
      .doc('fixture')
      .set({
        customerEmail: PII_PROBE,
        paymentLinkUrl: `https://example.invalid/pay/${CREDENTIAL_PROBE}`,
      })
    await db
      .collection('apiKeys')
      .doc(`${ORG}-fixture-hash`)
      .set({ orgId: ORG, name: 'CI fixture key', scopes: ['datasets:read'] })
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('stripe.com')) {
        stripeCalls.push(url)
        throw new Error(`BLOCKED: this spec must never reach Stripe (${url})`)
      }
      return realFetch(input, init)
    }) as typeof fetch

    // Nothing from an earlier run, or a stale audit row would answer an
    // assertion instead of this run's.
    await purge()
    await seed()
    result = await erase.eraseOrg(ORG)
  }, 180_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    await purge()
    expect(stripeCalls).toEqual([])
  }, 120_000)

  it('THE DEFECT: writes nothing at all to the bucket', () => {
    // Every remaining Storage call in the erase path is a DELETE. A `save`
    // here is a new object outliving the request that erased everything else,
    // on a prefix the sweep does not cover.
    expect(mockSaved.map((entry) => entry.path)).toEqual([])
  })

  it('THE DEFECT: persists neither the personal data nor the secret', () => {
    const bytes = mockSaved.map((entry) => entry.body).join('\n')
    expect(bytes).not.toContain(PII_PROBE)
    // The stronger half. A dump of an erased workspace is not merely a record
    // of personal data — it is a working HMAC key and a live payable link.
    expect(bytes).not.toContain(CREDENTIAL_PROBE)
  })

  it('the erasure still completes — nothing depended on the dump', async () => {
    expect(result.ok).toBe(true)
    const org = await db.collection('orgs').doc(ORG).get()
    const host = await db.collection('hosts').doc(HOST).get()
    const members = await db
      .collection('orgs')
      .doc(ORG)
      .collection('members')
      .get()
    const keys = await db.collection('apiKeys').where('orgId', '==', ORG).get()
    const projection = await db
      .collection('users')
      .doc(MEMBER_UID)
      .collection('orgs')
      .doc(ORG)
      .get()
    expect([
      org.exists,
      host.exists,
      members.size,
      keys.size,
      projection.exists,
    ]).toEqual([false, false, 0, 0, false])
  }, 60_000)

  it('THE DEFECT: the result no longer hands a caller a path to a dump', () => {
    expect(result).not.toHaveProperty('exportPath')
    // What it does report is unchanged: the counts each sweep destroyed.
    expect(result).toMatchObject({ ok: true, hosts: 1, apiKeys: 1 })
  })

  it('the proof of erasure survives, in adminAudit', async () => {
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUid: 'cron:run-erasures',
      action: 'org.erased',
      target: `orgs/${ORG}`,
      before: { hosts: 1, members: 1 },
      after: { hosts: 1, apiKeys: 1 },
    })
    expect(rows[0]['at']).toBeTruthy()
  }, 60_000)

  it('THE DEFECT: the row records the request, not a path to a dump', async () => {
    const rows = await auditRows()
    const after = rows[0]['after'] as Record<string, unknown>
    // `erasures/{orgId}/{requestedMs}.json` encoded WHICH request this run
    // fulfilled in the object name, and that was the only place it was
    // recorded. It belongs in the record, not in a filename.
    expect(after['requestedAt']).toBe(requestedAt)
    expect(after).not.toHaveProperty('exportPath')
  }, 60_000)

  it('and the row is ids and counts — never the content it erased', async () => {
    const rows = await auditRows()
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(PII_PROBE)
    expect(serialized).not.toContain(CREDENTIAL_PROBE)
    // Bounded by shape, not only by policy: a record of this size cannot be
    // a copy of a workspace however large the workspace was.
    expect(serialized.length).toBeLessThan(1024)
  }, 60_000)
})
