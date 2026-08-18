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
 * Support threads must not outlive the erasure (AGL-1971).
 *
 * `supportTickets/{id}` is top-level with `orgId` as a FIELD and a `messages`
 * subcollection carrying `authorId`, `authorEmail` and up to 5000 characters
 * of free text. `grep -c supportTickets erase.ts` returned **0**: neither
 * `eraseOrg` nor `eraseUser` touched it. It is the highest-PII-density
 * collection outside the org tree — a ticket is where somebody pastes the
 * invoice, the member list, or the very data they are asking us to delete —
 * and it was the one with no sweep. Privacy Policy §5 and live DPA §11 both
 * describe an erasure that reaches it.
 *
 * ## The two halves, and why they differ
 *
 * **`eraseOrg` destroys the thread**, subtree included. The assertion that
 * carries the weight is not that the ticket document is gone but that the
 * `messages` under it are: `deleteDocsByOrgId` — the mechanism this collection
 * otherwise fits exactly — deletes documents, not subtrees, so the tempting
 * one-line fix would have orphaned every message. The prose and the email
 * would have survived the delete meant to remove them, now unreachable by any
 * query starting from `orgId`. That is the specific red this spec exists to
 * hold down, so it reads the messages by path after the erasure rather than
 * inferring their death from the parent's.
 *
 * **`eraseUser` redacts and keeps.** A ticket belongs to the ORG, not to the
 * person who opened it, so erasing one member must not destroy a workspace's
 * support history — and cannot honestly: for that thread Aglyn is the
 * processor and the org is the controller. `authorId`/`authorEmail` go to
 * `null` with `authorErased: true`; the body stays, as the org's record. The
 * redaction runs as a **collection-group** query so it reaches messages in a
 * workspace the person has since LEFT, which a walk over current memberships
 * would silently miss — pinned below by a ticket in an org the subject is not
 * a member of.
 *
 * ## The negative controls
 *
 * A bystander org's ticket and messages survive `eraseOrg` untouched, and a
 * bystander author's message in the SAME thread keeps its email through
 * `eraseUser`. Without both, either sweep passes just as well by destroying or
 * blanking the whole collection — which holds every other customer's support
 * history.
 *
 * Integrations disarmed exactly as the sibling erasure specs do it: Stripe key
 * cleared and `fetch` hard-blocked toward Stripe with the attempt list
 * asserted empty, Vercel token cleared, Storage stubbed (no Storage emulator,
 * production credential on the admin app), `./auth-pools` stubbed (no Auth
 * emulator in this config).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-support-tickets.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const SLUG = 'e2e-erase-support'
const OWNER_UID = 'e2e-erase-support-uid'
const OTHER_SLUG = 'e2e-erase-support-bystander'
const OTHER_OWNER_UID = 'e2e-erase-support-bystander-uid'

/** The person erased. Writes in the erased org AND in a third workspace. */
const SUBJECT_UID = 'e2e-erase-support-person'
const SUBJECT_EMAIL = 'erase-me@example.invalid'
/** Another author in the same thread — must keep their email. */
const COAUTHOR_UID = 'e2e-erase-support-coauthor'
const COAUTHOR_EMAIL = 'keep-me@example.invalid'

const TICKET_ERASED_A = 'e2e-support-erased-a'
const TICKET_ERASED_B = 'e2e-support-erased-b'
/** Lives in the bystander org — the negative control for the org sweep. */
const TICKET_BYSTANDER = 'e2e-support-bystander'
/**
 * Lives in an org the subject is NOT a member of. The collection-group half:
 * a walk over current memberships never reaches this, and their email stays.
 */
const TICKET_FORMER_ORG = 'e2e-support-former-org'

const ALL_TICKETS = [
  TICKET_ERASED_A,
  TICKET_ERASED_B,
  TICKET_BYSTANDER,
  TICKET_FORMER_ORG,
]

/** The prose. Asserted absent by value, not merely by document count. */
const SUBJECT_BODY = 'Here is the invoice and the member list you asked for.'

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

