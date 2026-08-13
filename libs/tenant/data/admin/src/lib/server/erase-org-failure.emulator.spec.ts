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
 * An erasure that ABORTS must leave a durable trace (AGL-1455).
 *
 * Aborting is the correct behaviour and is not what this spec argues with:
 * when the export cannot be written, `eraseOrg` deletes nothing, and both
 * tests below assert the org's documents are still standing. The defect is
 * that the abort was invisible. `skippedReason` reached exactly one place —
 * the cron endpoint's HTTP response body — and nobody reads a scheduler's
 * 200. `erasureRequestedAt` stays set, so the next run picks the same org up
 * and fails identically, forever, while the customer who requested the
 * erasure is told nothing.
 *
 * Two failure shapes, because they are not the same incident:
 *
 *  1. The export fails. Nothing has been deleted and nothing has been
 *     written — the workspace is exactly as it was.
 *  2. A step AFTER the export write throws (`eraseOrgApiKeys`,
 *     `eraseOrgSsoDomains`, `eraseOrgIdempotencyKeys`, `recursiveDelete` —
 *     none of them guarded). This is the worst state the system can be in:
 *     the workspace survives AND a complete dump of it is already sitting in
 *     the bucket, with some of its credentials already destroyed. Nothing
 *     recorded that at all.
 *
 * The audit row must carry ids, counts, a step name and a timestamp — and no
 * customer data. The surrounding issue (AGL-1443) is that this path already
 * writes too much, so the fix for the trace must not become a second copy of
 * the payload. `PII_PROBE` is seeded into the org tree and asserted absent
 * from the row.
 *
 * Storage is STUBBED, deliberately and non-negotiably, as in every other
 * erasure spec: there is no Storage emulator and the admin app is initialized
 * with a real service-account credential, so an unstubbed `eraseOrg` writes
 * its export bundle to — and runs `deleteFiles` against — the PRODUCTION
 * bucket. Here the stub is also the instrument: `mockSaveShouldFail` is how
 * the export failure is forced, and `mockSavedPaths` is how the second test
 * proves a complete dump really was written before the throw.
 *
 * The seed carries no `slug` and no Stripe customer id, and both integrations
 * are disarmed at module load anyway (localhost carries the LIVE Stripe key).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-failure.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/** The org whose export write is forced to reject. */
const ORG_EXPORT = 'e2e-erase-failure-export-org'
/** The org whose org-tree delete is forced to throw, after the export. */
const ORG_POST_EXPORT = 'e2e-erase-failure-post-export-org'

const MEMBER_UID = 'e2e-erase-failure-uid'

/**
 * Seeded into the org tree in two places. An erasure-failure record is
 * allowed to name ids and counts; it is not allowed to carry the content it
 * failed to erase.
 */
const PII_PROBE = 'erasure-failure-fixture@example.invalid'

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
 * so every bucket call is a recorder here. `mockSaveShouldFail` forces the
 * export failure; `mockSavedPaths` records what a successful write persisted.
 */
