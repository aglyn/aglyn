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
 * ONE PERSON, ONE LIST MEMBERSHIP (`docs/specs/email-overhaul.md` D4).
 *
 * Two routes enroll into `orgs/{orgId}/lists/{listId}/members`, and they used
 * to derive the document id two incompatible ways — a full `sha256(email)` in
 * the commerce newsletter handler, an `hmac('aglyn-list-member', email)`
 * truncated to 20 hex in the workflow `enrollList` step. The same person
 * subscribing by both became two members of one list.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - BOTH REAL ROUTES, ONE STORE. The assertions drive `newsletterHandler` and
 *    `runSingleAction` themselves, not `enrollListMember` twice. The defect
 *    was never in a shared helper — there wasn't one — it was that two call
 *    sites each answered the question locally, so a test that calls the helper
 *    twice proves the helper is deterministic and nothing about whether either
 *    route uses it.
 *  - CASING CANNOT FORK IT EITHER. Neither original derivation normalized;
 *    they agreed on lowercase only because both callers happened to lowercase
 *    upstream, which is a property of the callers and not of the id.
 *  - A ROW ALREADY UNDER A LEGACY ID IS ADOPTED, NOT DUPLICATED. This is the
 *    migration: changing the derivation without this turns a defect that
 *    needed two routes into one that needs only a second visit.
 *  - THE ENROLLMENT DATE SURVIVES a re-subscribe.
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
  __esModule: true,
  // The REAL enrollment helper, reached by its deep path so the barrel — and
  // the Admin SDK initialization behind it — is not pulled into the suite.
  // Stubbing it here would make both assertions below vacuous: the claim is
  // that each ROUTE uses it, so it is the one thing that must not be a double.
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
  upsertHostContact: async () => undefined,
  /*
   * The newsletter route asks which campaign sent this visitor before it
   * enrolls them. These requests carry no touch, so the honest answer is
   * none — and it has to be ANSWERED rather than omitted: the handler runs
   * inside a try/catch, so a missing export would surface here as an
   * enrollment that silently never happened.
   */
  resolveCampaignTouch: async () => null,
  /*
   * The double opt-in seam, answering OFF.
   *
   * This file is about one thing — that both enrollment routes write one
   * document per person — and a site that confirms subscriptions would put
   * the newsletter route on a different branch of its own. Whether that
   * branch is right belongs to `newsletter-double-opt-in.spec.ts`; what
   * matters here is that the setting is off, so the route enrolls.
   */
  siteRequiresDoubleOptIn: async () => false,
  recordPendingTopicConfirmation: async () => ({
    result: 'pending',
    pendingAtMs: 1,
  }),
}))

import { newsletterHandler } from '@aglyn/plugins-commerce/server/newsletter'
import { runSingleAction } from '@aglyn/tenant-runtime/run-event-actions'

/** Drives the commerce newsletter route the footer form posts to. */
const subscribeByNewsletterForm = async (email: string) => {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  await newsletterHandler(
    {
      method: 'POST',
      body: { hostId: HOST_ID, email, listId: LIST_ID },
      headers: {},
      socket: { remoteAddress: '203.0.113.7' },
    } as any,
    res,
  )
  return res
}

/** Drives the workflow `enrollList` step the automation builder writes. */
const subscribeByAutomation = (email: string) =>
  runSingleAction(HOST_ID, 'action-1', 'formSubmit', { email })

beforeEach(() => {
  store = {}
  seed(LIST_PATH, { name: 'Newsletter' })
  seed(`hosts/${HOST_ID}/actions/action-1`, {
    enabled: true,
    trigger: { event: 'formSubmit' },
    steps: [{ type: 'enrollList', listId: LIST_ID }],
  })
})

describe('the two enrollment routes', () => {
  it('write ONE member document for one address', async () => {
    await subscribeByNewsletterForm('bob@example.com')
    await subscribeByAutomation('bob@example.com')

    expect(memberIds()).toHaveLength(1)
    expect(store[`${MEMBERS_PATH}/${memberIds()[0]}`]).toMatchObject({
      email: 'bob@example.com',
    })
  })

  it('write ONE member document when the address is cased differently', async () => {
    // The premise: casing is what forks a derivation that hashes before it
    // normalizes, and each original call site normalized on its own.
    await subscribeByNewsletterForm('Bob@Example.COM')
    await subscribeByAutomation('  bob@example.com  ')

    expect(memberIds()).toHaveLength(1)
  })

  it('keep the enrollment date of the first subscribe', async () => {
    await subscribeByNewsletterForm('bob@example.com')
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

  it('are adopted by the automation route, not duplicated', async () => {
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

  it('are adopted by the newsletter route, not duplicated', async () => {
    seed(`${MEMBERS_PATH}/${legacyHmac20}`, {
      email: 'bob@example.com',
      addedAt: 'enrolled-last-year',
    })

    await subscribeByNewsletterForm('bob@example.com')

    expect(memberIds()).toEqual([legacyHmac20])
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
 * The consent field a list membership never had.
 *
 * `orgs/{orgId}/lists/{id}/members` carried `email`, `name`, `source` and
 * `addedAt` and nothing else, so `audience: 'list'` gave the send-time
 * consent join nothing to read — even for the one audience whose members
 * literally asked for a newsletter
 * (`docs/specs/email-overhaul.md` §1d/§3f).
 *
 * The two routes into this collection are not the same event, and that is the
 * whole distinction being asserted. Somebody posting the newsletter form is
 * saying "subscribe me": the request IS the checkbox. An automation enrolling
 * somebody because a workflow fired is a decision the SITE made about a person
 * who was doing something else, and a basis stamped from it would be
 * manufactured.
 */
describe('the consent a list membership records', () => {
  const memberDoc = () => store[`${MEMBERS_PATH}/${Object.keys(store)
    .filter((key) => key.startsWith(`${MEMBERS_PATH}/`))
    .map((key) => key.slice(MEMBERS_PATH.length + 1))[0]}`]

  it('records a basis for a newsletter subscribe', async () => {
    await subscribeByNewsletterForm('bob@example.com')
    expect(memberDoc()).toMatchObject({ marketingConsent: true })
    expect(typeof memberDoc()?.['marketingConsentAtMs']).toBe('number')
  })

  it('⛔ records NO basis for an automation enrollment', async () => {
    await subscribeByAutomation('bob@example.com')
    expect(memberDoc()).toBeDefined()
    expect('marketingConsent' in (memberDoc() ?? {})).toBe(false)
  })

  /**
   * And an enrollment that carries no checkbox never ERASES one. A merge that
   * stamped `false` on the omitted case would revoke a basis the person gave
   * earlier, and a withdrawal is a different event from a re-enrollment that
   * happened not to carry a box. Withdrawal has its own path — the
   * unsubscribe link and the suppression list.
   */
  it('does not erase an existing basis when a later route carries none', async () => {
    await subscribeByNewsletterForm('bob@example.com')
    await subscribeByAutomation('bob@example.com')
    expect(memberDoc()).toMatchObject({ marketingConsent: true })
  })
})
