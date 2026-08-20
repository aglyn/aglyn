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
 * Two org-keyed ROUTING PROJECTIONS outlive an erasure (AGL-1448).
 *
 * Both carry `orgId` as a FIELD, so `recursiveDelete(orgs/{orgId})` cannot
 * see either — the AGL-1448 shape exactly. What makes them different from
 * the collections already swept, and the reason they were not on the issue's
 * list, is that both LOOK covered: each is deleted today by a helper that
 * runs during the erasure. Each helper enumerates the wrong thing.
 *
 * 1. **`hostIndex/{hostId}` — `{ orgId, subdomain }`, `allow read: if
 *    isSignedIn()`.** `eraseHost` deletes this row for every site it erases,
 *    and `eraseOrg` calls `eraseHost` once per document in `hosts where orgId
 *    == org`. So the row is reached *derivatively*, through a second
 *    collection, and only while the two agree.
 *
 *    They do not always agree, and the erasure itself is one of the ways they
 *    stop agreeing: `eraseHost`'s `hostIndex` delete is `.catch(() =>
 *    undefined)` — deliberately fail-soft, so a transient failure never
 *    blocks the Firestore delete — and the very next statement
 *    `recursiveDelete`s `hosts/{hostId}`. Once the `hosts` document is gone
 *    the orphaned index row can never be enumerated again, by this erasure or
 *    any retry of it: nothing left in the database points at it from the org
 *    side. A fail-soft that manufactures a PERMANENT orphan is not fail-soft.
 *
 *    What survives is a signed-in-readable row naming a dead org and the
 *    subdomain its customer chose.
 *
 * 2. **`users/{uid}/hostMemberships/{hostId}` — `{ orgId, subdomain,
 *    displayName, nameLower, role }`.** Under a USER, so the org tree delete
 *    cannot reach it either. `deleteHostProjectionForAllMembers(orgId,
 *    hostId)` clears it — for everyone listed in `orgs/{orgId}/members` at
 *    the moment the erasure runs.
 *
 *    A FORMER member is not in that list. Their projection row is written by
 *    the fan-out and removed by `removeOrgMember`, which is fail-soft in the
 *    same way; a single missed fan-out leaves a row that no later erasure can
 *    find, because the enumeration starts from a membership that no longer
 *    exists. The erased workspace's site NAME and subdomain then live on in a
 *    third party's user document — someone who left the company — with no
 *    query from the org side that would ever reach it.
 *
 * Both fixes are the `deleteDocsByOrgId` discipline: bounded by the `orgId`
 * FIELD, never a collection sweep, run as a BACKSTOP after the per-host and
 * per-member loops rather than in place of them. The loops still do the
 * ordinary work (Storage, routing maps, `recursiveDelete`); the sweeps catch
 * what the loops structurally cannot enumerate.
 *
 * ## The dangerous shape, and the control that pins it
 *
 * A field-keyed sweep with a wrong or missing filter deletes EVERY org's
 * rows. `hostIndex` is the resolution table the middleware routes on and
 * `hostMemberships` is every user's site switcher: an over-sweep here does
 * not lose an index, it takes the estate offline and logs everyone out of
 * their own sites. Every assertion below therefore has a bystander twin, and
 * the bystander is seeded in the same shapes as the subject — a live host, an
 * orphan row, a current member and a former member — so an over-sweep cannot
 * pass by only ever being tested against one row.
 *
 * ## Why this spec disarms Storage
 *
 * There is no Storage emulator and the admin app holds a real service-account
 * credential, so an unstubbed `eraseOrg` runs `deleteFiles` against the
 * PRODUCTION bucket. Stubbed, as in every other erasure spec here.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-projections.emulator
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-erase-projection-org'
const OTHER_ORG = 'e2e-erase-projection-bystander'

/** A site that still has its `hosts` document — the ordinary path. */
const HOST_LIVE = 'e2e-erase-projection-live'
/**
 * A `hostIndex` row whose `hosts` document is already gone — precisely what
 * `eraseHost`'s fail-soft delete leaves behind, and unreachable from the org
 * side forever after.
 */
const HOST_ORPHAN = 'e2e-erase-projection-orphan'

const OTHER_HOST_LIVE = 'e2e-erase-projection-bystander-live'
const OTHER_HOST_ORPHAN = 'e2e-erase-projection-bystander-orphan'

/** In `orgs/{ORG}/members` when the erasure runs. */
const UID_MEMBER = 'e2e-erase-projection-member'
/** NOT in `orgs/{ORG}/members` — the row nothing can enumerate. */
const UID_FORMER = 'e2e-erase-projection-former'

const OTHER_UID_MEMBER = 'e2e-erase-projection-bystander-member'
const OTHER_UID_FORMER = 'e2e-erase-projection-bystander-former'

const ALL_HOSTS = [HOST_LIVE, HOST_ORPHAN, OTHER_HOST_LIVE, OTHER_HOST_ORPHAN]
const ALL_UIDS = [UID_MEMBER, UID_FORMER, OTHER_UID_MEMBER, OTHER_UID_FORMER]

/**
 * The dropship outbox — top-level, `hostId` as a FIELD, and the row a human
 * was supposed to act on. `supplier-outbox.ts` deletes a DELIVERED row for
 * exactly the AGL-1448 reason (the body holds a buyer's name and email, and a
 * top-level document is outside the recursive delete an erasure runs) and
 * leaves a DEAD-LETTERED one standing. Nothing collected those.
 */
const SUPPLIER_DELIVERIES = 'supplierDeliveries'
const DEAD_LETTER = `${HOST_LIVE}--dead-letter`
const OTHER_DEAD_LETTER = `${OTHER_HOST_LIVE}--dead-letter`

// Before any module reads them. Nothing in this fixture may reach a live
// integration: `detachWorkspaceDomain` mutates a real Vercel project and
// `deleteStripeCustomer` deletes a real billing customer.
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID
delete process.env.STRIPE_SECRET_KEY

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/** No Storage emulator, and the default app holds a production credential. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated(
  'an erased org leaves no routing projection behind (AGL-1448)',
  () => {
    let db: Firestore
    let erase: typeof import('./erase')

    async function purge(): Promise<void> {
      for (const id of [DEAD_LETTER, OTHER_DEAD_LETTER]) {
        await db.collection(SUPPLIER_DELIVERIES).doc(id).delete()
      }
      for (const hostId of ALL_HOSTS) {
        await db.collection('hostIndex').doc(hostId).delete()
        await db.recursiveDelete(db.collection('hosts').doc(hostId))
      }
      for (const uid of ALL_UIDS) {
        await db.recursiveDelete(db.collection('users').doc(uid))
      }
      for (const orgId of [ORG, OTHER_ORG]) {
        await db.recursiveDelete(db.collection('orgs').doc(orgId))
      }
    }

    /**
     * Seed one org in all four shapes at once: a live site, an orphaned index
     * row, a current member and a former member. The bystander gets the same
     * four, so no assertion below can pass because the bystander was seeded
     * more simply than the subject.
     */
    async function seed(
      orgId: string,
      liveHost: string,
      orphanHost: string,
      memberUid: string,
      formerUid: string,
    ): Promise<void> {
      await db.collection('hosts').doc(liveHost).set({
        orgId,
        displayName: 'Fixture Site',
        subdomain: liveHost,
      })
      await db
        .collection('hostIndex')
        .doc(liveHost)
        .set({ orgId, subdomain: liveHost })
      // The orphan: an index row with NO `hosts` document above it.
      await db
        .collection('hostIndex')
        .doc(orphanHost)
        .set({ orgId, subdomain: orphanHost })

      await db
        .collection('orgs')
        .doc(orgId)
        .collection('members')
        .doc(memberUid)
        .set({ role: 'owner' })

      // A DEAD-LETTERED delivery: `failed`, attempts exhausted, and carrying
      // the buyer's name, email and shipping address in `body` — the shape
      // nothing has ever collected.
      await db
        .collection(SUPPLIER_DELIVERIES)
        .doc(`${liveHost}--dead-letter`)
        .set({
          status: 'failed',
          hostId: liveHost,
          orderId: 'ord-fixture',
          supplierId: 'sup-fixture',
          supplierName: 'Fixture Supplier',
          url: 'https://supplier.invalid/orders',
          body: JSON.stringify({
            email: 'buyer@fixture.invalid',
            name: 'A Buyer',
            shipping: { line1: '1 Fixture Way', city: 'Austin' },
          }),
          attempts: 6,
        })

      for (const uid of [memberUid, formerUid]) {
        await db
          .collection('users')
          .doc(uid)
          .collection('hostMemberships')
          .doc(liveHost)
          .set({
            orgId,
            subdomain: liveHost,
            displayName: 'Fixture Site',
            nameLower: 'fixture site',
            role: 'owner',
          })
      }
    }

    beforeAll(async () => {
      db = getFirestore()
      erase = await import('./erase')

      // Leave nothing from an earlier run, or a stale row answers the
      // assertion instead of this one's.
      await purge()

      // The hold must have elapsed, or `eraseOrg` skips and every assertion
      // below passes for the wrong reason.
      await db
        .collection('orgs')
        .doc(ORG)
        .set({
          name: 'Erasure Projection Fixture',
          erasureRequestedAt: Timestamp.fromMillis(
            Date.now() - erase.ERASURE_HOLD_MS - 60_000,
          ),
        })
      await db.collection('orgs').doc(OTHER_ORG).set({ name: 'Bystander' })

      await seed(ORG, HOST_LIVE, HOST_ORPHAN, UID_MEMBER, UID_FORMER)
      await seed(
        OTHER_ORG,
        OTHER_HOST_LIVE,
        OTHER_HOST_ORPHAN,
        OTHER_UID_MEMBER,
        OTHER_UID_FORMER,
      )

      // Guard the premise: a fixture that did not land makes every "it is
      // gone" assertion vacuous.
      const seeded = await db
        .collection('hostIndex')
        .where('orgId', '==', ORG)
        .get()
      expect(seeded.docs.map((doc) => doc.id).sort()).toEqual(
        [HOST_LIVE, HOST_ORPHAN].sort(),
      )

      const result = await erase.eraseOrg(ORG)
      expect(result).toMatchObject({ ok: true })
    }, 180_000)

    afterAll(async () => {
      if (!EMULATED) return
      await purge()
    }, 120_000)

    it('THE DEFECT: no hostIndex row still references the erased org', async () => {
      const rows = await db
        .collection('hostIndex')
        .where('orgId', '==', ORG)
        .get()
      expect(rows.docs.map((doc) => doc.id)).toEqual([])
    }, 60_000)

    it('takes the ORPHANED hostIndex row, the one no host document points at', async () => {
      // The live host's row goes today, through `eraseHost`. This one is the
      // defect: nothing enumerates it, so nothing has ever deleted it.
      const doc = await db.collection('hostIndex').doc(HOST_ORPHAN).get()
      expect(doc.exists).toBe(false)
    }, 60_000)

    it('NEGATIVE CONTROL: another org\'s hostIndex rows survive, both of them', async () => {
      for (const hostId of [OTHER_HOST_LIVE, OTHER_HOST_ORPHAN]) {
        const doc = await db.collection('hostIndex').doc(hostId).get()
        expect([hostId, doc.exists]).toEqual([hostId, true])
        // Still ROUTING, not merely present: a sweep that emptied the row
        // instead of leaving it would 404 a live tenant's subdomain.
        expect(doc.get('orgId')).toBe(OTHER_ORG)
        expect(doc.get('subdomain')).toBe(hostId)
      }
    }, 60_000)

    it('THE DEFECT: no hostMemberships row still references the erased org', async () => {
      const rows = await db
        .collectionGroup('hostMemberships')
        .where('orgId', '==', ORG)
        .get()
      expect(rows.docs.map((doc) => doc.ref.path)).toEqual([])
    }, 60_000)

    it('takes the FORMER member\'s projection, whom no membership lists', async () => {
      // The current member's row goes today, through
      // `deleteHostProjectionForAllMembers`. This one is the defect: the
      // enumeration starts from a membership that no longer exists, so the
      // erased site's name and subdomain live on in a stranger's document.
      const doc = await db
        .collection('users')
        .doc(UID_FORMER)
        .collection('hostMemberships')
        .doc(HOST_LIVE)
        .get()
      expect(doc.exists).toBe(false)
    }, 60_000)

    it('NEGATIVE CONTROL: another org\'s projections survive for both users', async () => {
      for (const uid of [OTHER_UID_MEMBER, OTHER_UID_FORMER]) {
        const doc = await db
          .collection('users')
          .doc(uid)
          .collection('hostMemberships')
          .doc(OTHER_HOST_LIVE)
          .get()
        expect([uid, doc.exists]).toEqual([uid, true])
        // Intact, not merely present: this row IS the site switcher entry.
        expect(doc.get('orgId')).toBe(OTHER_ORG)
        expect(doc.get('displayName')).toBe('Fixture Site')
        expect(doc.get('role')).toBe('owner')
      }
    }, 60_000)

    it('THE DEFECT: no DEAD-LETTERED supplier delivery survives the site', async () => {
      // `supplier-outbox.ts` deletes a row on successful delivery precisely
      // because a top-level document is outside the recursive delete an
      // erasure runs. It leaves the FAILED row standing for a human to act
      // on — and once the merchant is erased there is no human left to ask,
      // so the buyer's name, email and shipping address sat there forever.
      const doc = await db.collection(SUPPLIER_DELIVERIES).doc(DEAD_LETTER).get()
      expect(doc.exists).toBe(false)
    }, 60_000)

    it('NEGATIVE CONTROL: another merchant\'s dead letter survives intact', async () => {
      // This is the row a human still has to act on. A sweep that took it
      // would silently drop a real order somebody paid for.
      const doc = await db
        .collection(SUPPLIER_DELIVERIES)
        .doc(OTHER_DEAD_LETTER)
        .get()
      expect(doc.exists).toBe(true)
      expect(doc.get('hostId')).toBe(OTHER_HOST_LIVE)
      expect(doc.get('status')).toBe('failed')
      expect(String(doc.get('body'))).toContain('buyer@fixture.invalid')
    }, 60_000)

    it('the supplier-outbox collection name has not drifted from the sweep', () => {
      // `erase.ts` cannot import `SUPPLIER_DELIVERY_COLLECTION`: the owning
      // library is tagged `aglyn:addons` and this one is `scope:data`, so the
      // nx boundary forbids the edge and the literal is duplicated. A rename
      // on the commerce side would silently un-wire the sweep — the erasure
      // would keep reporting success against a collection that no longer
      // exists. Read the declaration and assert the two still agree.
      const source = readFileSync(
        join(
          __dirname,
          '../../../../../../plugins/commerce/src/lib/server/supplier-outbox.ts',
        ),
        'utf8',
      )
      const declared = /SUPPLIER_DELIVERY_COLLECTION = '([^']+)'/.exec(source)
      // Guard the guard: a moved file would make the assertion vacuous.
      expect(declared).not.toBeNull()
      expect(declared?.[1]).toBe(SUPPLIER_DELIVERIES)
    })

    it('reports every sweep as a COUNT, so the audit row can state them', async () => {
      // A count is the only thing that distinguishes "swept nothing because
      // there was nothing" from "could not reach the collection at all" —
      // which for `hostMemberships` is a missing COLLECTION_GROUP index, the
      // AGL-1793 failure mode. `null` is that state; a number is health.
      const plan = await erase.eraseOrg(OTHER_ORG, { dryRun: true })
      expect(plan).toMatchObject({ ok: false, skippedReason: 'no-request' })

      // The bystander has no erasure request, so drive the counts through a
      // second real erasure instead — it still owns one live host, one orphan
      // index row, two projections and a dead letter.
      await db
        .collection('orgs')
        .doc(OTHER_ORG)
        .set(
          {
            erasureRequestedAt: Timestamp.fromMillis(
              Date.now() - erase.ERASURE_HOLD_MS - 60_000,
            ),
          },
          { merge: true },
        )
      const result = await erase.eraseOrg(OTHER_ORG)
      expect(result).toMatchObject({ ok: true })
      // ONE, not two, and the number is the point: the per-host loop has
      // already taken the live site's index row by the time the backstop
      // runs, so what the sweep counts is exactly the ORPHAN — the residue
      // no enumeration from the org side could reach. A 2 here would mean
      // the backstop was doing the loop's work over again; a 0 would mean it
      // was not running at all.
      expect(result.hostIndex).toBe(1)
      // Same shape: `deleteHostProjectionForAllMembers` has already cleared
      // the CURRENT member's projection, so the one row left for the sweep is
      // the FORMER member's — the defect this backstop exists for.
      //
      // A NUMBER, never null: null means the collection-group query could not
      // run, and a missing index must not read as a clean sweep.
      expect(typeof result.hostMemberships).toBe('number')
      expect(result.hostMemberships).toBe(1)

      const survivors = await db
        .collection(SUPPLIER_DELIVERIES)
        .doc(OTHER_DEAD_LETTER)
        .get()
      expect(survivors.exists).toBe(false)
    }, 180_000)
  },
)