let mockSaveShouldFail = false
const mockSavedPaths: string[] = []
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        save: async () => {
          if (mockSaveShouldFail) {
            throw new Error('BLOCKED: simulated export write failure')
          }
          mockSavedPaths.push(path)
        },
      }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('an aborted org erasure is recorded durably (AGL-1455)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  /** Every URL the run addressed to Stripe. Must stay empty. */
  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  const auditRows = async (orgId: string) => {
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${orgId}`)
      .get()
    return rows.docs.map((doc) => doc.data())
  }

  async function purge(orgId: string): Promise<void> {
    const keys = await db.collection('apiKeys').where('orgId', '==', orgId).get()
    await Promise.all(keys.docs.map((doc) => doc.ref.delete()))
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${orgId}`)
      .get()
    await Promise.all(rows.docs.map((doc) => doc.ref.delete()))
    await db.recursiveDelete(db.collection('orgs').doc(orgId))
  }

  /**
   * A workspace with content, a member and a credential, whose hold has
   * elapsed — without that last part `eraseOrg` skips on `hold-active` and
   * every assertion below passes for the wrong reason.
   */
  async function seed(orgId: string): Promise<void> {
    await db
      .collection('orgs')
      .doc(orgId)
      .set({
        name: 'Erasure Failure Fixture',
        erasureRequestedAt: Timestamp.fromMillis(
          Date.now() - erase.ERASURE_HOLD_MS - 60_000,
        ),
      })
    await db
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(MEMBER_UID)
      .set({ email: PII_PROBE, role: 'owner' })
    await db
      .collection('orgs')
      .doc(orgId)
      .collection('datasets')
      .doc('contacts')
      .set({ name: 'Contacts', primaryContact: PII_PROBE })
    // Swept by `eraseOrgApiKeys` BEFORE the content delete, so in the
    // post-export test it is the proof that the erasure got part-way.
    await db
      .collection('apiKeys')
      .doc(`${orgId}-fixture-hash`)
      .set({ orgId, name: 'CI fixture key', scopes: ['datasets:read'] })
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
    for (const orgId of [ORG_EXPORT, ORG_POST_EXPORT]) await purge(orgId)
  }, 120_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    for (const orgId of [ORG_EXPORT, ORG_POST_EXPORT]) await purge(orgId)
    expect(stripeCalls).toEqual([])
  }, 120_000)

  describe('the export write fails', () => {
    let result: import('./erase').EraseOrgResult

    beforeAll(async () => {
      await seed(ORG_EXPORT)
      mockSaveShouldFail = true
      try {
        result = await erase.eraseOrg(ORG_EXPORT)
      } finally {
        mockSaveShouldFail = false
      }
    }, 120_000)

    it('aborts without deleting anything — the org is still there', async () => {
      expect(result).toMatchObject({ ok: false, skippedReason: 'export-failed' })
      const org = await db.collection('orgs').doc(ORG_EXPORT).get()
      const members = await db
        .collection('orgs')
        .doc(ORG_EXPORT)
        .collection('members')
        .get()
      const datasets = await db
        .collection('orgs')
        .doc(ORG_EXPORT)
        .collection('datasets')
        .get()
      const keys = await db
        .collection('apiKeys')
        .where('orgId', '==', ORG_EXPORT)
        .get()
      expect([org.exists, members.size, datasets.size, keys.size]).toEqual([
        true,
        1,
        1,
        1,
      ])
    }, 60_000)

    it('THE DEFECT: the failed attempt leaves an adminAudit row', async () => {
      const rows = await auditRows(ORG_EXPORT)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        actorUid: 'cron:run-erasures',
        action: 'org.erase-failed',
        target: `orgs/${ORG_EXPORT}`,
        after: { failedStep: 'export', exportWritten: false },
      })
      // Same shape as the success row it stands in for: a timestamp, and the
      // inventory of what was found.
      expect(rows[0]['at']).toBeTruthy()
      expect(rows[0]['before']).toMatchObject({ hosts: 0, members: 1 })
    }, 60_000)

    it('records ids and counts, never the content it failed to erase', async () => {
      const rows = await auditRows(ORG_EXPORT)
      expect(JSON.stringify(rows)).not.toContain(PII_PROBE)
    }, 60_000)
  })

  describe('a step AFTER the export write throws', () => {
    beforeAll(async () => {
      await seed(ORG_POST_EXPORT)
      // `recursiveDelete` is one of the unguarded post-export steps named in
      // AGL-1455, and the last one — so the export is on disk and the
      // credential sweep has already run when it fails. Patched on the
      // instance `eraseOrg` itself resolves (`getFirestore(getApp())`), and
      // restored immediately so the spec's own cleanup still works.
      const real = db.recursiveDelete.bind(db)
      ;(db as unknown as Record<string, unknown>)['recursiveDelete'] = async (
        ref: FirebaseFirestore.DocumentReference,
      ) => {
        if (ref?.path === `orgs/${ORG_POST_EXPORT}`) {
          throw new Error('BLOCKED: simulated recursiveDelete failure')
        }
        return real(ref)
      }
      try {
        await expect(erase.eraseOrg(ORG_POST_EXPORT)).rejects.toThrow('BLOCKED')
      } finally {
        ;(db as unknown as Record<string, unknown>)['recursiveDelete'] = real
      }
    }, 120_000)

    it('the org survives the throw — its documents are still present', async () => {
      const org = await db.collection('orgs').doc(ORG_POST_EXPORT).get()
      const members = await db
        .collection('orgs')
        .doc(ORG_POST_EXPORT)
        .collection('members')
        .get()
      const datasets = await db
        .collection('orgs')
        .doc(ORG_POST_EXPORT)
        .collection('datasets')
        .get()
      expect([org.exists, members.size, datasets.size]).toEqual([true, 1, 1])
    }, 60_000)

    it('and a complete dump of it is already in the bucket', () => {
      // The half that makes this the worst state the system can be in: the
      // workspace still exists and its full export has been persisted.
      expect(
        mockSavedPaths.filter((path) =>
          path.startsWith(`erasures/${ORG_POST_EXPORT}/`),
        ),
      ).toHaveLength(1)
    }, 60_000)

    it('THE DEFECT: the partial failure is recorded, dump and all', async () => {
      const rows = await auditRows(ORG_POST_EXPORT)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        actorUid: 'cron:run-erasures',
        action: 'org.erase-failed',
        target: `orgs/${ORG_POST_EXPORT}`,
        after: {
          failedStep: 'org-tree',
          exportWritten: true,
          // The row has to name the object, or nobody can find the dump that
          // outlived the workspace.
          exportPath: expect.stringContaining(`erasures/${ORG_POST_EXPORT}/`),
          // How far it got: the credential is already destroyed.
          apiKeys: 1,
        },
      })
      expect(rows[0]['at']).toBeTruthy()
    }, 60_000)

    it('the credential really was destroyed while the org stands', async () => {
      const keys = await db
        .collection('apiKeys')
        .where('orgId', '==', ORG_POST_EXPORT)
        .get()
      expect(keys.size).toBe(0)
    }, 60_000)

    it('records ids and counts, never the content it failed to erase', async () => {
      const rows = await auditRows(ORG_POST_EXPORT)
      expect(JSON.stringify(rows)).not.toContain(PII_PROBE)
    }, 60_000)
  })
})
