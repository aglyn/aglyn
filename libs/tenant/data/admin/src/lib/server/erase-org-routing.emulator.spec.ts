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
 * An org erasure must take its ROUTING documents with it (AGL-1448, tier 1).
 *
 * `eraseOrg` walks `orgs/{orgId}` with `recursiveDelete`. `ssoDomains` and
 * `consoleDomains` are TOP-LEVEL collections keyed by the DOMAIN and carrying
 * `orgId` as a FIELD, so a path-scoped cascade is structurally blind to both —
 * the same shape AGL-1444 fixed for `apiKeys`.
 *
 * What survives is not decorative. An `ssoDomains` doc names the erased org,
 * its GCIP pool and provider, and the customer's email domain — and while it
 * exists, `issueDomainClaim` refuses that domain to every other org with "That
 * domain is already verified by another organization", so a ghost holds a real
 * customer's domain hostage. A `consoleDomains` doc is a RESERVATION: every
 * name in `names` stays claimed against an org that no longer exists.
 *
 * The dangerous fix is a collection sweep. Both collections hold every other
 * customer's routing, so each assertion below has a bystander twin.
 *
 * Storage is STUBBED, deliberately and non-negotiably — same reasoning as
 * `erase-org-credentials.emulator.spec.ts`: there is no Storage emulator in
 * `npm run firebase:emulate` and the admin app holds a real service-account
 * credential, so an unstubbed `eraseOrg` runs `deleteFiles` against the
 * PRODUCTION bucket. `VERCEL_TOKEN` is cleared for the same class of reason:
 * `releaseConsoleDomain` detaches every name from the console Vercel project
 * first, and this fixture must never reach that API.
 *
 * The seed carries no `slug` and no Stripe customer id — those branches call a
 * live DNS API and a live Stripe key. They are tier 2's problem, and tier 2's
 * spec neutralizes them explicitly.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-routing.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-erase-routing-org'
const OTHER_ORG = 'e2e-erase-routing-bystander'

const SSO_DOMAIN = 'sso.erase-routing-fixture.com'
const OTHER_SSO_DOMAIN = 'sso.erase-routing-bystander.com'

const CONSOLE_DOMAIN = 'erase-routing-fixture.com'
const CONSOLE_TWIN = `www.${CONSOLE_DOMAIN}`
const OTHER_CONSOLE_DOMAIN = 'erase-routing-bystander.com'
const OTHER_CONSOLE_TWIN = `www.${OTHER_CONSOLE_DOMAIN}`

// Before any module reads them. `releaseConsoleDomain` calls Vercel to detach
// each name; with no token `vercelSettings()` returns null and every call
// answers `skipped` without leaving the process.
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

