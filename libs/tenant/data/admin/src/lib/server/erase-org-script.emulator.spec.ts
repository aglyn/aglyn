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
 * The manual erasure tool is the served erasure (AGL-1481).
 *
 * `tools/scripts/erase-tenant.mjs` was a SECOND implementation of `eraseOrg`,
 * and a second implementation of a cascade delete is a divergence with a
 * schedule. Within one week of `eraseOrgApiKeys` (AGL-1444) and the SSO,
 * console-domain and org-keyed index sweeps (AGL-1448) landing in the shared
 * function, the script had none of them — so an erasure performed with the
 * tool staff reach for when the cron is stuck left a live API credential, live
 * SSO and console-domain reservations, `orgSlugs` tombstones and a
 * `stripeCustomers` reverse index standing, and printed success.
 *
 * It also wrote a complete verbatim copy of the org tree and every host tree
 * — `webhooks.secret`, `orders.paymentLinkUrl` (a live payable bearer URL),
 * `screens.protection.passwordHash`, `ssoDomains.token` — into the operator's
 * CURRENT WORKING DIRECTORY. AGL-1443 deleted that write from the served path;
 * this was the other producer, and the laptop it landed on has no retention
 * policy, no access control and no record that the file exists.
 *
 * Two claims are proved here, and neither is provable by reading the script:
 *
 *   1. **The operator capabilities live in the shared function.** The plan
 *      (`dryRun`) and the named actor (`actorUid`) are the only two things the
 *      script had that `eraseOrg` did not, so they were added to `eraseOrg`
 *      rather than kept as a second implementation. A plan must destroy
 *      NOTHING and must report the counts the real run then reports — a plan
 *      that undercounts is how an operator is told an erasure is smaller than
 *      it is.
 *   2. **The script writes no file.** The real script is executed here, in an
 *      empty throwaway working directory, and that directory is asserted still
 *      empty afterwards. The call it makes is pinned separately and cheaply in
 *      `tools/scripts/lib/erase-org-cli.test.mjs`, which also fails if any
 *      erasure logic is ported back into the script.
 *
 * Storage is STUBBED, deliberately and non-negotiably, like every other
 * erasure spec: there is no Storage emulator in `npm run firebase:emulate` and
 * the admin app is initialized with a real service-account credential, so an
 * unstubbed `eraseOrg` runs `deleteFiles` against the PRODUCTION bucket. The
 * script subprocess cannot inherit that stub, which is exactly why it is only
 * ever run here in PLAN mode — and why the script itself refuses `--confirm`
 * while `FIRESTORE_EMULATOR_HOST` is set.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-org-script.emulator
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/** Erased by the shared function, with the operator's options. */
const ORG = 'e2e-erase-script-org'
/** Only ever PLANNED against — the subprocess must leave it standing. */
const PLAN_ORG = 'e2e-erase-script-plan-org'
/** Never named by anything below; its rows must all survive. */
const OTHER_ORG = 'e2e-erase-script-bystander'

const MEMBER_UID = 'e2e-erase-script-uid'
const SLUG_CURRENT = 'e2e-erase-script-current'
const SLUG_TOMBSTONE = 'e2e-erase-script-former'

/**
 * The collections an org-keyed sweep covers (AGL-1444/AGL-1448), as one list
 * the whole spec reads from — seeding, the plan's arithmetic and the residue
 * assertions all walk it, so a collection cannot be seeded and then quietly
 * left out of the check.
 */
const ORG_KEYED = [
  'apiKeys',
  'ssoDomains',
  'apiIdempotency',
  'stripeCustomers',
  'orgSlugs',
] as const

// server → lib → src → admin → data → tenant → libs → the workspace root.
const WORKSPACE_ROOT = resolve(__dirname, ...Array(7).fill('..'))
const SCRIPT = join(WORKSPACE_ROOT, 'tools', 'scripts', 'erase-tenant.mjs')

// Before any module reads them: one deletes a real billing customer, the
// others mutate a real Vercel project.
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
const run = promisify(execFile)

