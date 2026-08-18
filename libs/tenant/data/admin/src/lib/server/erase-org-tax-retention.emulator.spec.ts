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
 * An org erasure must LEAVE the org's tax records standing (AGL-1811).
 *
 * `platformRevenue/{invoiceId}` is a top-level collection carrying `orgId`
 * as a field — byte-for-byte the shape `deleteDocsByOrgId` sweeps for
 * `apiKeys`, `ssoDomains`, `apiIdempotency` and `stripeCustomers` (AGL-1444/
 * AGL-1448). Every prior addition to that sweep was a missing-cleanup FIX,
 * so the next person extending it has every reason to add this collection
 * too — and doing so would delete per-transaction tax filing records that
 * carry a statutory retention obligation. GDPR Art. 17(3)(b) exempts them
 * from erasure; the quarterly Texas return is their sum, and un-filing a
 * period is not a bug anyone gets to fix afterwards.
 *
 * So this spec is the tripwire the erase.ts doc comment points at: it runs a
 * REAL `eraseOrg` against the emulator and asserts the erased org's revenue
 * rows SURVIVE — while the `stripeCustomers` row dies, proving the erasure
 * genuinely ran its org-keyed sweeps rather than skipping them.
 *
 * Integrations are disarmed exactly as the other erasure specs do it:
 * `STRIPE_SECRET_KEY` cleared (localhost carries the LIVE key) with fetch
 * hard-blocked toward Stripe, `VERCEL_TOKEN` cleared, Storage stubbed (no
 * Storage emulator; the admin app holds a production credential).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-tax-retention.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const SLUG = 'e2e-erase-tax-retention'
const OWNER_UID = 'e2e-erase-tax-retention-uid'
const CUSTOMER_ID = 'cus_e2eEraseTaxFixture'
const INVOICE_IDS = ['in_e2eTaxKeep1', 'in_e2eTaxKeep2'] as const

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

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated(
  'an erased org keeps its platformRevenue tax records (AGL-1811)',
  () => {
    let db: Firestore
    let erase: typeof import('./erase')
    let organizations: typeof import('./organizations')
    let orgBilling: typeof import('./org-billing')

    let orgId: string

    /** Every URL the run addressed to Stripe. Must stay empty. */
    const stripeCalls: string[] = []
    const realFetch = globalThis.fetch

    beforeAll(async () => {
      db = getFirestore()
      erase = await import('./erase')
      organizations = await import('./organizations')
      orgBilling = await import('./org-billing')

      // Leave nothing from an earlier run.
      const reservation = await db.collection('orgSlugs').doc(SLUG).get()
      const staleOrgId = reservation.get('orgId') as string | undefined
      if (staleOrgId) {
        await db.recursiveDelete(db.collection('orgs').doc(staleOrgId))
        const staleIndex = await db
          .collection('stripeCustomers')
          .where('orgId', '==', staleOrgId)
          .get()
        await Promise.all(staleIndex.docs.map((doc) => doc.ref.delete()))
      }
      await db.collection('orgSlugs').doc(SLUG).delete().catch(() => undefined)
      await db.recursiveDelete(db.collection('users').doc(OWNER_UID))
      for (const invoiceId of INVOICE_IDS) {
        await db.collection('platformRevenue').doc(invoiceId).delete()
      }

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('stripe.com')) {
          stripeCalls.push(url)
          throw new Error(`BLOCKED: this spec must never reach Stripe (${url})`)
        }
        return realFetch(input, init)
      }) as typeof fetch

      orgId = await organizations.createOrganization({
        name: 'Erasure Tax Retention Fixture',
        slug: SLUG,
        ownerUid: OWNER_UID,
      })
      // The reverse index through its only writer, so the erasure has a real
      // org-keyed sweep to run — the control that proves the sweeps executed.
      await orgBilling.writeOrgBilling(orgId, { stripeCustomerId: CUSTOMER_ID })

      // Two revenue rows in the exact shape the webhook stores — org-keyed by
      // FIELD, the shape `deleteDocsByOrgId` would sweep if wrongly extended.
      for (const invoiceId of INVOICE_IDS) {
        await db.collection('platformRevenue').doc(invoiceId).set({
          orgId,
          subscriptionId: 'sub_e2e_tax',
          stripeCustomerId: CUSTOMER_ID,
          grossCents: 10660,
          totalCents: 10660,
          taxCents: 660,
          netCents: 10000,
          currency: 'usd',
          automaticTax: true,
          customerAddress: {
            country: 'US',
            state: 'TX',
            city: 'Jarrell',
            postalCode: '76537',
          },
          taxLines: [
            {
              amountCents: 660,
              taxabilityReason: 'taxable_basis_reduced',
              taxRateId: 'txr_tx_state',
              taxableAmountCents: 8000,
            },
          ],
          paidAt: Timestamp.fromDate(new Date('2026-09-15T12:00:00Z')),
          recordedAt: Timestamp.now(),
        })
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
      for (const invoiceId of INVOICE_IDS) {
        await db.collection('platformRevenue').doc(invoiceId).delete()
      }
      await db.recursiveDelete(db.collection('users').doc(OWNER_UID))
    }, 60_000)

    it('THE RETENTION: every platformRevenue row still names the erased org', async () => {
      const rows = await db
        .collection('platformRevenue')
        .where('orgId', '==', orgId)
        .get()
      expect(rows.docs.map((doc) => doc.id).sort()).toEqual([...INVOICE_IDS].sort())
      // Intact, not merely present: the figures a return files from.
      const row = await db
        .collection('platformRevenue')
        .doc(INVOICE_IDS[0])
        .get()
      expect(row.get('taxCents')).toBe(660)
      expect(row.get('customerAddress')).toMatchObject({ state: 'TX' })
    }, 60_000)

    it('CONTROL: the org itself and its stripeCustomers row are genuinely gone', async () => {
      // Without this, "the tax rows survived" could mean "the erasure never
      // ran" — the sweeps must have executed for survival to be a decision.
      const org = await db.collection('orgs').doc(orgId).get()
      expect(org.exists).toBe(false)
      const index = await db
        .collection('stripeCustomers')
        .where('orgId', '==', orgId)
        .get()
      expect(index.size).toBe(0)
    }, 60_000)

    it('never called Stripe', async () => {
      expect(stripeCalls).toEqual([])
    }, 60_000)
  },
)
