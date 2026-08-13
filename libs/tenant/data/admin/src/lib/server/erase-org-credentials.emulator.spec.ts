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
 * An org erasure must take its API credentials with it (AGL-1444).
 *
 * `eraseOrg` walks `orgs/{orgId}` with `recursiveDelete`. `apiKeys` is a
 * TOP-LEVEL collection keyed by the SHA-256 of the token, carrying `orgId`
 * as a FIELD — so it is structurally invisible to a path-scoped cascade, and
 * the credential outlived the workspace it belonged to.
 *
 * The route gate happens to fail closed today (`authenticateApiV1` reads the
 * org doc and 401s when it is gone), and the third test below pins that so a
 * regression there is caught here. But fail-closed-by-a-caller is the wrong
 * place for a credential's lifetime to be decided: the guard is one layer
 * above `verifyApiKey`, so any future consumer that resolves a key without
 * repeating the org read inherits a live principal for a deleted tenant.
 * The credential must not survive at all.
 *
 * The surviving document was also a small record about the erased workspace
 * in its own right — a human-authored label, the creating uid, the granted
 * scopes and a `lastUsedAt` — which is a data-retention problem regardless
 * of what it authorises.
 *
 * Storage is STUBBED here, deliberately and non-negotiably. There is no
 * Storage emulator in `npm run firebase:emulate`, and the admin app is
 * initialized with a real service-account credential — so an unstubbed
 * `eraseOrg` would write its export bundle to, and run `deleteFiles` against,
 * the PRODUCTION bucket. The seed also carries no `slug` and no Stripe
 * customer id, because those branches call a live DNS API and a live Stripe
 * key respectively.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-credentials.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-erase-credentials-org'
const OTHER_ORG = 'e2e-erase-credentials-bystander'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/**
 * No Storage emulator exists, and the default app holds a production
 * credential. Every bucket call becomes a no-op recorder so this spec cannot
 * reach GCS — `deleteFiles` here would sweep real customer media. `save` is
 * stubbed too, but only as a backstop: since AGL-1443 the erase path writes
 * no object at all, and `erase-org-export.emulator.spec.ts` asserts it.
 */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('an erased org leaves no live API credential (AGL-1444)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let apiKeys: typeof import('./api-keys')
  let organizations: typeof import('./organizations')

  /** The raw tokens exist in plaintext only here, exactly as at mint time. */
  let erasedOrgToken: string
  let bystanderToken: string

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    apiKeys = await import('./api-keys')
    organizations = await import('./organizations')

    // Leave no rows behind from an earlier run, or a stale key from the
    // previous pass would answer the assertion instead of this one's.
    for (const orgId of [ORG, OTHER_ORG]) {
      const stale = await db.collection('apiKeys').where('orgId', '==', orgId).get()
      await Promise.all(stale.docs.map((doc) => doc.ref.delete()))
      await db.recursiveDelete(db.collection('orgs').doc(orgId))
    }

    // The hold must have elapsed, or `eraseOrg` skips and every assertion
    // below passes for the wrong reason.
    await db
      .collection('orgs')
      .doc(ORG)
      .set({
        name: 'Erasure Credentials Fixture',
        erasureRequestedAt: Timestamp.fromMillis(
          Date.now() - erase.ERASURE_HOLD_MS - 60_000,
        ),
      })
    await db.collection('orgs').doc(OTHER_ORG).set({ name: 'Bystander' })

    // Minted through the real path, so the stored shape is the real shape.
    erasedOrgToken = (
      await apiKeys.mintApiKey({
        orgId: ORG,
        name: 'CI fixture key',
        scopes: ['datasets:read'],
        createdBy: 'e2e-erase-credentials-uid',
      })
    ).token
    bystanderToken = (
      await apiKeys.mintApiKey({
        orgId: OTHER_ORG,
        name: 'CI bystander key',
        scopes: ['datasets:read'],
        createdBy: 'e2e-erase-credentials-uid',
      })
    ).token

    const result = await erase.eraseOrg(ORG)
    // Guard the premise: if the erasure itself was skipped there is nothing
    // to assert about, and a green run would mean nothing.
    expect(result).toMatchObject({ ok: true })
  }, 120_000)

  afterAll(async () => {
    if (!EMULATED) return
    const rows = await db
      .collection('apiKeys')
      .where('orgId', '==', OTHER_ORG)
      .get()
    await Promise.all(rows.docs.map((doc) => doc.ref.delete()))
    await db.recursiveDelete(db.collection('orgs').doc(OTHER_ORG))
  }, 60_000)

  it('THE DEFECT: no apiKeys document still references the erased org', async () => {
    const rows = await db.collection('apiKeys').where('orgId', '==', ORG).get()
    expect(rows.size).toBe(0)
  }, 60_000)

  it('refuses a previously-valid key for the erased org', async () => {
    // The refusal observed, not assumed: the same token that resolved to a
    // principal before the erasure must resolve to nothing after it.
    await expect(apiKeys.verifyApiKey(erasedOrgToken)).resolves.toBeNull()
  }, 60_000)

  it('the org doc is gone, so the route gate 401s even if a key survived', async () => {
    // `authenticateApiV1` refuses on a null org doc. That is the second line
    // of defence, and the reason this defect is not a live-access breach —
    // pinned so a change there cannot quietly promote it into one.
    await expect(organizations.getOrgDoc(ORG)).resolves.toBeNull()
  }, 60_000)

  it('leaves another org\'s key untouched', async () => {
    // A sweep that deletes by field must be bounded by the field. The
    // dangerous fix here is a collection-wide delete that logs out every
    // other customer's integration.
    const verified = await apiKeys.verifyApiKey(bystanderToken)
    expect(verified?.orgId).toBe(OTHER_ORG)
  }, 60_000)
})