describeEmulated('the manual erasure tool IS the served erasure (AGL-1481)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  /** What the plan reported, and what the erasure that followed reported. */
  let plan: import('./erase').EraseOrgResult
  let erased: import('./erase').EraseOrgResult

  /**
   * The org's footprint sampled BETWEEN the plan and the erasure.
   *
   * It has to be a snapshot rather than a live read in the test: the erasure
   * runs in the same `beforeAll`, so by the time any `it` executes the
   * workspace is legitimately gone and a live read cannot tell "the plan
   * destroyed nothing" from "the erasure destroyed everything".
   */
  let afterPlan: { rows: Record<string, number>; org: boolean; host: boolean }

  /** The working directory the real script is run from. Must stay empty. */
  let workingDirectory: string
  /** What the real script printed when it planned `PLAN_ORG`. */
  let scriptRun: { stdout: string; stderr: string }

  /** Every URL the run addressed to Stripe. Must stay empty. */
  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  /** Seed one org's full org-keyed footprint, plus a host and a member. */
  async function seed(orgId: string, slugs: readonly string[]): Promise<void> {
    await db
      .collection('orgs')
      .doc(orgId)
      .set({
        name: `Erasure Script Fixture ${orgId}`,
        slug: slugs[0],
        ownerUid: MEMBER_UID,
        hosts: { [`${orgId}-host`]: true },
        erasureRequestedAt: Timestamp.fromMillis(
          Date.now() - erase.ERASURE_HOLD_MS - 60_000,
        ),
      })
    await db
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(MEMBER_UID)
      .set({ role: 'owner' })
    await db
      .collection('users')
      .doc(MEMBER_UID)
      .collection('orgs')
      .doc(orgId)
      .set({ role: 'owner' })
    await db
      .collection('hosts')
      .doc(`${orgId}-host`)
      .set({ orgId, displayName: 'Fixture site' })
    await db.collection('hostIndex').doc(`${orgId}-host`).set({ orgId })

    await db.collection('apiKeys').doc(`hash-${orgId}`).set({
      orgId,
      name: 'CI fixture key',
      scopes: ['datasets:read'],
    })
    await db
      .collection('ssoDomains')
      .doc(`${orgId}.example.com`)
      .set({ orgId, active: true, token: 'fixture-sso-token' })
    await db
      .collection('apiIdempotency')
      .doc(`idem-${orgId}`)
      .set({ orgId, recordId: 'rec-1', createdAt: Timestamp.now() })
    await db
      .collection('stripeCustomers')
      .doc(`cus_${orgId}`)
      .set({ orgId })
    for (const slug of slugs) {
      await db.collection('orgSlugs').doc(slug).set({ orgId })
    }
  }

  async function purge(orgId: string): Promise<void> {
    for (const collection of ORG_KEYED) {
      const stale = await db.collection(collection).where('orgId', '==', orgId).get()
      await Promise.all(stale.docs.map((doc) => doc.ref.delete()))
    }
    await db.recursiveDelete(db.collection('orgs').doc(orgId))
    await db.recursiveDelete(db.collection('hosts').doc(`${orgId}-host`))
    await db.collection('hostIndex').doc(`${orgId}-host`).delete().catch(() => undefined)
    await db.recursiveDelete(db.collection('users').doc(MEMBER_UID))
  }

  /** Rows in every org-keyed collection that still name this org. */
  async function residue(orgId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const collection of ORG_KEYED) {
      const rows = await db.collection(collection).where('orgId', '==', orgId).get()
      counts[collection] = rows.size
    }
    return counts
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')

    // Leave nothing from an earlier run, or a stale row answers an assertion
    // instead of this one's.
    for (const orgId of [ORG, PLAN_ORG, OTHER_ORG]) await purge(orgId)

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('stripe.com')) {
        stripeCalls.push(url)
        throw new Error(`BLOCKED: this spec must never reach Stripe (${url})`)
      }
      return realFetch(input, init)
    }) as typeof fetch

    await seed(ORG, [SLUG_CURRENT, SLUG_TOMBSTONE])
    await seed(PLAN_ORG, [`${SLUG_CURRENT}-plan`])
    await seed(OTHER_ORG, [`${SLUG_CURRENT}-bystander`])

    // 1. The plan, and the workspace as it stands immediately afterwards.
    //    Nothing may have been destroyed by this call.
    plan = await erase.eraseOrg(ORG, { dryRun: true })
    afterPlan = {
      rows: await residue(ORG),
      org: (await db.collection('orgs').doc(ORG).get()).exists,
      host: (await db.collection('hosts').doc(`${ORG}-host`).get()).exists,
    }

    // 2. The real script, in an empty directory of its own, planning the
    //    OTHER org. Everything it needs is on the command line and the
    //    emulator; nothing it produces may land on disk.
    workingDirectory = mkdtempSync(join(tmpdir(), 'aglyn-erase-script-'))
    scriptRun = await run(process.execPath, [SCRIPT, '--org', PLAN_ORG], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST as string,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'aglyn-main',
        STRIPE_SECRET_KEY: '',
        VERCEL_TOKEN: '',
      },
      maxBuffer: 8 * 1024 * 1024,
    })

    // 3. The erasure itself, with the operator's actor. Only now is anything
    //    destroyed, and only for ORG.
    erased = await erase.eraseOrg(ORG, { actorUid: 'script:erase-tenant' })
    // The premise is guarded by its own test rather than by a throw here: if
    // the plan wrongly erased the workspace, this second call answers
    // `not-found` — and a `beforeAll` failure reports THAT everywhere instead
    // of the assertion that actually caught it.
  }, 600_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    rmSync(workingDirectory, { recursive: true, force: true })
    await purge(PLAN_ORG)
    await purge(OTHER_ORG)
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${ORG}`)
      .get()
    await Promise.all(rows.docs.map((doc) => doc.ref.delete()))
  }, 120_000)

  // -------------------------------------------------- 1. the plan is a plan

  it('a plan is not an erasure: `ok` is false and the reason says so', () => {
    // `ok` means the org was erased. A caller that reads a plan as an erasure
    // is the one mistake this shape has to make impossible.
    expect(plan).toMatchObject({ ok: false, skippedReason: 'dry-run' })
  })

  it('THE DEFECT: a plan destroys nothing', () => {
    // Against the shared function BEFORE AGL-1481 this is where it fails: the
    // options argument did not exist, so a "plan" erased the workspace and
    // every count below came back zero.
    expect(afterPlan).toEqual({
      rows: {
        apiKeys: 1,
        ssoDomains: 1,
        apiIdempotency: 1,
        stripeCustomers: 1,
        orgSlugs: 2,
      },
      org: true,
      host: true,
    })
  })

  it('a plan writes no audit row — an erasure that did not happen is not one', async () => {
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${PLAN_ORG}`)
      .get()
    expect(rows.size).toBe(0)
  }, 60_000)

  it('the plan counted exactly what the erasure then destroyed', async () => {
    // A plan produced by a second enumeration of the sweeps is a plan that
    // undercounts the moment a sweep is added — which is the AGL-1481 defect
    // in miniature. Both numbers come from the same code, so they agree.
    const counts = (result: import('./erase').EraseOrgResult) => ({
      hosts: result.hosts,
      members: result.members,
      apiKeys: result.apiKeys,
      ssoDomains: result.ssoDomains,
      consoleDomains: result.consoleDomains,
      apiIdempotency: result.apiIdempotency,
      stripeIndex: result.stripeIndex,
      slugs: result.slugs,
    })
    expect(counts(plan)).toEqual(counts(erased))
    // And the plan is not vacuously equal to an empty erasure.
    expect(counts(plan)).toEqual({
      hosts: 1,
      members: 1,
      apiKeys: 1,
      ssoDomains: 1,
      consoleDomains: 0,
      apiIdempotency: 1,
      stripeIndex: 1,
      slugs: 2,
    })
  })

  // ------------------------------------- 2. the residue, and whose it isn't

  it('the erasure that followed the plan actually ran', () => {
    // Guard the premise. Without this a suite in which the PLAN erased the
    // workspace still reports empty residue everywhere and reads as green.
    expect(erased).toMatchObject({ ok: true })
  })

  it('THE DEFECT: the erasure leaves no org-keyed row behind', async () => {
    // Precisely the twelve-collection class AGL-1444 and AGL-1448 closed on
    // the served path and the script never gained. Reached here through the
    // same function the script now calls.
    expect(await residue(ORG)).toEqual({
      apiKeys: 0,
      ssoDomains: 0,
      apiIdempotency: 0,
      stripeCustomers: 0,
      orgSlugs: 0,
    })
  }, 60_000)

  it('takes the naming history, not only the current slug', async () => {
    for (const slug of [SLUG_CURRENT, SLUG_TOMBSTONE]) {
      const doc = await db.collection('orgSlugs').doc(slug).get()
      expect([slug, doc.exists]).toEqual([slug, false])
    }
  }, 60_000)

  it('leaves the org tree, its host and the member back-reference gone', async () => {
    const org = await db.collection('orgs').doc(ORG).get()
    const host = await db.collection('hosts').doc(`${ORG}-host`).get()
    const index = await db.collection('hostIndex').doc(`${ORG}-host`).get()
    const backReference = await db
      .collection('users')
      .doc(MEMBER_UID)
      .collection('orgs')
      .doc(ORG)
      .get()
    expect([org.exists, host.exists, index.exists, backReference.exists]).toEqual([
      false,
      false,
      false,
      false,
    ])
  }, 60_000)

  it('leaves every other org standing', async () => {
    // The dangerous fix in this class is one that over-sweeps: a collection
    // sweep here logs out every other customer's integration.
    expect(await residue(OTHER_ORG)).toEqual({
      apiKeys: 1,
      ssoDomains: 1,
      apiIdempotency: 1,
      stripeCustomers: 1,
      orgSlugs: 1,
    })
  }, 60_000)

  it('audits the OPERATOR, not the cron', async () => {
    // The single most irreversible action the platform performs, run by hand
    // by a person. An erasure trail that names the scheduler names the wrong
    // actor.
    const rows = await db
      .collection('adminAudit')
      .where('target', '==', `orgs/${ORG}`)
      .get()
    const actors = rows.docs
      .filter((doc) => doc.get('action') === 'org.erased')
      .map((doc) => doc.get('actorUid'))
    expect(actors).toEqual(['script:erase-tenant'])
  }, 60_000)

  it('never called Stripe', () => {
    expect(stripeCalls).toEqual([])
  })

  // ------------------------------------------- 3. nothing reaches the disk

  it('THE DEFECT: the script writes NO file to its working directory', () => {
    // The whole reason this issue exists. Before AGL-1481 a confirmed run
    // dropped `erasure-org-{orgId}-{now}.json` here — the org tree and every
    // host tree verbatim, secrets included — with no retention and no record.
    expect(readdirSync(workingDirectory)).toEqual([])
  })

  it('the script planned successfully and printed the counts', () => {
    expect(scriptRun.stdout).toContain(`PLAN for orgs/${PLAN_ORG}`)
    expect(scriptRun.stdout).toContain('nothing has been deleted')
    // The counts come from the shared function's result object, so a new sweep
    // appears here without the script being touched.
    expect(scriptRun.stdout).toMatch(/\bapiKeys\b/)
    expect(scriptRun.stdout).toMatch(/\bslugs\b/)
  })

  it('the script it planned against is untouched', async () => {
    const org = await db.collection('orgs').doc(PLAN_ORG).get()
    expect(org.exists).toBe(true)
    expect(await residue(PLAN_ORG)).toEqual({
      apiKeys: 1,
      ssoDomains: 1,
      apiIdempotency: 1,
      stripeCustomers: 1,
      orgSlugs: 1,
    })
  }, 60_000)

  it('the script refuses --confirm while pointed at the emulator', async () => {
    // There is no Storage emulator, so a confirmed run here would delete
    // Firestore rows that do not matter and sweep the production bucket, which
    // does. Proven by running it, in the same empty directory.
    const failure = await run(process.execPath, [SCRIPT, '--org', PLAN_ORG, '--confirm'], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST as string,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'aglyn-main',
      },
      maxBuffer: 8 * 1024 * 1024,
    }).catch((error: { code?: number; stderr?: string }) => error)
    expect((failure as { code?: number }).code).toBe(1)
    expect((failure as { stderr?: string }).stderr).toContain('Storage emulator')
    expect(readdirSync(workingDirectory)).toEqual([])
  }, 600_000)
})
