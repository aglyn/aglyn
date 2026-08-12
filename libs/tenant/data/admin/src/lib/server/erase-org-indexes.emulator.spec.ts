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
 * An org erasure must take every org-keyed INDEX with it (AGL-1448, tier 2).
 *
 * Three collections, three different failures — none of them a missing sweep
 * in the AGL-1444 sense, all three reachable in principle and wrong anyway:
 *
 * 1. **`orgSlugs` is a HALF-sweep.** `changeOrgSlug` leaves a tombstone at the
 *    previous slug (`{ orgId, movedTo }`) so old workspace URLs keep
 *    redirecting; erase deletes only `orgSlugs/{org.slug}`. Every historical
 *    name an org ever held therefore survives its erasure — in the one
 *    collection the rules make `allow read: if true`, because it doubles as
 *    the public pre-auth health probe. An erased workspace's naming history
 *    stays world-readable, and the tombstone keeps naming the dead org id.
 *
 * 2. **`stripeCustomers` is INVERTED.** Erase deletes the customer *at
 *    Stripe* and keeps the local `stripeCustomers/{customerId} -> { orgId }`
 *    reverse index. AGL-1028 created that index and denied it to every client
 *    for one reason: readable, it maps a billing identity back to a
 *    workspace. The record that survived the erasure is precisely the
 *    correlation the issue existed to prevent.
 *
 * 3. **`apiIdempotency` has no TTL.** Checked, not assumed: the only TTL
 *    policy on `aglyn-main` is `rateLimits.expiresAt`
 *    (`docs/FIRESTORE_MANUAL_CONFIG.md`), and these documents carry
 *    `{ orgId, recordId, createdAt }` with no expiry field for a policy to
 *    key on. They accumulate indefinitely against a dead org.
 *
 * The dangerous fix is the same one throughout: a collection sweep that takes
 * out a live tenant's slug reservation, billing correlation or replay keys.
 * Every assertion below has a bystander twin.
 *
 * ## Why this spec disarms two live integrations by hand
 *
 * Unlike the tier-1 fixture, this org needs a `slug` and a Stripe customer id
 * — they are the subject. Both of those branches call the outside world:
 *
 * - `deleteStripeCustomer` DELETEs the customer at Stripe when
 *   `STRIPE_SECRET_KEY` is set, and localhost carries the LIVE key. The
 *   variable is cleared below so the function returns early, and `fetch` is
 *   additionally wrapped to refuse anything addressed to Stripe — a hard stop
 *   rather than a convention, with the attempt list asserted empty at the end.
 *   That proves this SPEC never reached Stripe; it says nothing about what
 *   production does, which is deliberately unchanged here.
 * - `detachWorkspaceDomain` calls Vercel. `VERCEL_TOKEN` is cleared, so
 *   `vercelSettings()` returns null and every call answers `skipped`.
 *
 * Storage is STUBBED for the same non-negotiable reason as the other erasure
 * specs: no Storage emulator, and a real service-account credential on the
 * admin app, so an unstubbed `eraseOrg` writes to the PRODUCTION bucket.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-indexes.emulator
 */

import { createHash } from 'crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/** The org's naming history: two renames, so two tombstones and one live. */
const SLUG_FIRST = 'e2e-erase-index-first'
const SLUG_SECOND = 'e2e-erase-index-second'
const SLUG_CURRENT = 'e2e-erase-index-current'
const OTHER_SLUG = 'e2e-erase-index-bystander'
const ALL_SLUGS = [SLUG_FIRST, SLUG_SECOND, SLUG_CURRENT, OTHER_SLUG]

const OWNER_UID = 'e2e-erase-index-uid'
const OTHER_OWNER_UID = 'e2e-erase-index-bystander-uid'

const CUSTOMER_ID = 'cus_e2eEraseIndexFixture'
const OTHER_CUSTOMER_ID = 'cus_e2eEraseIndexBystander'

// Before any module reads them. Neither integration may be reachable from a
// fixture: one deletes a real billing customer, the other mutates a real
// Vercel project.
delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

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

