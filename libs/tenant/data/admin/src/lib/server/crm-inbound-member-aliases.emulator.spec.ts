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
 * A BCC from a member's send-as alias is filed on the prospect (AGL-2975),
 * against the real Firestore emulator.
 *
 * The defect: a rep signs in as `rep@workspace.example` and sends outreach
 * from a Gmail send-as alias on another domain, copying the capture address
 * in BCC. The capture rule reads the first address that is not a member's as
 * the correspondent, and members were matched by sign-in address alone — so
 * the alias itself was the correspondent. Here the alias is ALSO a contact,
 * which an earlier capture of exactly this kind would have made it, so the
 * misreading is visible as a row on the wrong timeline rather than inferred.
 *
 * ## What runs for real
 *
 * The whole path the webhook takes after it has the message: the alias is
 * added through `addMemberEmailAlias`, its link minted and confirmed through
 * `confirmMemberEmailAlias` in the member's name, the roster read by
 * `loadCrmInboundRoster`, and the message filed by `fileCrmInboundEmail` —
 * every read and write against the emulator. Then the other half of the
 * feature's promise: the addresses leave with the membership, and with the
 * person when they are erased.
 *
 * ## The controls
 *
 * The SAME message from an alias whose owner never confirmed it must still
 * refuse to read the alias as the member: it lands on the alias's own
 * timeline, inbound, with no author. Without that twin a filer that treated
 * every added address as the member's would pass the first case too. A link
 * opened by a different member confirms nothing. A bystander member's
 * addresses survive the removal and the erasure.
 *
 * Integrations disarmed as the sibling erasure specs do it: Storage stubbed
 * (no Storage emulator, production credential on the admin app) and
 * `./auth-pools` stubbed (no Auth emulator in this config).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns crm-inbound-member-aliases.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { ReceivedEmail } from '@aglyn/shared-util-email'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-member-alias-org'
/** A second workspace the erased person also belongs to. */
const OTHER_ORG = 'e2e-member-alias-other-org'
const OWNER = 'e2e-member-alias-owner'
/** Confirms `REP_ALIAS` in `ORG`, then is erased. */
const REP = 'e2e-member-alias-rep'
/** Adds `TEAMMATE_ALIAS` and never confirms it; survives every sweep. */
const TEAMMATE = 'e2e-member-alias-teammate'

const REP_ALIAS = 'alias@otherdomain.example'
const TEAMMATE_ALIAS = 'teammate@otherdomain.example'
const PROSPECT = 'prospect@company.example'
const CAPTURE = `crm+${'a'.repeat(32)}@in.aglyn.com`
const DOMAIN = 'in.aglyn.com'
const HOST = 'e2e-member-alias-site'

delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID
process.env.TOKEN_SIGNING_SECRET = 'crm-inbound-member-aliases-emulator-secret'

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
  findUserByEmailAcrossPools: async () => null,
  authForPool: () => ({ deleteUser: async () => undefined }),
}))

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('a BCC from a member’s send-as alias (AGL-2975)', () => {
  let db: Firestore
  let aliases: typeof import('./member-email-aliases')
  let inbound: typeof import('./crm-inbound-email')

  const outreach = (from: string, id: string): ReceivedEmail => ({
    id,
    messageId: `<${id}@otherdomain.example>`,
    inReplyTo: '',
    from,
    to: [`Pat Prospect <${PROSPECT}>`],
    cc: [],
    bcc: [CAPTURE],
    receivedFor: [],
    subject: 'Worth a call?',
    text: 'Could we talk next week?',
    html: '',
    receivedAtMs: 1_757_300_000_000,
  })

  const file = async (message: ReceivedEmail) => {
    const org = (await db.collection('orgs').doc(ORG).get()).data() as Record<string, unknown>
    return inbound.fileCrmInboundEmail(db as unknown as FirebaseFirestore.Firestore, {
      orgId: ORG,
      org,
      message,
      domain: DOMAIN,
      members: await inbound.loadCrmInboundRoster(db as unknown as FirebaseFirestore.Firestore, ORG),
      hostIds: [HOST],
    })
  }

  /** Every row filed on a contact's timeline. */
  const timelineOf = async (contactId: string) =>
    (
      await db.collection('orgs').doc(ORG).collection('crmActivities').where('contactId', '==', contactId).get()
    ).docs.map((doc) => doc.data())

  const aliasDoc = (orgId: string, uid: string) =>
    db.collection('orgs').doc(orgId).collection('memberEmailAliases').doc(uid)

  async function purge(): Promise<void> {
    for (const orgId of [ORG, OTHER_ORG]) {
      await db.recursiveDelete(db.collection('orgs').doc(orgId))
    }
    for (const uid of [OWNER, REP, TEAMMATE]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
      await db.recursiveDelete(db.collection('profiles').doc(uid))
    }
    await db.collection('hosts').doc(HOST).delete()
    await db.collection('hostIndex').doc(HOST).delete()
  }

  async function seedMember(orgId: string, uid: string, email: string, name: string, role = 'editor') {
    await db.collection('orgs').doc(orgId).collection('members').doc(uid).set({
      role,
      allHosts: true,
      email,
      displayName: name,
    })
    await db.collection('users').doc(uid).collection('orgs').doc(orgId).set({ role, orgName: orgId })
  }

  beforeAll(async () => {
    db = getFirestore()
    aliases = await import('./member-email-aliases')
    inbound = await import('./crm-inbound-email')
    await purge()

    for (const orgId of [ORG, OTHER_ORG]) {
      await db.collection('orgs').doc(orgId).set({ name: orgId, ownerUid: OWNER, plan: 'agency' })
      await seedMember(orgId, OWNER, 'owner@workspace.example', 'Owner', 'owner')
    }
    await seedMember(ORG, REP, 'rep@workspace.example', 'Rep Person')
    await seedMember(ORG, TEAMMATE, 'teammate@workspace.example', 'Team Mate')
    await seedMember(OTHER_ORG, REP, 'rep@workspace.example', 'Rep Person')
    await db.collection('hosts').doc(HOST).set({ orgId: ORG, displayName: 'Fixture Site' })
    await db.collection('hostIndex').doc(HOST).set({ orgId: ORG })

    const contacts = db.collection('orgs').doc(ORG).collection('contacts')
    await contacts.doc('con-prospect').set({ email: PROSPECT, hostId: HOST, visibleTo: [`host:${HOST}`] })
    // The aliases as strangers, filed by an earlier capture of this shape.
    await contacts.doc('con-rep-alias').set({ email: REP_ALIAS, hostId: HOST, visibleTo: [`host:${HOST}`] })
    await contacts
      .doc('con-teammate-alias')
      .set({ email: TEAMMATE_ALIAS, hostId: HOST, visibleTo: [`host:${HOST}`] })
  }, 120_000)

  afterAll(async () => {
    if (!EMULATED) return
    await purge()
  }, 120_000)

  it('a link opened by another member confirms nothing', async () => {
    const added = await aliases.addMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      orgId: ORG,
      uid: REP,
      address: REP_ALIAS,
      signInEmail: 'rep@workspace.example',
      reservedDomains: [DOMAIN],
    })
    expect(added).toMatchObject({ ok: true, created: true })
    if (added.ok === false) return
    const token = aliases.mintMemberEmailAliasToken({
      orgId: ORG,
      uid: REP,
      address: added.alias.address,
      addedAtMs: added.alias.addedAtMs,
    })
    const refused = await aliases.confirmMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      token,
      callerUid: TEAMMATE,
    })
    expect(refused).toMatchObject({ ok: false, refusal: 'wrong-member' })
    expect((await aliasDoc(ORG, REP).get()).get('aliases')).toEqual([
      { address: REP_ALIAS, addedAtMs: added.alias.addedAtMs },
    ])
  }, 60_000)

  it('THE DEFECT: From a confirmed alias, To the prospect, BCC capture — filed on the prospect, as the member', async () => {
    const [entry] = await aliases.listMemberEmailAliases(db as unknown as FirebaseFirestore.Firestore, ORG, REP)
    const token = aliases.mintMemberEmailAliasToken({
      orgId: ORG,
      uid: REP,
      address: entry.address,
      addedAtMs: entry.addedAtMs,
    })
    const confirmed = await aliases.confirmMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      token,
      callerUid: REP,
    })
    expect(confirmed).toMatchObject({ ok: true, address: REP_ALIAS, alreadyConfirmed: false })

    const result = await file(outreach(`Rep Person <${REP_ALIAS}>`, 'outreach-confirmed'))
    expect(result).toMatchObject({
      outcome: 'filed',
      match: { email: PROSPECT, direction: 'outbound', link: { contactId: 'con-prospect' } },
    })
    expect(await timelineOf('con-prospect')).toEqual([
      expect.objectContaining({
        kind: 'email',
        direction: 'outbound',
        from: REP_ALIAS,
        to: PROSPECT,
        byUid: REP,
        byName: 'Rep Person',
        body: 'Could we talk next week?',
      }),
    ])
    expect(await timelineOf('con-rep-alias')).toEqual([])
  }, 60_000)

  it('CONTROL: the same message from an alias never confirmed does not read the alias as the member', async () => {
    const added = await aliases.addMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      orgId: ORG,
      uid: TEAMMATE,
      address: TEAMMATE_ALIAS,
      signInEmail: 'teammate@workspace.example',
      reservedDomains: [DOMAIN],
    })
    expect(added).toMatchObject({ ok: true, created: true })

    const roster = await inbound.loadCrmInboundRoster(db as unknown as FirebaseFirestore.Firestore, ORG)
    expect(roster.find((member) => member.uid === TEAMMATE)).toEqual({
      uid: TEAMMATE,
      email: 'teammate@workspace.example',
      name: 'Team Mate',
    })

    const result = await file(outreach(`Team Mate <${TEAMMATE_ALIAS}>`, 'outreach-unconfirmed'))
    expect(result).toMatchObject({
      outcome: 'filed',
      match: { email: TEAMMATE_ALIAS, direction: 'inbound', link: { contactId: 'con-teammate-alias' } },
    })
    expect(await timelineOf('con-teammate-alias')).toEqual([
      expect.objectContaining({ direction: 'inbound', from: TEAMMATE_ALIAS, byUid: '' }),
    ])
    // Nothing more landed on the prospect than the confirmed send above.
    expect(await timelineOf('con-prospect')).toHaveLength(1)
  }, 60_000)

  it('a removed member’s addresses go with the roster row; a bystander’s stay', async () => {
    await aliases.addMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      orgId: OTHER_ORG,
      uid: REP,
      address: REP_ALIAS,
      signInEmail: 'rep@workspace.example',
    })
    expect((await aliasDoc(OTHER_ORG, REP).get()).exists).toBe(true)
    const organizations = await import('./organizations')
    await organizations.removeOrgMember(OTHER_ORG, REP)
    expect((await aliasDoc(OTHER_ORG, REP).get()).exists).toBe(false)
    expect((await aliasDoc(ORG, TEAMMATE).get()).exists).toBe(true)
  }, 60_000)

  it('erasing the person removes their addresses in every workspace; a bystander’s stay', async () => {
    // Back in the second workspace, so the erasure has two memberships to walk.
    await seedMember(OTHER_ORG, REP, 'rep@workspace.example', 'Rep Person')
    await aliases.addMemberEmailAlias(db as unknown as FirebaseFirestore.Firestore, {
      orgId: OTHER_ORG,
      uid: REP,
      address: 'rep-second@otherdomain.example',
      signInEmail: 'rep@workspace.example',
    })
    expect((await aliasDoc(ORG, REP).get()).exists).toBe(true)
    expect((await aliasDoc(OTHER_ORG, REP).get()).exists).toBe(true)

    const erase = await import('./erase')
    expect(await erase.eraseUser(REP)).toMatchObject({ ok: true })
    expect((await aliasDoc(ORG, REP).get()).exists).toBe(false)
    expect((await aliasDoc(OTHER_ORG, REP).get()).exists).toBe(false)
    expect((await aliasDoc(ORG, TEAMMATE).get()).get('aliases')).toEqual([
      expect.objectContaining({ address: TEAMMATE_ALIAS }),
    ])
  }, 120_000)
})
