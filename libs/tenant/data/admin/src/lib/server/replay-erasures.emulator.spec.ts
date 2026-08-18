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
 * A deletion instruction must survive a restore (AGL-1975).
 *
 * Live DPA §11, verbatim: *"a deletion instruction survives any restoration —
 * data deleted at Customer's instruction and later restored from a backup will
 * be deleted again."* Nothing implemented it, and the way it breaks is
 * specific: a Firestore import is **merge-by-id, not replace**
 * (`docs/DISASTER_RECOVERY.md` Procedures C and D), so importing a
 * pre-erasure snapshot into `(default)` silently reinstates every document an
 * erasure deleted — during an incident, when nobody is reading a DPA.
 *
 * This spec stages that exact accident against a live emulator: an org is
 * really erased, then **written back the way a merge-by-id import writes it
 * back**, and `replayErasuresSince` has to notice and finish the job.
 *
 * ## What each case holds down
 *
 * 1. **The resurrection is caught and re-erased.** The org doc is standing
 *    again; after the replay it is gone again, and so is the `orgSlugs`
 *    reservation — proof the replay ran the real cascade rather than deleting
 *    one document.
 * 2. **The request is reinstated first.** This is the part a naive replay gets
 *    wrong. `eraseOrg` re-reads `erasureRequestedAt` and the 7-day hold on
 *    purpose, so a restored org carrying no request — the customer asked AFTER
 *    the snapshot — is refused with `no-request` and the erasure silently does
 *    not replay. The fixture resurrects the org WITHOUT `erasureRequestedAt`
 *    for exactly this reason; the replay recovers the instant from the audit
 *    row's `after.requestedAt`.
 * 3. **A window older than the hot audit span is `incomplete`, not empty.** An
 *    empty list has two indistinguishable causes — nothing was erased, or the
 *    rows have aged into the Storage archive — and only one of them means the
 *    promise was kept.
 * 4. **The negative control**: an org erased BEFORE the snapshot instant, and
 *    a live bystander org that was never erased at all, are both untouched. A
 *    replay without this passes just as well by erasing everything it finds,
 *    which on a production restore is the worst button on the platform.
 *
 * Integrations disarmed as in every sibling erasure spec.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns replay-erasures.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/** Erased AFTER the snapshot instant — must be re-erased. */
const RESURRECTED_SLUG = 'e2e-replay-resurrected'
const RESURRECTED_OWNER = 'e2e-replay-resurrected-uid'
/** Erased BEFORE the snapshot instant — outside the window, must be ignored. */
const OLD_SLUG = 'e2e-replay-old'
const OLD_OWNER = 'e2e-replay-old-uid'
/** Never erased at all — the live bystander. */
const LIVE_SLUG = 'e2e-replay-live'
const LIVE_OWNER = 'e2e-replay-live-uid'

const ALL_SLUGS = [RESURRECTED_SLUG, OLD_SLUG, LIVE_SLUG]

delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