describeEmulated('support threads do not outlive an erasure (AGL-1971)', () => {
  let db: Firestore
  let erase: typeof import('./erase')
  let organizations: typeof import('./organizations')

  let orgId: string
  let otherOrgId: string

  let orgResult: Awaited<ReturnType<typeof import('./erase').eraseOrg>>
  let userResult: Awaited<ReturnType<typeof import('./erase').eraseUser>>

  /** Paths of the erased org's messages, captured BEFORE the erasure. */
  let erasedMessagePaths: string[] = []

  const stripeCalls: string[] = []
  const realFetch = globalThis.fetch

  async function purge(): Promise<void> {
    for (const slug of [SLUG, OTHER_SLUG]) {
      const reservation = await db.collection('orgSlugs').doc(slug).get()
      const staleOrgId = reservation.get('orgId') as string | undefined
      if (staleOrgId) {
        await db.recursiveDelete(db.collection('orgs').doc(staleOrgId))
      }
      await db.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    }
    for (const ticket of ALL_TICKETS) {
      await db.recursiveDelete(db.collection('supportTickets').doc(ticket))
    }
    for (const uid of [OWNER_UID, OTHER_OWNER_UID, SUBJECT_UID, COAUTHOR_UID]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
      await db.recursiveDelete(db.collection('profiles').doc(uid))
    }
  }

  /** A ticket in the shape `/api/support/tickets` writes. */
  async function seedTicket(
    ticketId: string,
    ticketOrgId: string,
    authors: { uid: string; email: string; body: string }[],
  ): Promise<void> {
    const ref = db.collection('supportTickets').doc(ticketId)
    await ref.set({
      orgId: ticketOrgId,
      subject: 'Fixture ticket',
      status: 'open',
      plan: 'pro',
      supportTier: 'standard',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    for (const author of authors) {
      await ref.collection('messages').add({
        authorId: author.uid,
        authorEmail: author.email,
        staff: false,
        body: author.body,
        createdAt: Timestamp.now(),
      })
    }
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

    orgId = await organizations.createOrganization({
      name: 'Support Erasure Fixture',
      slug: SLUG,
      ownerUid: OWNER_UID,
    })
    otherOrgId = await organizations.createOrganization({
      name: 'Support Erasure Bystander',
      slug: OTHER_SLUG,
      ownerUid: OTHER_OWNER_UID,
    })

    // Two threads in the org that will be erased. The second is a two-author
    // thread, so the bystander author has somewhere to survive.
    await seedTicket(TICKET_ERASED_A, orgId, [
      { uid: SUBJECT_UID, email: SUBJECT_EMAIL, body: SUBJECT_BODY },
    ])
    await seedTicket(TICKET_ERASED_B, orgId, [
      { uid: SUBJECT_UID, email: SUBJECT_EMAIL, body: SUBJECT_BODY },
      { uid: COAUTHOR_UID, email: COAUTHOR_EMAIL, body: 'A colleague replying.' },
    ])
    // The bystander org's thread — never erased, never redacted.
    await seedTicket(TICKET_BYSTANDER, otherOrgId, [
      { uid: COAUTHOR_UID, email: COAUTHOR_EMAIL, body: 'Unrelated workspace.' },
    ])
    // A thread in a workspace the SUBJECT is not a member of. The org sweep
    // must not touch it; the user redaction must still reach it.
    await seedTicket(TICKET_FORMER_ORG, otherOrgId, [
      { uid: SUBJECT_UID, email: SUBJECT_EMAIL, body: 'Written before I left.' },
      { uid: COAUTHOR_UID, email: COAUTHOR_EMAIL, body: 'Still here.' },
    ])

    await db.collection('users').doc(SUBJECT_UID).set({ displayName: 'Subject' })

    // Message paths under the erased org, captured now. After the erasure the
    // parent is gone, so a query cannot find them — only a path read proves
    // they died rather than being orphaned.
    erasedMessagePaths = []
    for (const ticket of [TICKET_ERASED_A, TICKET_ERASED_B]) {
      const messages = await db
        .collection('supportTickets')
        .doc(ticket)
        .collection('messages')
        .get()
      erasedMessagePaths.push(...messages.docs.map((doc) => doc.ref.path))
    }
    expect(erasedMessagePaths).toHaveLength(3)

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

    orgResult = await erase.eraseOrg(orgId)
    userResult = await erase.eraseUser(SUBJECT_UID)
    expect(orgResult).toMatchObject({ ok: true })
    expect(userResult).toMatchObject({ ok: true })
  }, 300_000)

  afterAll(async () => {
    if (!EMULATED) return
    globalThis.fetch = realFetch
    await purge()
  }, 120_000)

  it('THE DEFECT: an erased org leaves no ticket and no message', async () => {
    const tickets = await db
      .collection('supportTickets')
      .where('orgId', '==', orgId)
      .get()
    expect(tickets.size).toBe(0)

    // The half a batch delete would have got wrong: every message read BY
    // PATH, so an orphan under a deleted parent cannot pass as gone.
    for (const path of erasedMessagePaths) {
      const message = await db.doc(path).get()
      expect(message.exists).toBe(false)
    }

    expect(orgResult).toMatchObject({ supportTickets: 2 })
  }, 60_000)

  it('an erased person is redacted from threads their org keeps', async () => {
    const messages = await db
      .collection('supportTickets')
      .doc(TICKET_FORMER_ORG)
      .collection('messages')
      .get()
    const subject = messages.docs.find(
      (doc) => doc.get('body') === 'Written before I left.',
    )
    expect(subject).toBeDefined()
    expect(subject?.get('authorEmail')).toBeNull()
    expect(subject?.get('authorId')).toBeNull()
    expect(subject?.get('authorErased')).toBe(true)
    // The thread and its body survive — they are the ORG's record, and the
    // org did not ask to be erased.
    const ticket = await db
      .collection('supportTickets')
      .doc(TICKET_FORMER_ORG)
      .get()
    expect(ticket.exists).toBe(true)
    expect(subject?.get('body')).toBe('Written before I left.')
  }, 60_000)

  it('the redaction reaches a workspace the person is NOT a member of', async () => {
    // `TICKET_FORMER_ORG` belongs to `otherOrgId`, and the subject has no
    // membership there — a walk over current memberships finds nothing, and
    // their email stays forever. This is why the query is a collection group.
    const membership = await db
      .collection('users')
      .doc(SUBJECT_UID)
      .collection('orgs')
      .get()
    expect(membership.empty).toBe(true)
    const orphaned = await db
      .collectionGroup('messages')
      .where('authorEmail', '==', SUBJECT_EMAIL)
      .get()
    expect(orphaned.size).toBe(0)
    expect(userResult.deleted).toMatchObject({ supportMessagesRedacted: 1 })
  }, 60_000)

  it('NEGATIVE CONTROL: the bystander org keeps its thread and its messages', async () => {
    // Without this, "the subject's tickets are gone" passes just as well if
    // the sweep emptied the collection — which holds every other customer's
    // support history.
    const ticket = await db
      .collection('supportTickets')
      .doc(TICKET_BYSTANDER)
      .get()
    expect(ticket.exists).toBe(true)
    expect(ticket.get('orgId')).toBe(otherOrgId)
    const messages = await db
      .collection('supportTickets')
      .doc(TICKET_BYSTANDER)
      .collection('messages')
      .get()
    expect(messages.size).toBe(1)
    expect(messages.docs[0].get('authorEmail')).toBe(COAUTHOR_EMAIL)
    expect(messages.docs[0].get('body')).toBe('Unrelated workspace.')
  }, 60_000)

  it('NEGATIVE CONTROL: a co-author in a redacted thread keeps their email', async () => {
    // The redaction is bounded by `authorId`, not by the thread. A blanket
    // update over the matched threads would blank this row too.
    const messages = await db
      .collection('supportTickets')
      .doc(TICKET_FORMER_ORG)
      .collection('messages')
      .get()
    const coauthor = messages.docs.find((doc) => doc.get('body') === 'Still here.')
    expect(coauthor?.get('authorEmail')).toBe(COAUTHOR_EMAIL)
    expect(coauthor?.get('authorId')).toBe(COAUTHOR_UID)
    expect(coauthor?.get('authorErased')).toBeUndefined()
  }, 60_000)

  it('CONTROL: the erasures genuinely ran', async () => {
    const org = await db.collection('orgs').doc(orgId).get()
    expect(org.exists).toBe(false)
    const user = await db.collection('users').doc(SUBJECT_UID).get()
    expect(user.exists).toBe(false)
    const other = await db.collection('orgs').doc(otherOrgId).get()
    expect(other.exists).toBe(true)
  }, 60_000)

  it('never called Stripe', () => {
    expect(stripeCalls).toEqual([])
  })
})
