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
 * `inbox/assign-list` — who ends up on a marketing list, and on what basis.
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `enrollListMember` is the REAL helper, reached by its deep path. It is
 *     the only writer of the member collection and it owns both the document
 *     id and the refusal backstop, so doubling it would make every assertion
 *     about what was written a test of the double. The Firestore store below
 *     is therefore a real enough one: keyed `getAll`, `set({merge:true})`, and
 *     a `where(field,'==',value)` good for the single equality the contact
 *     lookup performs.
 *  2. `readMarketingBasis`, `isOrgWideMember`, `personKey` and
 *     `normalizeContactEmail` are the real pure functions. The consent split
 *     and the org-reach predicate are exactly the rules under test.
 *  3. `isEmailSuppressed` is a spy over the platform list; the per-site list
 *     is a document in the store. The real helper fails CLOSED on a throwing
 *     read and that belongs to `email-suppression.spec.ts`.
 *  4. `sendEmail` is a spy, present only so the reply handler can be driven
 *     to prove it enrolls nobody.
 */

const isEmailSuppressed = jest.fn()
const sendEmail = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  resolveBrandingProfile: () => ({ fromName: 'Aglyn' }),
  // The real pure modules the barrel would have supplied. Requiring them by
  // their own paths keeps the client-side barrel — and its React surface —
  // out of a suite that is testing a request handler.
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  // The enrollment rule itself, which moved to the framework when the Emails
  // console became its second caller. Real, because it IS what is under test.
  ...jest.requireActual('@aglyn/aglyn/app-utils/list-assignment-policy'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
}))

const HOST_ID = 'site-1'

/**
 * A contact whose basis is recorded against THIS site.
 *
 * The grant is per (person, controller) now, so a fixture writing it at the
 * top of the document would be asserting the pre-host model — and would pass
 * against a reader that had lost the host dimension entirely.
 */
