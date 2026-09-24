/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * A consent group change, end to end against the real Firestore emulator
 * (AGL-3320, I11).
 *
 * ## What runs for real
 *
 * Everything but the clock and the credential. The change is started and
 * advanced by the executor the route calls, the CRM's participant is the one
 * this app's boot manifest registers, and the verdicts are asked of the send
 * paths themselves — `filterSendableForHost`, `filterTopicSendable`,
 * `marketingSendVerdict` and `readMarketingBasis` — over the declaration the
 * change left behind. A fake clock stands in for the six-minute sweep delay.
 *
 * ## The case that matters
 *
 * A person P and a group Northwind = {Shop, Blog, Bookings}. P unsubscribed on
 * the Shop, left the newsletter on the Blog, asked the Shop for monthly mail,
 * and declined email on the Shop in the CRM; the Blog holds a grant P gave the
 * group. Northwind keeps P's profile, notes, owner and order total, and only
 * the Shop ever met P. Then the Shop leaves the group. Every refusal must
 * still hold on both sides — the Blog must not mail P, the Shop must not send
 * P the newsletter — and the Shop keeps a copy of the record it earned.
 *
 * ## The delete guard (I9)
 *
 * `/api/hosts/delete` refuses a site in a declared group and a site a change
 * in flight names. That guard is the prerequisites' (the delete route and
 * `eraseHost`); it is asserted here, through the real route, because the
 * marker this change writes is what it reads.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 npx jest -c apps/console/jest.config.ts \
 *     --testPathPatterns consent-group-change.emulator
 */

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { readMarketingBasis } from '@aglyn/aglyn/app-utils/marketing-consent'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import * as admin from '@aglyn/tenant-data-admin'
import { getApps, initializeApp } from 'firebase-admin/app'
import { type Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulated = EMULATED ? describe : describe.skip

const OWNER = 'e2e-cgc-owner'
const EMAIL = 'pat@example.com'

process.env.EMAIL_UNSUBSCRIBE_SECRET = 'consent-group-change-emulator-secret'
for (const key of ['STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'VERCEL_CONSOLE_PROJECT_ID', 'RESEND_API_KEY']) {
  delete process.env[key]
}

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/** No Storage emulator, and the default app holds no credential worth using. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined, delete: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

/** No Auth emulator here; an unstubbed lookup reaches real identity pools. */
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  findUserByUidAcrossPools: async () => null,
  findUserByEmailAcrossPools: async () => null,
  authForPool: () => ({ deleteUser: async () => undefined }),
}))

/** The delete route's sending-domain teardown reaches vendors; this suite has none. */
jest.mock('../utils/server/provision-sending-domain', () => ({
  teardownSendingDomain: async () => undefined,
}))

/** The credential is the only thing faked: the route verifies OWNER's token. */
jest.mock('@aglyn/tenant-data-admin', () => {
  const actual = jest.requireActual('@aglyn/tenant-data-admin')
  return {
    ...actual,
    firebaseAdmin: {
      ...actual.firebaseAdmin,
      app: (...args: unknown[]) => ({
        ...actual.firebaseAdmin.app(...args),
        auth: () => ({
          verifyIdToken: async () => ({ uid: OWNER, email: 'owner@example.com', email_verified: true }),
        }),
      }),
    },
  }
})

