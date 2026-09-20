/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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
 * ONE PERSON, ONE LIST MEMBERSHIP — the automation's half
 * (`docs/specs/email-overhaul.md` D4).
 *
 * Two routes enroll into a list's members: the commerce newsletter handler
 * and the automation `enrollList` step. They used to derive the member
 * document id two incompatible ways — a full `sha256(email)` in one, an
 * `hmac('aglyn-list-member', email)` truncated to 20 hex in the other — so the
 * same person subscribing by both became two members of one list.
 *
 * The two routes live in two plugins, and no project may import both, so
 * each route's spec drives its OWN route for real and asserts the id against
 * `listMemberDocIds` — the one derivation, owned by the data layer. Two
 * routes that each write `listMemberDocIds(email)[0]` write the same
 * document. The newsletter's half is
 * `libs/plugins/commerce/src/lib/server/list-enrollment-is-one-document-per-person.spec.ts`.
 *
 * WHAT THIS FILE HAS TO CATCH, for the step:
 *
 *  - THE SHARED ID, NOT A LOCAL ONE. The step's document is the one the
 *    shared derivation names, whatever the casing or padding of the address.
 *  - A ROW ALREADY UNDER A LEGACY ID IS ADOPTED, NOT DUPLICATED.
 *  - THE ENROLLMENT DATE SURVIVES a re-enrollment.
 *  - NO CONSENT IS MANUFACTURED, and none a newsletter subscribe recorded is
 *    erased.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`

/** Every document written, keyed by `<collection path>/<id>`. */
let store: Record<string, Record<string, any>> = {}

const seed = (path: string, data: Record<string, any>) => {
  store[path] = data
}

/** Ids present under the list's members collection. */
const memberIds = () =>
  Object.keys(store)
    .filter((path) => path.startsWith(`${MEMBERS_PATH}/`))
    .map((path) => path.slice(`${MEMBERS_PATH}/`.length))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    delete: () => ({ __delete: true }),
  },
}))

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
  get ref() {
    return docHandle(path)
  },
})

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  firestore: firestoreHandle,
  get: async () => snapshotFor(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = { ...(options?.merge ? (store[path] ?? {}) : {}), ...data }
  },
  update: async (data: Record<string, any>) => {
    store[path] = { ...(store[path] ?? {}), ...data }
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const collectionHandle = (path: string): any => {
  const api: any = {
    doc: (id: string) => docHandle(`${path}/${id}`),
    where: () => api,
    orderBy: () => api,
    limit: () => api,
    get: async () => ({
      docs: Object.keys(store)
        .filter(
          (key) =>
            key.startsWith(`${path}/`) &&
            !key.slice(`${path}/`.length).includes('/'),
        )
        .map(snapshotFor),
      empty: false,
    }),
    add: async (data: Record<string, any>) => {
      const id = `auto-${Object.keys(store).length + 1}`
      store[`${path}/${id}`] = data
      return { id }
    },
    // The list document's parent, which `campaign-send` and the newsletter
    // handler both reach through to find sibling collections.
    parent: docHandle(path.slice(0, path.lastIndexOf('/'))),
  }
  return api
}

const firestoreHandle: any = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The real resolution's shape: an org that declared no pooling resolves
  // every site to a group of ONE — the narrow answer, which is the direction
  // a wrong group may fail in.
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  __esModule: true,
  // The REAL enrollment helper, reached by its deep path so the barrel — and
  // the Admin SDK initialization behind it — is not pulled into the suite.
  // Stubbing it would make every assertion below vacuous: the claim is that
  // the ROUTE uses it, so it is the one thing that must not be a double.
  enrollListMember: jest.requireActual(
    '@aglyn/tenant-data-admin/server/list-members',
  ).enrollListMember,
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
  getOrgForHost: async () => ({ org: { plan: 'business' }, orgId: ORG_ID }),
  resolveOrgIdForHost: async () => ORG_ID,
  orgDataCollectionForHost: async () =>
    collectionHandle(`orgs/${ORG_ID}/contacts`),
  orgDataQueryForHost: async () => ({
    query: collectionHandle(`orgs/${ORG_ID}/contacts`),
  }),
  meterHostEmail: async () => ({ allowed: true }),
  notifyHostManagers: async () => undefined,
  dataStorageRefusal: async () => null,
}))

import { listMemberDocIds } from '@aglyn/tenant-data-admin/server/list-members'
import { runSingleAction } from './run-event-actions'

/** Drives the automation `enrollList` step the builder writes. */
const subscribeByAutomation = (email: string) =>
  runSingleAction(HOST_ID, 'action-1', 'formSubmit', { email })

/** The document the shared derivation names for this address. */
const sharedId = (email: string) => listMemberDocIds(email)[0]

beforeEach(() => {
  store = {}
  seed(LIST_PATH, { name: 'Newsletter' })
  seed(`hosts/${HOST_ID}/actions/action-1`, {
    enabled: true,
    trigger: { event: 'formSubmit' },
    steps: [{ type: 'enrollList', listId: LIST_ID }],
  })
})

describe('the automation enrollment route', () => {
  it('writes ONE member document, under the shared id', async () => {
    await subscribeByAutomation('bob@example.com')
    await subscribeByAutomation('bob@example.com')

    expect(memberIds()).toEqual([sharedId('bob@example.com')])
    expect(store[`${MEMBERS_PATH}/${memberIds()[0]}`]).toMatchObject({
      email: 'bob@example.com',
    })
  })

  it('writes the same document whatever the casing or padding', async () => {
    // The premise: casing is what forks a derivation that hashes before it
    // normalizes, and each original call site normalized on its own.
    await subscribeByAutomation('Bob@Example.COM')
    await subscribeByAutomation('  bob@example.com  ')

    expect(memberIds()).toEqual([sharedId('bob@example.com')])
  })

  it('keeps the enrollment date of the first enrollment', async () => {
    await subscribeByAutomation('bob@example.com')
    const id = memberIds()[0]
    store[`${MEMBERS_PATH}/${id}`].addedAt = 'first-subscribe'

    await subscribeByAutomation('bob@example.com')

    expect(store[`${MEMBERS_PATH}/${id}`].addedAt).toBe('first-subscribe')
  })
})

describe('rows written under a legacy derivation', () => {
  // The two ids this collection was keyed by before `personKey`. Restated
  // rather than imported: they are deliberately not exported, and a spec that
  // asked the code under test for the shape it is being checked against would
  // pass whatever that code did.
  const legacySha256 =
    require('node:crypto')
      .createHash('sha256')
      .update('bob@example.com')
      .digest('hex')
  const legacyHmac20 = require('node:crypto')
    .createHmac('sha256', 'aglyn-list-member')
    .update('bob@example.com')
    .digest('hex')
    .slice(0, 20)

  it('are adopted, not duplicated', async () => {
    seed(`${MEMBERS_PATH}/${legacyHmac20}`, {
      email: 'bob@example.com',
      addedAt: 'enrolled-last-year',
      source: 'action:old',
    })

    await subscribeByAutomation('bob@example.com')

    expect(memberIds()).toEqual([legacyHmac20])
    expect(store[`${MEMBERS_PATH}/${legacyHmac20}`].addedAt).toBe(
      'enrolled-last-year',
    )
  })

  it('stay reachable when BOTH legacy ids already exist', async () => {
    // The state the defect actually produced. Nothing here collapses them —
    // that needs a decision about which row is authoritative, and an
    // enrollment is the wrong moment to make it — but a third row is not
    // added, and both rows keep their consent-bearing fields.
    seed(`${MEMBERS_PATH}/${legacySha256}`, { email: 'bob@example.com' })
    seed(`${MEMBERS_PATH}/${legacyHmac20}`, { email: 'bob@example.com' })

    await subscribeByAutomation('bob@example.com')

    expect(memberIds().sort()).toEqual([legacySha256, legacyHmac20].sort())
  })
})

describe('an unusable address', () => {
  it('enrolls nobody rather than keying a document for it', async () => {
    await subscribeByAutomation('not-an-email')
    expect(memberIds()).toHaveLength(0)
  })
})

/**
 * The consent field a list membership records.
 *
 * Somebody posting the newsletter form is saying "subscribe me": the request
 * IS the checkbox. An automation enrolling somebody because a workflow fired
 * is a decision the SITE made about a person who was doing something else,
 * and a basis stamped from it would be manufactured.
 */
describe('the consent an automation enrollment records', () => {
  const memberDoc = () => store[`${MEMBERS_PATH}/${sharedId('bob@example.com')}`]

  it('⛔ records NO basis', async () => {
    await subscribeByAutomation('bob@example.com')
    expect(memberDoc()).toBeDefined()
    expect(memberDoc()?.['marketingConsentByHost']).toBeUndefined()
  })

  /**
   * And an enrollment that carries no checkbox never ERASES one. A merge that
   * stamped `false` on the omitted case would revoke a basis the person gave
   * earlier, and a withdrawal is a different event from a re-enrollment that
   * happened not to carry a box. Withdrawal has its own path — the
   * unsubscribe link and the suppression list.
   */
  it('does not erase the basis an earlier newsletter subscribe recorded', async () => {
    seed(`${MEMBERS_PATH}/${sharedId('bob@example.com')}`, {
      email: 'bob@example.com',
      addedAt: 'subscribed',
      marketingConsentByHost: {
        [HOST_ID]: { marketingConsent: true, marketingConsentAtMs: 1 },
      },
    })

    await subscribeByAutomation('bob@example.com')

    expect(memberDoc()?.['marketingConsentByHost']?.[HOST_ID]).toMatchObject({
      marketingConsent: true,
    })
  })
})