const grantedHere = (atMs = Date.now()) => ({
  marketingConsentByHost: {
    [HOST_ID]: { marketingConsent: true, marketingConsentAtMs: atMs },
  },
})
const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`
const SUBMISSION_PATH = `hosts/${HOST_ID}/formSubmissions/sub-1`
const SENDER = 'priya@lumen.co'

let store: Record<string, Record<string, any>> = {}
let decodedToken: { uid: string; email?: string } = {
  uid: 'editor-uid',
  email: 'owner@lumen.co',
}
let membership: { orgId: string; member: Record<string, unknown> } | null = null
let autoId = 0

const memberRows = () =>
  Object.keys(store).filter((path) => path.startsWith(`${MEMBERS_PATH}/`))
const assignmentRows = () =>
  Object.keys(store).filter((path) =>
    path.startsWith(`${SUBMISSION_PATH}/listAssignments/`),
  )
const theMember = () => store[memberRows()[0]]
/**
 * The enrolling site's own consent entry on the membership row.
 *
 * A list is org-shared and every site in the org can mail it, so the basis a
 * membership carries lives under the controller it was given to rather than
 * at the top of the row.
 */
const memberEntry = (row: Record<string, any> = theMember()) =>
  row?.marketingConsentByHost?.[HOST_ID] ?? {}

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
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const childPaths = (path: string) =>
  Object.keys(store).filter(
    (key) =>
      key.startsWith(`${path}/`) && !key.slice(`${path}/`.length).includes('/'),
  )

const collectionHandle = (path: string): any => {
  const build = (filters: Array<[string, unknown]>, cap: number | null): any => ({
    doc: (id: string) => docHandle(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) =>
      build([...filters, [field, value]], cap),
    orderBy: () => build(filters, cap),
    limit: (value: number) => build(filters, value),
    get: async () => {
      const matched = childPaths(path)
        .filter((key) =>
          filters.every(([field, value]) => store[key]?.[field] === value),
        )
        .sort()
        .slice(0, cap ?? Infinity)
        .map(snapshotFor)
      return { docs: matched, empty: matched.length === 0 }
    },
    add: async (data: Record<string, any>) => {
      const id = `auto-${(autoId += 1)}`
      store[`${path}/${id}`] = data
      return { id }
    },
    parent: docHandle(path.slice(0, path.lastIndexOf('/'))),
  })
  return build([], null)
}

const firestoreHandle: any = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  __esModule: true,
  emailSuppressionKey: (email: string) =>
    email.includes('@') ? `key:${email.trim().toLowerCase()}` : null,
  isEmailSuppressed: (...args: unknown[]) => isEmailSuppressed(...args),
  meterHostEmail: jest.fn(),
  // The REAL writer. Doubling it would make "the declined person was not
  // enrolled" a claim about the double rather than about the collection.
  enrollListMember: jest.requireActual(
    '@aglyn/tenant-data-admin/server/list-members',
  ).enrollListMember,
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  orgDataCollectionForHost: async () =>
    collectionHandle(`orgs/${ORG_ID}/contacts`),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => firestoreHandle,
    }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
}))

import {
  inboxAssignListHandler,
  inboxListOptionsHandler,
  inboxReplyHandler,
} from './server'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'

async function drive(
  handler: typeof inboxAssignListHandler,
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer token' },
) {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
  }
  /*
   * Awaited rather than `.then`-ed: `PluginApiHandler` is declared
   * `void | Promise<void>`, so a chained `then` is a type error on the `void`
   * arm even though every handler here is async.
   */
  await handler({ method: 'POST', body, headers } as any, res)
  return out
}

const assign = (body: Record<string, unknown> = {}) =>
  drive(inboxAssignListHandler, {
    hostId: HOST_ID,
    submissionId: 'sub-1',
    listId: LIST_ID,
    ...body,
  })

/** Puts a contact for the sender on the org, carrying whatever consent. */
const seedContact = (consent: Record<string, unknown>) => {
  store[`orgs/${ORG_ID}/contacts/c1`] = { email: SENDER, ...consent }
}

beforeEach(() => {
  store = {}
  autoId = 0
  decodedToken = { uid: 'editor-uid', email: 'owner@lumen.co' }
  membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: true } }
  isEmailSuppressed.mockReset().mockResolvedValue(false)
  sendEmail.mockReset().mockResolvedValue({ sent: true, id: 'msg-1' })
  store[`hosts/${HOST_ID}`] = {
    displayName: 'Lumen',
    memberRoles: { 'editor-uid': 'editor' },
  }
  store[SUBMISSION_PATH] = { fields: { Email: SENDER, Message: 'hello' } }
  store[LIST_PATH] = { name: 'Newsletter' }
})

describe('a stored refusal', () => {
  /*
   * THE ASSERTION THIS FEATURE WAS HELD BACK FOR. `marketingConsent: false` is
   * written by one path in the product and it writes a contact, so the CRM
   * record is where a refusal lives and this route is the one that has to
   * read it.
   */
  it('is refused, and nothing is written', async () => {
    seedContact({ marketingConsent: false })
    const out = await assign()
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('declined')
    expect(memberRows()).toHaveLength(0)
    expect(assignmentRows()).toHaveLength(0)
  })

  it('is refused when the merchant asserts permission anyway', async () => {
    seedContact({ marketingConsent: false })
    const out = await assign({ attestConsent: true })
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('declined')
    expect(memberRows()).toHaveLength(0)
  })

  /*
   * The backstop, exercised through the REAL `enrollListMember`: a refusal
   * recorded on the LIST ROW stops the write even when the CRM says nothing.
   * That is what makes "no path enrolls a declined person" true of the
   * collection rather than only of this handler.
   */
  it('on the membership itself refuses even when the CRM is silent', async () => {
    store[`${MEMBERS_PATH}/${personKey(SENDER)}`] = {
      email: SENDER,
      marketingConsent: false,
    }
    const out = await assign({ attestConsent: true })
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('declined')
    // The row is left exactly as it was found — an unscoped refusal, which
    // `readMarketingBasis` honors against every site.
    expect(theMember().marketingConsent).toBe(false)
    expect(memberEntry().marketingConsentBasis).toBeUndefined()
  })

  it('is reported to the merchant before they choose a list', async () => {
    seedContact({ marketingConsent: false })
    const out = await drive(inboxListOptionsHandler, {
      hostId: HOST_ID,
      submissionId: 'sub-1',
    })
    expect(out.code).toBe(200)
    expect(out.body.enrollable).toBe(false)
    expect(out.body.requiresAttestation).toBe(false)
  })
})

describe('no consent record', () => {
  it('refuses without an assertion, and writes nothing', async () => {
    const out = await assign()
    expect(out.code).toBe(422)
    expect(out.body.reason).toBe('no-basis')
    expect(memberRows()).toHaveLength(0)
  })

  /*
   * Submitting the form is NOT the basis. The submission is what put this
   * person in the Inbox in the first place, so if it counted, every sender
   * would be enrollable with no assertion and the control above would never
   * appear.
   */
  it('is not created by the submission that opened this screen', async () => {
    expect(store[SUBMISSION_PATH].fields.Email).toBe(SENDER)
    expect((await assign()).code).toBe(422)
  })

  it('enrolls on an assertion, recording who made it and when', async () => {
    const before = Date.now()
    const out = await assign({ attestConsent: true })
    expect(out.code).toBe(200)
    expect(out.body.basis).toBe('operator-attested')
    const member = theMember()
    expect(memberEntry(member).marketingConsent).toBe(true)
    expect(memberEntry(member).marketingConsentBasis).toBe('operator-attested')
    expect(memberEntry(member).marketingConsentByUid).toBe('editor-uid')
    expect(memberEntry(member).marketingConsentAtMs).toBeGreaterThanOrEqual(before)
  })

  /*
   * `via: 'manual'` and never `'rule'`. The dynamic-list materializer
   * reconciles its OWN rows away when a person stops matching the rule, and a
   * row stamped `'rule'` by this route would be deleted by the next sweep of
   * any dynamic list — silently removing somebody a merchant decided to add,
   * along with the consent record that says why they are there.
   */
  it('marks the row as added by hand, so no rule sweep removes it', async () => {
    await assign({ attestConsent: true })
    expect(theMember().via).toBe('manual')
  })

  it('records the assertion under the submission it was made from', async () => {
    await assign({ attestConsent: true })
    const trail = store[assignmentRows()[0]]
    expect(trail.basis).toBe('operator-attested')
    expect(trail.assertedByUid).toBe('editor-uid')
    expect(trail.listId).toBe(LIST_ID)
    expect(trail.to).toBe(SENDER)
  })
})

describe('a stored opt-in', () => {
  const OPTED_IN_AT = Date.UTC(2025, 2, 14)

  it('enrolls with no assertion, as a pass-through', async () => {
    seedContact(grantedHere(OPTED_IN_AT))
    const out = await assign()
    expect(out.code).toBe(200)
    expect(out.body.basis).toBe('contact-opt-in')
  })

  /*
   * The person's own date survives the copy, and nobody is named as having
   * vouched for them. A row that said an account attested for somebody who
   * ticked a box themselves is a false attribution in the one direction a
   * compliance answer cannot afford.
   */
  it('keeps their date and attributes the basis to nobody', async () => {
    seedContact(grantedHere(OPTED_IN_AT))
    await assign()
    expect(memberEntry().marketingConsentAtMs).toBe(OPTED_IN_AT)
    expect(memberEntry().marketingConsentByUid).toBeNull()
  })

  it('supersedes an earlier attestation without inheriting its account', async () => {
    await assign({ attestConsent: true })
    expect(memberEntry().marketingConsentByUid).toBe('editor-uid')
    seedContact(grantedHere(OPTED_IN_AT))
    await assign()
    expect(memberEntry().marketingConsentBasis).toBe('contact-opt-in')
    expect(memberEntry().marketingConsentByUid).toBeNull()
  })
})

describe('a suppressed address', () => {
  it('is refused on the platform list, however good its consent', async () => {
    seedContact(grantedHere())
    isEmailSuppressed.mockResolvedValue(true)
    const out = await assign()
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('suppressed-platform')
    expect(memberRows()).toHaveLength(0)
  })

  it('is refused on this site’s own list', async () => {
    seedContact(grantedHere())
    store[`hosts/${HOST_ID}/suppressions/key:${SENDER}`] = { email: SENDER }
    const out = await assign()
    expect(out.code).toBe(409)
    expect(out.body.reason).toBe('suppressed-host')
    expect(memberRows()).toHaveLength(0)
  })
})

describe('who may do it', () => {
  /*
   * A list is ORG-WIDE data. An editor invited to one site is an org member
   * with `allHosts: false`, and the security rules put lists behind
   * `isOrgWideMember()` — but the Admin SDK evaluates no rules, so a route
   * gated on the host role alone would let a single-site collaborator enroll
   * people into an audience every other site in the org can mail.
   */
  it('refuses a site collaborator who is not an org-wide member', async () => {
    seedContact(grantedHere())
    membership = {
      orgId: ORG_ID,
      member: { role: 'editor', allHosts: false, hostAccess: { [HOST_ID]: 'editor' } },
    }
    const out = await assign()
    expect(out.code).toBe(403)
    expect(memberRows()).toHaveLength(0)
  })

  it('refuses an org viewer even with an editor role on the site', async () => {
    seedContact(grantedHere())
    membership = { orgId: ORG_ID, member: { role: 'viewer', allHosts: true } }
    expect((await assign()).code).toBe(403)
  })

  it('refuses someone with no role on the site at all', async () => {
    store[`hosts/${HOST_ID}`] = { memberRoles: {} }
    expect((await assign()).code).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const out = await drive(
      inboxAssignListHandler,
      { hostId: HOST_ID, submissionId: 'sub-1', listId: LIST_ID },
      {},
    )
    expect(out.code).toBe(401)
    expect(memberRows()).toHaveLength(0)
  })
})

describe('the address is the submission’s', () => {
  /*
   * A `to` a caller could name would be a marketing-audience write pointed at
   * any address — the same defect the reply handler refuses, for the same
   * reason, and worth asserting separately because the two routes resolve it
   * through one function that either of them could stop using.
   */
  it('ignores an address in the request body', async () => {
    seedContact(grantedHere())
    const out = await assign({ to: 'someone-else@example.com' })
    expect(out.code).toBe(200)
    expect(out.body.to).toBe(SENDER)
    expect(theMember().email).toBe(SENDER)
  })

  it('refuses a submission with no email field', async () => {
    store[SUBMISSION_PATH] = { fields: { Message: 'hello' } }
    const out = await assign()
    expect(out.code).toBe(422)
    expect(out.body.reason).toBe('no-address')
  })

  it('refuses an unknown list rather than creating one', async () => {
    seedContact(grantedHere())
    const out = await assign({ listId: 'nope' })
    expect(out.code).toBe(404)
    expect(store[`orgs/${ORG_ID}/lists/nope`]).toBeUndefined()
  })
})

describe('the two acts stay apart', () => {
  /*
   * Replying is transactional and enrolls nobody. If answering a customer
   * quietly added them to a marketing audience, a merchant doing the ordinary
   * thing would be doing the consequential one.
   */
  it('replying enrolls nobody and writes no consent', async () => {
    seedContact(grantedHere())
    const out = await drive(inboxReplyHandler, {
      hostId: HOST_ID,
      submissionId: 'sub-1',
      subject: 'Re: your message',
      message: 'Thanks for getting in touch.',
    })
    expect(out.code).toBe(200)
    expect(sendEmail).toHaveBeenCalled()
    expect(memberRows()).toHaveLength(0)
    expect(assignmentRows()).toHaveLength(0)
  })

  it('enrolling sends nothing', async () => {
    await assign({ attestConsent: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('the picker', () => {
  it('offers the org’s lists and the person’s consent state together', async () => {
    store[`orgs/${ORG_ID}/lists/list-2`] = { name: 'VIPs' }
    const out = await drive(inboxListOptionsHandler, {
      hostId: HOST_ID,
      submissionId: 'sub-1',
    })
    expect(out.code).toBe(200)
    expect(out.body.lists.map((list: any) => list.name)).toEqual([
      'Newsletter',
      'VIPs',
    ])
    expect(out.body.to).toBe(SENDER)
    expect(out.body.requiresAttestation).toBe(true)
  })

  it('names a list with no name by its id rather than dropping it', async () => {
    store[`orgs/${ORG_ID}/lists/list-2`] = {}
    const out = await drive(inboxListOptionsHandler, {
      hostId: HOST_ID,
      submissionId: 'sub-1',
    })
    expect(out.body.lists.map((list: any) => list.id)).toContain('list-2')
  })
})