describeEmulated('a consent group change, against Firestore (AGL-3320)', () => {
  let db: Firestore
  const key = personKey(EMAIL) as string
  /*
   * The executor's clock, started at the wall clock: the participant pages
   * against the deadline the executor hands it on its own clock, so the two
   * must agree, and only the executor's is moved past the sweep delay.
   */
  let clock = Date.now()
  let logged: string[] = []
  const ctx = () => ({
    firestore: db,
    now: () => clock,
    log: async (_orgId: string, _actor: unknown, action: string) => {
      logged.push(action)
    },
  })
  const actor = { uid: OWNER, email: 'owner@example.com' }

  beforeAll(async () => {
    db = getFirestore()
    const { registerPluginServerDeclarations } = await import(
      '../constants/plugins.declarations.server.generated'
    )
    await registerPluginServerDeclarations()
  })

  beforeEach(() => {
    clock = Date.now()
    logged = []
  })

  /** An org with named sites, each indexed back to it. */
  async function seedOrg(orgId: string, sites: Record<string, string>, groups: Record<string, unknown>) {
    await db.doc(`orgs/${orgId}`).set({
      name: 'Acme',
      hosts: Object.fromEntries(Object.keys(sites).map((id) => [id, true])),
      ...(Object.keys(groups).length ? { consentGroups: groups } : {}),
    })
    await db.doc(`orgs/${orgId}/members/${OWNER}`).set({ role: 'owner', allHosts: true })
    for (const [id, name] of Object.entries(sites)) {
      await db.doc(`hosts/${id}`).set({ name, orgId, memberRoles: { [OWNER]: 'admin' } })
      await db.doc(`hostIndex/${id}`).set({ orgId })
    }
  }

  /** Starts a change and advances it, past the sweep delay, to the end. */
  async function runChange(orgId: string, expected: unknown, groups: unknown) {
    const started = await admin.startConsentGroupChange({ orgId, actor, expected, groups, ...ctx() })
    expect(started.ok).toBe(true)
    const { changeId } = started as { changeId: string }
    await admin.advanceConsentGroupChange({ orgId, changeId, deadlineMs: clock + 120_000, ...ctx() })
    clock += 6 * 60_000
    const done = await admin.advanceConsentGroupChange({
      orgId,
      changeId,
      deadlineMs: clock + 120_000,
      ...ctx(),
    })
    expect(done).toMatchObject({ ok: true, status: { phase: 'done', done: true } })
    return changeId
  }

  const contact = async (path: string) => (await db.doc(path).get()).data() as Record<string, any>

  it('I11: a site leaving its group keeps every refusal, both ways, and its copy of the record', async () => {
    const ORG = 'e2e-cgc-leave'
    const X = 'e2e-cgc-leave-shop'
    const R = 'e2e-cgc-leave-blog'
    const S = 'e2e-cgc-leave-bookings'
    const GROUP = { g1: { name: 'Northwind', hostIds: [R, S, X].sort() } }
    await seedOrg(ORG, { [X]: 'Shop', [R]: 'Blog', [S]: 'Bookings' }, GROUP)
    const at = Timestamp.fromMillis(clock - 86_400_000)
    await db.doc(`hosts/${X}/suppressions/${key}`).set({
      email: EMAIL,
      reason: 'unsubscribe',
      createdAt: at,
      suppressedAt: at,
    })
    await db.doc(`hosts/${R}/topicOptOuts/${key}`).set({
      email: EMAIL,
      topics: { newsletter: { optedOutAt: at, resubscribedAt: null } },
      updatedAt: at,
    })
    await db.doc(`hosts/${X}/emailFrequency/${key}`).set({
      email: EMAIL,
      cadence: 'monthly',
      cadenceSetAtMs: clock - 86_400_000,
      lastSentAtMs: clock - 3 * 86_400_000,
    })
    const PERSON = `orgs/${ORG}/contacts/c-pat`
    await db.doc(PERSON).set({
      email: EMAIL,
      capturedByHostIds: [X],
      hostId: X,
      visibleTo: [`host:${R}`, `host:${S}`, `host:${X}`],
      marketingConsentByHost: {
        [X]: { marketingConsent: false, marketingConsentAtMs: clock - 86_400_000 },
        [R]: {
          marketingConsent: true,
          marketingConsentAtMs: clock - 2 * 86_400_000,
          consentGroupId: 'g1',
          consentGroupName: 'Northwind',
        },
      },
      facets: {
        g1: {
          sources: { form: true },
          interactions: [
            { type: 'order', atMs: 3, hostId: X },
            { type: 'booking', atMs: 2, hostId: S },
            { type: 'note', atMs: 1 },
          ],
          notes: 'Prefers mornings',
          ownerUid: OWNER,
          ltvCents: 12_500,
          ordersCount: 2,
        },
      },
    })

    await runChange(ORG, GROUP, [{ id: 'g1', name: 'Northwind', hostIds: [R, S] }])

    const org = (await db.doc(`orgs/${ORG}`).get()).data() as Record<string, unknown>
    expect(org['consentGroups']).toEqual({ g1: { name: 'Northwind', hostIds: [R, S].sort() } })
    expect(org).not.toHaveProperty('consentGroupsChange')

    const blog = consentGroupForHost(org, R)
    const shop = consentGroupForHost(org, X)
    expect(shop.hostIds).toEqual([X])

    // From the Blog: the Shop's unsubscribe and the Shop's declined consent hold.
    expect(await admin.filterSendableForHost(R, [EMAIL], db, blog)).toEqual([])
    expect(
      await admin.marketingSendVerdict(
        { hostId: R, email: EMAIL, consentHostIds: blog.hostIds, siteBase: 'https://blog.example' } as never,
        { firestore: db, nowMs: clock },
      ),
    ).toMatchObject({ allowed: false, refusal: 'suppressed' })
    expect(readMarketingBasis(await contact(PERSON), blog).basis).toBe('declined')

    // From the Shop: the Blog's newsletter opt-out holds, and the Shop's own
    // pace went to the stayers.
    expect(await admin.filterTopicSendable(X, 'newsletter', [EMAIL], db, shop)).toEqual([])
    expect((await db.doc(`hosts/${R}/emailFrequency/${key}`).get()).data()).toMatchObject({
      cadence: 'monthly',
      cadenceCarriedFromHostId: X,
    })

    // The Shop keeps a copy of the record it earned — its own timeline and
    // the order total only it could have — and Northwind keeps its profile.
    const person = await contact(PERSON)
    expect(person['facets'][X]).toMatchObject({
      notes: 'Prefers mornings',
      ownerUid: OWNER,
      ltvCents: 12_500,
      ordersCount: 2,
      interactions: [
        { type: 'order', atMs: 3, hostId: X },
        { type: 'note', atMs: 1 },
      ],
    })
    expect(person['facets']['g1']).toMatchObject({ notes: 'Prefers mornings', ownerUid: OWNER })
    expect(person['facets']['g1']).not.toHaveProperty('ltvCents')
    // The Blog's grant gives way to the refusal it was already honoring, and
    // is kept whole beside it as the evidence of what P once agreed to.
    expect(person['marketingConsentByHost'][R]).toMatchObject({
      marketingConsent: false,
      carriedFromHostId: X,
      supersededEntry: { marketingConsent: true, consentGroupId: 'g1', consentGroupName: 'Northwind' },
    })

    expect(logged).toContain('Removed Shop from consent group "Northwind"')
    expect(logged[logged.length - 1]).toMatch(/^Finished a consent group change: \d+ opt-outs? copied to \d+ sites?; /)
  })

  it('creating a group from two sites combines their records and removes the solo keys, and the sweep folds a straggler', async () => {
    const ORG = 'e2e-cgc-create'
    const A = 'e2e-cgc-create-a'
    const B = 'e2e-cgc-create-b'
    await seedOrg(ORG, { [A]: 'Shop', [B]: 'Bookings' }, {})
    const PERSON = `orgs/${ORG}/contacts/c-pat`
    await db.doc(PERSON).set({
      email: EMAIL,
      capturedByHostIds: [B, A],
      facets: {
        [A]: { sources: {}, interactions: [], ownerUid: 'owner-a', ltvCents: 100, ordersCount: 1 },
        [B]: { sources: {}, interactions: [], ownerUid: 'owner-b', ltvCents: 50, ordersCount: 1 },
      },
    })
    const started = await admin.startConsentGroupChange({
      orgId: ORG,
      actor,
      expected: null,
      groups: [{ name: 'Northwind', hostIds: [A, B] }],
      ...ctx(),
    })
    const { changeId } = started as { changeId: string }
    await admin.advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 120_000, ...ctx() })
    const [groupId] = Object.keys(
      ((await db.doc(`orgs/${ORG}`).get()).data() as Record<string, any>)['consentGroups'],
    )
    let person = await contact(PERSON)
    expect(Object.keys(person['facets'])).toEqual([groupId])
    expect(person['facets'][groupId]).toMatchObject({ ownerUid: 'owner-b', ltvCents: 150, ordersCount: 2 })

    // An order webhook that resolved the solo group before the flip lands late.
    await db.doc(PERSON).update({ [`facets.${A}`]: { sources: {}, interactions: [], ltvCents: 40, ordersCount: 1 } })
    clock += 6 * 60_000
    await admin.advanceConsentGroupChange({ orgId: ORG, changeId, deadlineMs: clock + 120_000, ...ctx() })
    person = await contact(PERSON)
    expect(Object.keys(person['facets'])).toEqual([groupId])
    expect(person['facets'][groupId]).toMatchObject({ ltvCents: 190, ordersCount: 3 })
  })

  it('dissolving a group drops the order totals it cannot split, and counts them', async () => {
    const ORG = 'e2e-cgc-dissolve'
    const A = 'e2e-cgc-dissolve-a'
    const B = 'e2e-cgc-dissolve-b'
    const GROUP = { g1: { name: 'Northwind', hostIds: [A, B].sort() } }
    await seedOrg(ORG, { [A]: 'Shop', [B]: 'Bookings' }, GROUP)
    const PERSON = `orgs/${ORG}/contacts/c-pat`
    await db.doc(PERSON).set({
      email: EMAIL,
      capturedByHostIds: [A, B],
      facets: { g1: { sources: {}, interactions: [], notes: 'Both sites', ltvCents: 900, ordersCount: 3 } },
    })
    const changeId = await runChange(ORG, GROUP, [])
    const person = await contact(PERSON)
    expect(Object.keys(person['facets']).sort()).toEqual([A, B].sort())
    for (const site of [A, B]) {
      expect(person['facets'][site]).toMatchObject({ notes: 'Both sites' })
      expect(person['facets'][site]).not.toHaveProperty('ltvCents')
    }
    const job = (await db.doc(`orgs/${ORG}/consentGroupChanges/${changeId}`).get()).data() as Record<string, any>
    expect(job['plugins']['crm']).toMatchObject({ figuresDropped: 1, copied: 2 })
  })

  it('I7: of two starts from the same rendering, exactly one wins', async () => {
    const ORG = 'e2e-cgc-race'
    const A = 'e2e-cgc-race-a'
    const B = 'e2e-cgc-race-b'
    await seedOrg(ORG, { [A]: 'Shop', [B]: 'Bookings' }, {})
    const request = { orgId: ORG, actor, expected: null, groups: [{ name: 'Northwind', hostIds: [A, B] }] }
    const results = await Promise.all([
      admin.startConsentGroupChange({ ...request, ...ctx() }),
      admin.startConsentGroupChange({ ...request, ...ctx() }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({ status: 409 })
  })

  it('I9: a site in a declared group, or named by a change in flight, cannot be deleted', async () => {
    const ORG = 'e2e-cgc-delete'
    const A = 'e2e-cgc-delete-a'
    const B = 'e2e-cgc-delete-b'
    const C = 'e2e-cgc-delete-c'
    const D = 'e2e-cgc-delete-d'
    const GROUP = { g1: { name: 'Northwind', hostIds: [A, B].sort() } }
    await seedOrg(ORG, { [A]: 'Shop', [B]: 'Blog', [C]: 'Bookings', [D]: 'Journal' }, GROUP)
    // C and D are becoming one sender, and the change has not finished.
    const started = await admin.startConsentGroupChange({
      orgId: ORG,
      actor,
      expected: GROUP,
      groups: [
        { id: 'g1', name: 'Northwind', hostIds: [A, B] },
        { name: 'Southwind', hostIds: [C, D] },
      ],
      ...ctx(),
    })
    expect(started.ok).toBe(true)
    const { POST } = await import('../app/api/hosts/delete/route')
    const remove = (hostId: string) =>
      POST(
        new Request('https://app.example.com/api/hosts/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
          body: JSON.stringify({ hostId }),
        }),
      )
    expect((await remove(A)).status).toBe(409)
    expect((await remove(C)).status).toBe(409)
    expect((await db.doc(`hosts/${A}`).get()).exists).toBe(true)
    expect((await db.doc(`hosts/${C}`).get()).exists).toBe(true)
  })
})