jest.mock('./auth-pools', () => ({
  findUserByUidAcrossPools: async () => null,
  authForPool: () => ({ deleteUser: async () => undefined }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('a deletion instruction survives a restore (AGL-1975)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let replay: typeof import('./replay-erasures')
  let organizations: typeof import('./organizations')

  let resurrectedOrgId: string
  let oldOrgId: string
  let liveOrgId: string

  /** The instant the imagined snapshot was taken. */
  let snapshotMs: number

  let planResult: Awaited<
    ReturnType<typeof import('./replay-erasures').replayErasuresSince>
  >
  let applyResult: Awaited<
    ReturnType<typeof import('./replay-erasures').replayErasuresSince>
  >

  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  async function purge(): Promise<void> {
    const fixtureOrgIds = new Set<string>()
    for (const orgId of [resurrectedOrgId, oldOrgId, liveOrgId]) {
      if (orgId) fixtureOrgIds.add(`orgs/${orgId}`)
    }
    for (const slug of ALL_SLUGS) {
      const reservation = await db.collection('orgSlugs').doc(slug).get()
      const staleOrgId = reservation.get('orgId') as string | undefined
      if (staleOrgId) {
        fixtureOrgIds.add(`orgs/${staleOrgId}`)
        await db.recursiveDelete(db.collection('orgs').doc(staleOrgId))
      }
      await db.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    }
    for (const uid of [RESURRECTED_OWNER, OLD_OWNER, LIVE_OWNER]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
    }
    // Audit rows this fixture wrote, so a re-run does not read its own past.
    // The two kinds are keyed differently and both matter: `org.erased` rows
    // name `orgs/{id}` and are found via the slug reservations above, while
    // `erasures.replayed` rows are targeted `restore/{iso}` and carry no
    // fixture id at all — only the actor identifies them. Filtering those by
    // target left every previous run's row in place, and the "a plan writes no
    // audit row" assertion counted them.
    const erased = await db
      .collection('adminAudit')
      .where('action', '==', 'org.erased')
      .get()
    await Promise.all(
      erased.docs
        .filter((doc) => fixtureOrgIds.has(String(doc.get('target') ?? '')))
        .map((doc) => doc.ref.delete()),
    )
    const replayed = await db
      .collection('adminAudit')
      .where('action', '==', 'erasures.replayed')
      .get()
    await Promise.all(
      replayed.docs
        .filter((doc) =>
          String(doc.get('actorUid') ?? '').startsWith('spec:replay'),
        )
        .map((doc) => doc.ref.delete()),
    )
    const decoys = await db
      .collection('adminAudit')
      .where('actorUid', '==', 'spec:replay-fixture')
      .get()
    await Promise.all(decoys.docs.map((doc) => doc.ref.delete()))
  }

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

  /**
   * Re-stamp an org's audit row so the replay window can be reasoned about.
   * `at` is a server timestamp written by `eraseOrg`, and this fixture needs
   * one row before the snapshot instant and one after.
   */
  async function stampAuditRow(orgId: string, atMs: number): Promise<void> {
    const rows = await db
      .collection('adminAudit')
      .where('action', '==', 'org.erased')
      .get()
    const row = rows.docs.find((doc) => doc.get('target') === `orgs/${orgId}`)
    expect(row).toBeDefined()
    await row!.ref.set({ at: Timestamp.fromMillis(atMs) }, { merge: true })
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    replay = await import('./replay-erasures')
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

    resurrectedOrgId = await organizations.createOrganization({
      name: 'Replay Resurrected Fixture',
      slug: RESURRECTED_SLUG,
      ownerUid: RESURRECTED_OWNER,
    })
    oldOrgId = await organizations.createOrganization({
      name: 'Replay Pre-Snapshot Fixture',
      slug: OLD_SLUG,
      ownerUid: OLD_OWNER,
    })
    liveOrgId = await organizations.createOrganization({
      name: 'Replay Live Bystander',
      slug: LIVE_SLUG,
      ownerUid: LIVE_OWNER,
    })

    // Both erasures really run, through the real cascade.
    expect(await eraseNow(oldOrgId)).toMatchObject({ ok: true })
    expect(await eraseNow(resurrectedOrgId)).toMatchObject({ ok: true })

    // The snapshot sits between them: the old erasure is outside the restored
    // window and must be ignored; the other is inside it.
    snapshotMs = Date.now() - 60 * 60 * 1000
    await stampAuditRow(oldOrgId, snapshotMs - 60 * 60 * 1000)
    await stampAuditRow(resurrectedOrgId, snapshotMs + 60 * 1000)

    // A NON-erasure audit row inside the window, targeting the LIVE org.
    // Ordinary staff actions write these constantly, and without one here the
    // live-bystander control below cannot tell a replay that reads `action`
    // from one that replays every row whose target looks like an org — the
    // first mutation of this function anybody would plausibly ship.
    await db.collection('adminAudit').add({
      actorUid: 'spec:replay-fixture',
      action: 'org.updated',
      target: `orgs/${liveOrgId}`,
      before: {},
      after: {},
      at: Timestamp.fromMillis(snapshotMs + 120_000),
    })

    // THE ACCIDENT. A merge-by-id import writes the snapshot's documents back
    // by id. Deliberately WITHOUT `erasureRequestedAt`: the snapshot predates
    // the request, which is the case a naive replay gets refused on.
    await db.collection('orgs').doc(resurrectedOrgId).set({
      name: 'Replay Resurrected Fixture',
      slug: RESURRECTED_SLUG,
      ownerUid: RESURRECTED_OWNER,
      plan: 'pro',
    })
    await db
      .collection('orgSlugs')
      .doc(RESURRECTED_SLUG)
      .set({ orgId: resurrectedOrgId })

    planResult = await replay.replayErasuresSince({ sinceMs: snapshotMs })
    applyResult = await replay.replayErasuresSince({
      sinceMs: snapshotMs,
      dryRun: false,
      actorUid: 'spec:replay',
    })
  }, 300_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    await purge()
  }, 120_000)

  it('THE DEFECT: a merge-by-id resurrection is erased again', async () => {
    const org = await db.collection('orgs').doc(resurrectedOrgId).get()
    expect(org.exists).toBe(false)
    // The whole cascade, not one document: the slug reservation the import
    // also reinstated is released too.
    const slug = await db.collection('orgSlugs').doc(RESURRECTED_SLUG).get()
    expect(slug.exists).toBe(false)

    expect(
      applyResult.entries.find((entry) => entry.id === resurrectedOrgId),
    ).toMatchObject({ kind: 'org', outcome: 'replayed' })
    expect(applyResult.ok).toBe(true)
  }, 60_000)

  it('the request is reinstated from the audit row, or nothing replays', async () => {
    // The resurrected org carried NO `erasureRequestedAt` — `eraseOrg` refuses
    // that with `no-request` by design. A `blocked` entry here is the naive
    // implementation; `replayed` above is only reachable because the replay
    // recovered the instant from `after.requestedAt`.
    const entry = applyResult.entries.find(
      (row) => row.id === resurrectedOrgId,
    )
    expect(entry?.detail).toBeUndefined()
    expect(entry?.outcome).not.toBe('blocked')
  }, 60_000)

  it('a plan reports the same target and changes nothing', async () => {
    expect(planResult.dryRun).toBe(true)
    expect(
      planResult.entries.find((entry) => entry.id === resurrectedOrgId),
    ).toMatchObject({ outcome: 'replayed', detail: 'would re-erase (plan)' })
    // The plan ran BEFORE the apply and must not have written an audit row.
    const rows = await db
      .collection('adminAudit')
      .where('action', '==', 'erasures.replayed')
      .get()
    const mine = rows.docs.filter((doc) => doc.get('actorUid') === 'spec:replay')
    expect(mine).toHaveLength(1)
  }, 60_000)

  it('NEGATIVE CONTROL: an erasure BEFORE the snapshot is not in the window', async () => {
    expect(
      applyResult.entries.find((entry) => entry.id === oldOrgId),
    ).toBeUndefined()
    expect(
      planResult.entries.find((entry) => entry.id === oldOrgId),
    ).toBeUndefined()
  }, 60_000)

  it('NEGATIVE CONTROL: a live org that was never erased survives the replay', async () => {
    // Without this, a replay that erased every org it could see would pass
    // every assertion above. On a production restore that is the worst
    // possible outcome of the tool meant to make one safe.
    //
    // This org HAS an audit row inside the window — an ordinary `org.updated`
    // — so the control discriminates on `action`, not merely on presence. A
    // replay that dropped the action filter and worked from the target path
    // alone would erase a live customer's workspace here.
    const org = await db.collection('orgs').doc(liveOrgId).get()
    expect(org.exists).toBe(true)
    const slug = await db.collection('orgSlugs').doc(LIVE_SLUG).get()
    expect(slug.get('orgId')).toBe(liveOrgId)
    expect(
      applyResult.entries.find((entry) => entry.id === liveOrgId),
    ).toBeUndefined()
  }, 60_000)

  it('an erasure that did NOT come back is reported absent, not replayed', async () => {
    // Re-running over the same window now finds nothing standing. `absent` is
    // the honest word: the restore did not reach it.
    const again = await replay.replayErasuresSince({
      sinceMs: snapshotMs,
      dryRun: false,
      actorUid: 'spec:replay-again',
    })
    expect(
      again.entries.find((entry) => entry.id === resurrectedOrgId),
    ).toMatchObject({ outcome: 'absent' })
    expect(again.ok).toBe(true)
  }, 60_000)

  it('a window older than the hot audit span is INCOMPLETE, not empty', async () => {
    // An empty list has two causes and only one of them means the promise was
    // kept. 90 days is when `/api/admin/audit-archive` moves rows to Storage.
    const stale = await replay.replayErasuresSince({
      sinceMs: Date.now() - replay.AUDIT_HOT_WINDOW_MS - 24 * 60 * 60 * 1000,
    })
    expect(stale.incomplete).toBe('audit-window')
    expect(stale.ok).toBe(false)
  }, 60_000)

  it('never called Stripe', () => {
    expect(stripeCalls).toEqual([])
  })
})