describeEmulated('an erased org leaves no org-keyed index row (AGL-1448)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let organizations: typeof import('./organizations')
  let orgBilling: typeof import('./org-billing')

  let orgId: string
  let otherOrgId: string

  /** Every URL the run addressed to Stripe. Must stay empty. */
  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  const idempotencyId = (org: string, key: string) =>
    createHash('sha256').update(`${org}:${key}`).digest('hex')

  async function purgeOrg(target: string): Promise<void> {
    if (!target) return
    for (const collection of ['stripeCustomers', 'apiIdempotency', 'orgSlugs']) {
      const stale = await db.collection(collection).where('orgId', '==', target).get()
      await Promise.all(stale.docs.map((doc) => doc.ref.delete()))
    }
    await db.recursiveDelete(db.collection('orgs').doc(target))
    await db.recursiveDelete(db.collection('users').doc(OWNER_UID))
    await db.recursiveDelete(db.collection('users').doc(OTHER_OWNER_UID))
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    organizations = await import('./organizations')
    orgBilling = await import('./org-billing')

    // Leave nothing from an earlier run: a stale reservation would make
    // `createOrganization` throw OrgSlugTakenError, and a stale index row
    // would answer an assertion instead of this run's.
    for (const slug of ALL_SLUGS) {
      const reservation = await db.collection('orgSlugs').doc(slug).get()
      const owner = reservation.get('orgId') as string | undefined
      if (owner) await purgeOrg(owner)
      await db.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    }

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('stripe.com')) {
        stripeCalls.push(url)
        throw new Error(`BLOCKED: this spec must never reach Stripe (${url})`)
      }
      return realFetch(input, init)
    }) as typeof fetch

    // Real creation and real renames, so the tombstones are the tombstones
    // production writes rather than a hand-built approximation.
    orgId = await organizations.createOrganization({
      name: 'Erasure Index Fixture',
      slug: SLUG_FIRST,
      ownerUid: OWNER_UID,
    })
    await organizations.changeOrgSlug(orgId, SLUG_SECOND)
    await organizations.changeOrgSlug(orgId, SLUG_CURRENT)

    otherOrgId = await organizations.createOrganization({
      name: 'Erasure Index Bystander',
      slug: OTHER_SLUG,
      ownerUid: OTHER_OWNER_UID,
    })

    // Guard the premise: without the tombstones there is no half-sweep to
    // catch, and this spec would pass by describing nothing.
    for (const slug of [SLUG_FIRST, SLUG_SECOND]) {
      const tombstone = await db.collection('orgSlugs').doc(slug).get()
      expect([slug, tombstone.get('orgId'), Boolean(tombstone.get('movedTo'))]).toEqual([
        slug,
        orgId,
        true,
      ])
    }

    // The reverse index through its only writer, so the stored shape is real.
    await orgBilling.writeOrgBilling(orgId, { stripeCustomerId: CUSTOMER_ID })
    await orgBilling.writeOrgBilling(otherOrgId, {
      stripeCustomerId: OTHER_CUSTOMER_ID,
    })

    // Replay keys, in the shape `/api/v1` writes them.
    for (const [org, key] of [
      [orgId, 'fixture-key-a'],
      [orgId, 'fixture-key-b'],
      [otherOrgId, 'bystander-key'],
    ] as const) {
      await db
        .collection('apiIdempotency')
        .doc(idempotencyId(org, key))
        .set({ orgId: org, recordId: `rec-${key}`, createdAt: Timestamp.now() })
    }

    await db
      .collection('orgs')
      .doc(orgId)
      .set(
        {
          erasureRequestedAt: Timestamp.fromMillis(
            Date.now() - erase.ERASURE_HOLD_MS - 60_000,
          ),
        },
        { merge: true },
      )

    const result = await erase.eraseOrg(orgId)
    expect(result).toMatchObject({ ok: true })
  }, 180_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    await purgeOrg(otherOrgId)
    for (const slug of ALL_SLUGS) {
      await db.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    }
  }, 60_000)

  it('THE DEFECT: no orgSlugs document still references the erased org', async () => {
    const rows = await db.collection('orgSlugs').where('orgId', '==', orgId).get()
    expect(rows.docs.map((doc) => doc.id).sort()).toEqual([])
  }, 60_000)

  it('takes the naming HISTORY, not only the current slug', async () => {
    // The half-sweep: `orgSlugs/{org.slug}` went, the two tombstones stayed —
    // world-readable, still naming the erased org, still redirecting.
    for (const slug of [SLUG_FIRST, SLUG_SECOND, SLUG_CURRENT]) {
      const doc = await db.collection('orgSlugs').doc(slug).get()
      expect([slug, doc.exists]).toEqual([slug, false])
    }
  }, 60_000)

  it('leaves another org\'s slug reservation standing', async () => {
    const doc = await db.collection('orgSlugs').doc(OTHER_SLUG).get()
    expect(doc.exists).toBe(true)
    expect(doc.get('orgId')).toBe(otherOrgId)
  }, 60_000)

  it('THE DEFECT: no stripeCustomers row still maps to the erased org', async () => {
    const rows = await db
      .collection('stripeCustomers')
      .where('orgId', '==', orgId)
      .get()
    expect(rows.docs.map((doc) => doc.id)).toEqual([])
    const doc = await db.collection('stripeCustomers').doc(CUSTOMER_ID).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('cannot resolve the erased org from its Stripe customer id', async () => {
    // The correlation observed, not assumed: the lookup the webhook performs
    // must come back with nothing.
    await expect(
      orgBilling.findOrgIdByStripeCustomer(CUSTOMER_ID),
    ).resolves.toBeNull()
  }, 60_000)

  it('leaves another org\'s billing correlation resolvable', async () => {
    await expect(
      orgBilling.findOrgIdByStripeCustomer(OTHER_CUSTOMER_ID),
    ).resolves.toBe(otherOrgId)
  }, 60_000)

  it('never called Stripe', async () => {
    // Local-index deletion only. `STRIPE_SECRET_KEY` is unset here so
    // `deleteStripeCustomer` returns early; this pins that the spec's own run
    // reached no billing API, which is what makes it safe to run on a
    // developer machine holding a live key.
    expect(stripeCalls).toEqual([])
  }, 60_000)

  it('THE DEFECT: no apiIdempotency replay key survives the erased org', async () => {
    const rows = await db
      .collection('apiIdempotency')
      .where('orgId', '==', orgId)
      .get()
    expect(rows.size).toBe(0)
  }, 60_000)

  it('leaves another org\'s replay key so its retries still dedupe', async () => {
    const doc = await db
      .collection('apiIdempotency')
      .doc(idempotencyId(otherOrgId, 'bystander-key'))
      .get()
    expect(doc.exists).toBe(true)
    expect(doc.get('orgId')).toBe(otherOrgId)
  }, 60_000)
})
