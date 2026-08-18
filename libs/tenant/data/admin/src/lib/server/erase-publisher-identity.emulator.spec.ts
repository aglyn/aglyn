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
 * An erasure must leave no PUBLIC identity standing (AGL-1970).
 *
 * Three top-level collections outlived the erasure that was supposed to remove
 * them, and all three are `allow read: if true` in
 * `cloud/firebase-firestore.rules`:
 *
 *   - `profiles/{uid}`            — survived `eraseUser`
 *   - `publisherProfiles/{orgId}` — survived `eraseOrg`
 *   - `publisherHandles/{handle}` — survived `eraseOrg`
 *
 * Two of them carry `stripeAccountId`, a Stripe Connect **payout
 * destination** written server-side only after onboarding/KYC. So somebody who
 * asked to be erased stayed publicly visible with a live payment-account
 * identifier attached to a dead identity — which is the `stripeCustomers`
 * correlation AGL-1448 removed, pointing the other way, and which Privacy
 * Policy §5 says in terms does not happen ("a genuine recursive delete and we
 * keep no copy of the erased content — only an internal record that the
 * erasure happened").
 *
 * ## What this spec pins, and why each case is here
 *
 * 1. **The unconditional deletes.** An erased org leaves no publisher profile
 *    and no handle reservation; an erased person leaves no `profiles/{uid}`.
 * 2. **The tombstone.** `marketplaceListings` outlives an erasure — AGL-1448's
 *    parked Tier 3 decision — so an org whose listing survives gets a
 *    `{ erased: true }` document in place of its profile rather than nothing at
 *    all. The assertion that matters is not that the tombstone exists but that
 *    it is EMPTY of everything the Privacy Policy calls content: no
 *    `stripeAccountId`, no `handle`, no `displayName`. A tombstone that kept
 *    the payout id would be the original defect wearing a new field.
 * 3. **The negative control.** A bystander org and a bystander person keep
 *    their profile, their handle and their payout id. Without it, every
 *    assertion above passes just as well if the sweep deleted the collection —
 *    and these collections hold every other publisher on the platform.
 *
 * ## Disarming the integrations
 *
 * Same non-negotiables as the sibling erasure specs: `STRIPE_SECRET_KEY`
 * cleared (localhost carries the LIVE key) with `fetch` hard-blocked toward
 * Stripe and the attempt list asserted empty; `VERCEL_TOKEN` cleared; Storage
 * stubbed, because there is no Storage emulator and the admin app holds a
 * production credential, so an unstubbed run deletes from the PRODUCTION
 * bucket. `./auth-pools` is stubbed too — `eraseUser` ends at the auth record,
 * there is no Auth emulator in this config, and an unstubbed lookup reaches
 * the real identity platform.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-publisher-identity.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/** The org with no surviving listing — its profile should simply go. */
const PLAIN_SLUG = 'e2e-pubid-plain'
const PLAIN_OWNER_UID = 'e2e-pubid-plain-uid'
const PLAIN_HANDLE = 'e2e-pubid-plain'
/** A rename tombstone: same `orgId`, older name, equally world-readable. */
const PLAIN_OLD_HANDLE = 'e2e-pubid-plain-old'

/** The org whose listing outlives it — its profile should be tombstoned. */
const LISTED_SLUG = 'e2e-pubid-listed'
const LISTED_OWNER_UID = 'e2e-pubid-listed-uid'
const LISTED_HANDLE = 'e2e-pubid-listed'
const LISTING_ID = 'e2e-pubid-listing'

/** The negative control — never erased, must be untouched. */
const OTHER_SLUG = 'e2e-pubid-bystander'
const OTHER_OWNER_UID = 'e2e-pubid-bystander-uid'
const OTHER_HANDLE = 'e2e-pubid-bystander'

/** The person erased, and the person beside them who is not. */
const SUBJECT_UID = 'e2e-pubid-person'
const BYSTANDER_UID = 'e2e-pubid-person-bystander'

const PAYOUT_ACCOUNT = 'acct_e2ePubIdFixture'
const OTHER_PAYOUT_ACCOUNT = 'acct_e2ePubIdBystander'

const ALL_SLUGS = [PLAIN_SLUG, LISTED_SLUG, OTHER_SLUG]
const ALL_HANDLES = [
  PLAIN_HANDLE,
  PLAIN_OLD_HANDLE,
  LISTED_HANDLE,
  OTHER_HANDLE,
]

// Before any module reads them — neither integration may be reachable.
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

/** No Auth emulator here; an unstubbed lookup reaches real identity pools. */
jest.mock('./auth-pools', () => ({
  findUserByUidAcrossPools: async () => null,
  authForPool: () => ({ deleteUser: async () => undefined }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('an erasure leaves no public identity standing (AGL-1970)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let organizations: typeof import('./organizations')

  let plainOrgId: string
  let listedOrgId: string
  let otherOrgId: string

  let plainResult: Awaited<ReturnType<typeof import('./erase').eraseOrg>>
  let listedResult: Awaited<ReturnType<typeof import('./erase').eraseOrg>>
  let userResult: Awaited<ReturnType<typeof import('./erase').eraseUser>>

  /** Every URL the run addressed to Stripe. Must stay empty. */
  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  /** Leave nothing behind from an earlier run, in either direction. */
  async function purge(): Promise<void> {
    for (const slug of ALL_SLUGS) {
      const reservation = await db.collection('orgSlugs').doc(slug).get()
      const staleOrgId = reservation.get('orgId') as string | undefined
      if (staleOrgId) {
        await db.recursiveDelete(db.collection('orgs').doc(staleOrgId))
        await db.recursiveDelete(
          db.collection('publisherProfiles').doc(staleOrgId),
        )
      }
      await db.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    }
    for (const handle of ALL_HANDLES) {
      await db.collection('publisherHandles').doc(handle).delete()
    }
    await db.collection('marketplaceListings').doc(LISTING_ID).delete()
    for (const uid of [
      PLAIN_OWNER_UID,
      LISTED_OWNER_UID,
      OTHER_OWNER_UID,
      SUBJECT_UID,
      BYSTANDER_UID,
    ]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
      await db.recursiveDelete(db.collection('profiles').doc(uid))
    }
  }

  /** Age the request past the hold and run a REAL erasure. */
  async function eraseNow(orgId: string) {
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
    return erase.eraseOrg(orgId)
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    organizations = await import('./organizations')

    await purge()

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('stripe.com')) {
        stripeCalls.push(url)
        throw new Error(`BLOCKED: this spec must never reach Stripe (${url})`)
      }
      return realFetch(input, init)
    }) as typeof fetch

    plainOrgId = await organizations.createOrganization({
      name: 'Publisher Identity Fixture',
      slug: PLAIN_SLUG,
      ownerUid: PLAIN_OWNER_UID,
    })
    listedOrgId = await organizations.createOrganization({
      name: 'Publisher Identity Listed Fixture',
      slug: LISTED_SLUG,
      ownerUid: LISTED_OWNER_UID,
    })
    otherOrgId = await organizations.createOrganization({
      name: 'Publisher Identity Bystander',
      slug: OTHER_SLUG,
      ownerUid: OTHER_OWNER_UID,
    })

    // Publisher profiles in the shape the save/Connect routes write: the
    // cosmetic fields a client may set, plus the two payout fields only the
    // server ever writes.
    const profile = (handle: string, account: string) => ({
      handle,
      displayName: 'Fixture Publisher',
      bio: 'A publisher that asked to be erased.',
      website: 'https://example.invalid',
      stripeAccountId: account,
      stripeChargesEnabled: true,
      publisherAgreement: { version: 'v1', acceptedAt: Timestamp.now() },
    })
    await db
      .collection('publisherProfiles')
      .doc(plainOrgId)
      .set(profile(PLAIN_HANDLE, PAYOUT_ACCOUNT))
    // The publish-rate window lives UNDER the profile. A plain `.delete()`
    // would orphan it; `recursiveDelete` is why this document is here.
    await db
      .collection('publisherProfiles')
      .doc(plainOrgId)
      .collection('meta')
      .doc('publishWindow')
      .set({ dayKey: '2026-08-18', count: 3 })
    await db
      .collection('publisherProfiles')
      .doc(listedOrgId)
      .set(profile(LISTED_HANDLE, PAYOUT_ACCOUNT))
    await db
      .collection('publisherProfiles')
      .doc(otherOrgId)
      .set(profile(OTHER_HANDLE, OTHER_PAYOUT_ACCOUNT))

    // Handle reservations, exactly as `claimPublisherHandle` writes them —
    // including the `movedTo` tombstone a rename leaves behind.
    await db.collection('publisherHandles').doc(PLAIN_HANDLE).set({
      orgId: plainOrgId,
    })
    await db.collection('publisherHandles').doc(PLAIN_OLD_HANDLE).set({
      orgId: plainOrgId,
      movedTo: PLAIN_HANDLE,
    })
    await db.collection('publisherHandles').doc(LISTED_HANDLE).set({
      orgId: listedOrgId,
    })
    await db.collection('publisherHandles').doc(OTHER_HANDLE).set({
      orgId: otherOrgId,
    })

    // One listing that outlives its publisher — the whole reason the
    // tombstone branch exists. `profileId` is the publishing ORG id (AGL-652).
    await db.collection('marketplaceListings').doc(LISTING_ID).set({
      profileId: listedOrgId,
      name: 'A component buyers already installed',
      status: 'published',
    })

    // Public identities for the two people.
    for (const uid of [SUBJECT_UID, BYSTANDER_UID]) {
      await db.collection('users').doc(uid).set({ displayName: 'Fixture Person' })
      await db.collection('profiles').doc(uid).set({
        handle: uid,
        displayName: 'Fixture Person',
        stripeAccountId: PAYOUT_ACCOUNT,
        stripeChargesEnabled: true,
      })
    }

    plainResult = await eraseNow(plainOrgId)
    listedResult = await eraseNow(listedOrgId)
    userResult = await erase.eraseUser(SUBJECT_UID)

    expect(plainResult).toMatchObject({ ok: true })
    expect(listedResult).toMatchObject({ ok: true })
    expect(userResult).toMatchObject({ ok: true })
  }, 300_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    await purge()
  }, 120_000)

  it('THE DEFECT, org half: no publisher profile and no handle survives', async () => {
    const profile = await db
      .collection('publisherProfiles')
      .doc(plainOrgId)
      .get()
    expect(profile.exists).toBe(false)
    // The subcollection under it too — a document delete would have left it.
    const window = await db
      .collection('publisherProfiles')
      .doc(plainOrgId)
      .collection('meta')
      .doc('publishWindow')
      .get()
    expect(window.exists).toBe(false)

    // Both the live handle and the rename tombstone, released for re-use.
    const held = await db
      .collection('publisherHandles')
      .where('orgId', '==', plainOrgId)
      .get()
    expect(held.size).toBe(0)
    for (const handle of [PLAIN_HANDLE, PLAIN_OLD_HANDLE]) {
      const row = await db.collection('publisherHandles').doc(handle).get()
      expect(row.exists).toBe(false)
    }

    expect(plainResult).toMatchObject({
      publisherHandles: 2,
      publisherProfile: 'deleted',
      listingsRetained: 0,
    })
  }, 60_000)

  it('THE DEFECT, person half: `profiles/{uid}` does not survive eraseUser', async () => {
    const profile = await db.collection('profiles').doc(SUBJECT_UID).get()
    expect(profile.exists).toBe(false)
    expect(userResult.deleted).toMatchObject({ profile: true })
  }, 60_000)

  it('a surviving listing gets a tombstone that carries NO content', async () => {
    const profile = await db
      .collection('publisherProfiles')
      .doc(listedOrgId)
      .get()
    // Present as a record that the erasure happened…
    expect(profile.exists).toBe(true)
    expect(profile.get('erased')).toBe(true)
    // …and empty of every field the Privacy Policy calls content. The payout
    // id is the one that would make this the original defect with a new name.
    const keys = Object.keys(profile.data() ?? {}).sort()
    expect(keys).toEqual(['erased', 'erasedAt'])
    expect(profile.get('stripeAccountId')).toBeUndefined()
    expect(profile.get('handle')).toBeUndefined()
    expect(profile.get('displayName')).toBeUndefined()
    expect(profile.get('publisherAgreement')).toBeUndefined()

    // The handle is released even in the tombstone case: it is a live
    // reservation held against a real org that may want the name.
    const handle = await db
      .collection('publisherHandles')
      .doc(LISTED_HANDLE)
      .get()
    expect(handle.exists).toBe(false)

    // And the erasure SAYS the listing outlived it rather than reporting a
    // clean success (AGL-1448 Tier 3 is still open).
    expect(listedResult).toMatchObject({
      publisherProfile: 'tombstoned',
      listingsRetained: 1,
    })
  }, 60_000)

  it('NEGATIVE CONTROL: the bystander org keeps its profile, handle and payout id', async () => {
    // Without this, every assertion above passes if the sweep deleted the
    // whole collection — which holds every other publisher on the platform.
    const profile = await db
      .collection('publisherProfiles')
      .doc(otherOrgId)
      .get()
    expect(profile.exists).toBe(true)
    expect(profile.get('handle')).toBe(OTHER_HANDLE)
    expect(profile.get('stripeAccountId')).toBe(OTHER_PAYOUT_ACCOUNT)
    expect(profile.get('erased')).toBeUndefined()

    const handle = await db
      .collection('publisherHandles')
      .doc(OTHER_HANDLE)
      .get()
    expect(handle.exists).toBe(true)
    expect(handle.get('orgId')).toBe(otherOrgId)

    const org = await db.collection('orgs').doc(otherOrgId).get()
    expect(org.exists).toBe(true)
  }, 60_000)

  it('NEGATIVE CONTROL: the bystander person keeps their public profile', async () => {
    const profile = await db.collection('profiles').doc(BYSTANDER_UID).get()
    expect(profile.exists).toBe(true)
    expect(profile.get('stripeAccountId')).toBe(PAYOUT_ACCOUNT)
  }, 60_000)

  it('CONTROL: the erasures genuinely ran', async () => {
    // Survival is only a decision if the sweeps executed at all.
    for (const orgId of [plainOrgId, listedOrgId]) {
      const org = await db.collection('orgs').doc(orgId).get()
      expect(org.exists).toBe(false)
    }
    const user = await db.collection('users').doc(SUBJECT_UID).get()
    expect(user.exists).toBe(false)
  }, 60_000)

  it('never called Stripe', () => {
    expect(stripeCalls).toEqual([])
  })
})