describeEmulated('an erased org leaves no routing document (AGL-1448)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let sso: typeof import('./sso-provisioning')
  let consoleDomains: typeof import('./console-domains')

  async function purge(orgId: string): Promise<void> {
    for (const collection of ['ssoDomains', 'consoleDomains']) {
      const stale = await db.collection(collection).where('orgId', '==', orgId).get()
      await Promise.all(stale.docs.map((doc) => doc.ref.delete()))
    }
    await db.recursiveDelete(db.collection('orgs').doc(orgId))
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    sso = await import('./sso-provisioning')
    consoleDomains = await import('./console-domains')

    // Leave nothing from an earlier run, or a stale row answers the assertion
    // instead of this one's.
    for (const orgId of [ORG, OTHER_ORG]) await purge(orgId)

    // The hold must have elapsed, or `eraseOrg` skips and every assertion
    // below passes for the wrong reason.
    await db
      .collection('orgs')
      .doc(ORG)
      .set({
        name: 'Erasure Routing Fixture',
        erasureRequestedAt: Timestamp.fromMillis(
          Date.now() - erase.ERASURE_HOLD_MS - 60_000,
        ),
      })
    await db.collection('orgs').doc(OTHER_ORG).set({ name: 'Bystander' })

    // Published through the real path, so the stored shape is the real shape:
    // `publishSsoDomains` re-reads the org's claim and refuses an unverified
    // domain, so the claim has to exist first.
    for (const [orgId, domain] of [
      [ORG, SSO_DOMAIN],
      [OTHER_ORG, OTHER_SSO_DOMAIN],
    ] as const) {
      await db
        .collection('orgs')
        .doc(orgId)
        .collection('ssoDomains')
        .doc(domain)
        .set({ domain, token: 'fixture-token', verified: true })
      const published = await sso.publishSsoDomains({
        orgId,
        tenantId: `tenant-${orgId}`,
        providerId: 'saml.fixture',
        protocol: 'saml',
        displayName: 'Fixture IdP',
        domains: [domain],
      })
      // Guard the premise: an unpublished fixture would make the "it is gone"
      // assertion vacuous.
      expect(published).toEqual([domain])
    }

    // `claimConsoleDomain` claims the primary and its `www` twin in one
    // transaction — the twin is the part a naive fix forgets.
    for (const [orgId, domain] of [
      [ORG, CONSOLE_DOMAIN],
      [OTHER_ORG, OTHER_CONSOLE_DOMAIN],
    ] as const) {
      const claim = await consoleDomains.claimConsoleDomain(orgId, domain)
      expect(claim.names).toEqual([domain, `www.${domain}`])
      // A live claim, not a pending one: the erasure has to release the
      // strongest state the collection can be in.
      for (const name of claim.names) {
        await db
          .collection(consoleDomains.CONSOLE_DOMAINS_COLLECTION)
          .doc(name)
          .set({ status: 'active', vercelState: 'attached' }, { merge: true })
      }
    }

    const result = await erase.eraseOrg(ORG)
    expect(result).toMatchObject({ ok: true })
  }, 120_000)

  afterAll(async () => {
    if (!EMULATED) return
    await purge(OTHER_ORG)
  }, 60_000)

  it('THE DEFECT: no ssoDomains document still references the erased org', async () => {
    const rows = await db.collection('ssoDomains').where('orgId', '==', ORG).get()
    expect(rows.docs.map((doc) => doc.id)).toEqual([])
  }, 60_000)

  it('frees the erased org\'s SSO domain for whoever really owns it', async () => {
    // A doc left behind — even deactivated — is what `issueDomainClaim` reads
    // to refuse the domain to another org. Absence is the only state that
    // releases it.
    const doc = await db.collection('ssoDomains').doc(SSO_DOMAIN).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('leaves another org\'s SSO routing live', async () => {
    const doc = await db.collection('ssoDomains').doc(OTHER_SSO_DOMAIN).get()
    expect(doc.exists).toBe(true)
    expect(doc.get('orgId')).toBe(OTHER_ORG)
    // Still ROUTING, not merely present: a sweep that deactivated instead of
    // deleting would break every other customer's sign-in.
    expect(doc.get('active')).toBe(true)
  }, 60_000)

  it('THE DEFECT: no consoleDomains document still references the erased org', async () => {
    const rows = await db
      .collection('consoleDomains')
      .where('orgId', '==', ORG)
      .get()
    expect(rows.docs.map((doc) => doc.id)).toEqual([])
  }, 60_000)

  it('releases the twin as well as the primary', async () => {
    // Every name in `names` is a reservation. Releasing only the name the
    // customer typed leaves `www.` claimed by a dead org forever.
    for (const name of [CONSOLE_DOMAIN, CONSOLE_TWIN]) {
      const doc = await db.collection('consoleDomains').doc(name).get()
      expect([name, doc.exists]).toEqual([name, false])
    }
  }, 60_000)

  it('the released name resolves to nothing, not to a dead org', async () => {
    const verdict = await consoleDomains.resolveConsoleDomain(CONSOLE_DOMAIN)
    expect(verdict).toMatchObject({ known: false, servable: false })
  }, 60_000)

  it('leaves another org\'s console claim intact, twin included', async () => {
    for (const name of [OTHER_CONSOLE_DOMAIN, OTHER_CONSOLE_TWIN]) {
      const doc = await db.collection('consoleDomains').doc(name).get()
      expect([name, doc.exists]).toEqual([name, true])
      expect(doc.get('orgId')).toBe(OTHER_ORG)
    }
  }, 60_000)
})
