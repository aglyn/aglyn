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
 *
 * @jest-environment node
 */

/**
 * Adding somebody to a list from the console — who gets on, and on what basis.
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `enrollListMember` is the REAL helper, reached by its deep path. It is
 *     the only writer of the member collection and it owns both the document
 *     id and the recorded-refusal backstop, so doubling it would turn every
 *     assertion about what was written into an assertion about the double.
 *     The store below is therefore real enough for it: keyed `getAll`,
 *     `set({merge:true})`, and a `where(field,'in',values)` good for the
 *     chunked contact lookup.
 *  2. `assignmentBasis`, `assignmentReadout`, `readMarketingBasis`,
 *     `isOrgWideMember`, `personKey` and `normalizeContactEmail` are the real
 *     pure functions. The consent split and the org-reach predicate ARE the
 *     rules under test; a double for any of them would assert the double.
 *  3. `filterSendableForHost` and `filterSuppressedEmails` are doubles over a
 *     set of suppressed addresses. Whether the real helpers read the right two
 *     collections belongs to `email-suppression.spec.ts`; what this file
 *     certifies is that the ADD goes through them.
 *  4. Nothing sends anything. There is no mail double here because there is
 *     no send: enrolling somebody is not a send, and a spy would have to
 *     record zero calls forever to say so.
 */

const platformSuppressed = new Set<string>()
const hostSuppressed = new Set<string>()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  // The real pure modules the barrel would have supplied. Requiring them by
  // their own paths keeps the client-side barrel — and its React surface —
  // out of a suite that is testing a request handler.
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/list-assignment-policy'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
  // The rule model, real: the preview route decides whether a set of filters
  // selects nobody, and a stubbed answer would make that decision a property
  // of this file.
  ...jest.requireActual('@aglyn/aglyn/app-utils/dynamic-list-rule'),
}))

/**
 * What the silo scan finds, as this suite chooses to answer it.
 *
 * The scanner is doubled and the CONSENT GATE is not — which is the division
 * this file exists to hold. Who a rule selects is `collectDynamicListCandidates`'
 * own question, tested against real silos in
 * `dynamic-list-materialize.spec.ts`; what happens to the people it names is
 * this route's, and that is answered here by the real policy, the real
 * suppression pair and the real writer.
 */
let mockScan: {
  candidates: Array<{ silo: string; email: string; name?: string }>
  complete: boolean
} = { candidates: [], complete: true }
/** Proves the route asked, rather than answering from somewhere else. */
let mockScanCalls: Array<Record<string, unknown>> = []

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`

const OPTED_IN = 'priya@lumen.co'
const REFUSED = 'sam@lumen.co'
const UNKNOWN = 'dev@lumen.co'
const OPTED_IN_AT = Date.UTC(2024, 4, 2)

let store: Record<string, Record<string, any>> = {}
let decodedToken: { uid: string } = { uid: 'editor-uid' }
let membership: { orgId: string; member: Record<string, unknown> } | null = null
let contactSeq = 0
/** Makes the CRM read throw, so the fail-closed branch can be driven. */
let contactsUnreadable = false

const memberRows = () =>
  Object.keys(store).filter((path) => path.startsWith(`${MEMBERS_PATH}/`))
const memberFor = (email: string) =>
  Object.values(store).find(
    (row) => row?.['email'] === email && row?.['source'] !== undefined,
  )

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
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
  get firestore() {
    return firestoreHandle
  },
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
  const build = (
    filters: Array<[string, string, unknown]>,
    cap: number | null,
  ): any => ({
    doc: (id: string) => docHandle(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      build([...filters, [field, op, value]], cap),
    orderBy: () => build(filters, cap),
    limit: (value: number) => build(filters, value),
    get: async () => {
      const matched = childPaths(path)
        .filter((key) =>
          filters.every(([field, op, value]) =>
            op === 'in'
              ? (value as unknown[]).includes(store[key]?.[field])
              : store[key]?.[field] === value,
          ),
        )
        .sort()
        .slice(0, cap ?? Infinity)
        .map(snapshotFor)
      return { docs: matched, empty: matched.length === 0, size: matched.length }
    },
    get parent() {
      return docHandle(path.slice(0, path.lastIndexOf('/')))
    },
  })
  return build([], null)
}

const firestoreHandle: any = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  collectDynamicListCandidates: async (options: Record<string, unknown>) => {
    mockScanCalls.push(options)
    return {
      candidates: mockScan.candidates,
      complete: mockScan.complete,
      cursor: null,
      empty: false,
      read: mockScan.candidates.length,
    }
  },
  // The REAL writer. Doubling it would make "the person who declined was not
  // enrolled" a claim about the double rather than about the collection.
  enrollListMember: jest.requireActual(
    '@aglyn/tenant-data-admin/server/list-members',
  ).enrollListMember,
  // BOTH lists, as the real pair does, off one set of facts so the two halves
  // cannot disagree about who is suppressed for reasons of the double's own.
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter(
      (email) => !platformSuppressed.has(email) && !hostSuppressed.has(email),
    ),
  filterSuppressedEmails: async (emails: string[]) =>
    emails.filter((email) => !platformSuppressed.has(email)),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  orgDataCollectionForHost: async () => {
    if (contactsUnreadable) throw new Error('contacts unavailable')
    return collectionHandle(`orgs/${ORG_ID}/contacts`)
  },
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => firestoreHandle,
    }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
}))

import {
  CONSOLE_ADD_SOURCE,
  LIST_MEMBER_BATCH_MAX,
  emailListMembersAddHandler,
  emailListMembersPreviewHandler,
  emailListRulePreviewHandler,
} from './server-console'

async function drive(
  handler: typeof emailListMembersAddHandler,
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

const add = (body: Record<string, unknown> = {}, headers?: any) =>
  drive(
    emailListMembersAddHandler,
    { hostId: HOST_ID, listId: LIST_ID, ...body },
    headers,
  )
const preview = (body: Record<string, unknown> = {}, headers?: any) =>
  drive(
    emailListMembersPreviewHandler,
    { hostId: HOST_ID, listId: LIST_ID, ...body },
    headers,
  )
const findPeople = (body: Record<string, unknown> = {}, headers?: any) =>
  drive(
    emailListRulePreviewHandler,
    {
      hostId: HOST_ID,
      listId: LIST_ID,
      rule: { sources: ['contacts'] },
      ...body,
    },
    headers,
  )

/** Puts a contact on the org, carrying whatever consent facts. */
const seedContact = (email: string, consent: Record<string, unknown>) => {
  store[`orgs/${ORG_ID}/contacts/c${(contactSeq += 1)}`] = { email, ...consent }
}

beforeEach(() => {
  store = {}
  mockScan = { candidates: [], complete: true }
  mockScanCalls = []
  contactSeq = 0
  contactsUnreadable = false
  platformSuppressed.clear()
  hostSuppressed.clear()
  decodedToken = { uid: 'editor-uid' }
  membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: true } }
  store[`hosts/${HOST_ID}`] = {
    displayName: 'Lumen',
    memberRoles: { 'editor-uid': 'editor' },
  }
  store[LIST_PATH] = { name: 'Newsletter' }
  seedContact(OPTED_IN, {
    marketingConsent: true,
    marketingConsentAtMs: OPTED_IN_AT,
  })
  seedContact(REFUSED, { marketingConsent: false })
})

describe('THE CONTROL: the ordinary add works', () => {
  /*
   * Every assertion below is of the form "nobody was enrolled" or "this basis
   * was written". A route that 500s on its first line satisfies half of them
   * and a store that never records satisfies the rest, so the reading that
   * proves the machinery is live comes first.
   */
  it('enrolls somebody with a stored opt-in, with no attestation at all', async () => {
    const out = await add({ email: OPTED_IN })
    expect(out.code).toBe(200)
    expect(out.body.added).toBe(1)
    expect(memberRows()).toHaveLength(1)
    expect(memberFor(OPTED_IN)).toMatchObject({
      email: OPTED_IN,
      source: CONSOLE_ADD_SOURCE,
      via: 'manual',
      marketingConsent: true,
      marketingConsentBasis: 'contact-opt-in',
    })
  })
})

describe('a stored refusal', () => {
  /*
   * THE ONE THAT MATTERS. Every standalone ESP lets an operator add an address
   * by hand, and now this product does too — but a stored `declined` is this
   * person having already said otherwise ON THE RECORD, and if an attestation
   * could reach past it there would be no difference between recording a
   * refusal and discarding one.
   */
  it('is not overridable by an attestation, and nothing is written', async () => {
    const out = await add({ email: REFUSED, attestConsent: true })
    expect(out.code).toBe(200)
    expect(out.body.added).toBe(0)
    expect(out.body.results[0]).toMatchObject({ reason: 'declined' })
    expect(memberRows()).toHaveLength(0)
  })

  it('is not overridable by hiding inside a batch either', async () => {
    const out = await add({
      emails: [UNKNOWN, REFUSED, OPTED_IN],
      attestConsent: true,
    })
    expect(out.body.added).toBe(2)
    expect(memberFor(REFUSED)).toBeUndefined()
    // The two who could be added were, so the refusal above is this person's
    // and not the whole request having failed.
    expect(memberFor(UNKNOWN)).toBeDefined()
    expect(memberFor(OPTED_IN)).toBeDefined()
  })

  it('is reported as unenrollable by the preview, with no attestation offered', async () => {
    const out = await preview({ email: REFUSED })
    expect(out.code).toBe(200)
    expect(out.body.refused).toBe(1)
    expect(out.body.needAttestation).toBe(0)
    expect(out.body.verdicts[0].requiresAttestation).toBe(false)
    expect(out.body.verdicts[0].summary).toContain('no way to override')
  })

  /*
   * A refusal the CRM does not carry but the MEMBERSHIP does. `enrollListMember`
   * holds the row and is the backstop for every enrollment route; the two
   * records disagreeing is exactly when the backstop has to answer.
   */
  it('recorded on the membership itself still refuses', async () => {
    const { personKey } = jest.requireActual('@aglyn/aglyn/app-utils/person-key')
    store[`${MEMBERS_PATH}/${personKey(UNKNOWN)}`] = {
      email: UNKNOWN,
      marketingConsent: false,
    }
    const out = await add({ email: UNKNOWN, attestConsent: true })
    expect(out.body.added).toBe(0)
    expect(out.body.results[0].reason).toBe('declined')
    expect(store[`${MEMBERS_PATH}/${personKey(UNKNOWN)}`]).toEqual({
      email: UNKNOWN,
      marketingConsent: false,
    })
  })
})

describe('no consent record either way', () => {
  it('is refused when the operator asserts nothing', async () => {
    const out = await add({ email: UNKNOWN })
    expect(out.body.added).toBe(0)
    expect(out.body.results[0].reason).toBe('no-basis')
    expect(memberRows()).toHaveLength(0)
  })

  it('an attestation is recorded with the account that made it, and the date', async () => {
    const before = Date.now()
    const out = await add({ email: UNKNOWN, attestConsent: true })
    expect(out.body.added).toBe(1)
    const member = memberFor(UNKNOWN) as Record<string, any>
    expect(member['marketingConsentBasis']).toBe('operator-attested')
    // Never optional for this basis: an attestation nobody is named for is
    // indistinguishable from an opt-in.
    expect(member['marketingConsentByUid']).toBe('editor-uid')
    expect(member['marketingConsentAtMs']).toBeGreaterThanOrEqual(before)
  })

  it('the preview says the absence out loud rather than resolving it', async () => {
    const out = await preview({ email: UNKNOWN })
    expect(out.body.needAttestation).toBe(1)
    expect(out.body.verdicts[0].summary).toContain('no marketing opt-in on record')
  })
})

describe('a stored opt-in', () => {
  /*
   * The PERSON'S date, not the operator's click. Restamping it would report
   * every historical opt-in as having happened now, which walks records across
   * the forward cutoff the consent policy grandfathers on.
   */
  it('carries the date the person said yes, attributable to nobody', async () => {
    await add({ email: OPTED_IN })
    const member = memberFor(OPTED_IN) as Record<string, any>
    expect(member['marketingConsentAtMs']).toBe(OPTED_IN_AT)
    expect(member['marketingConsentByUid']).toBeNull()
  })

  it('does not become an attestation just because one was given', async () => {
    await add({ email: OPTED_IN, attestConsent: true })
    const member = memberFor(OPTED_IN) as Record<string, any>
    expect(member['marketingConsentBasis']).toBe('contact-opt-in')
    expect(member['marketingConsentAtMs']).toBe(OPTED_IN_AT)
  })

  /*
   * Nothing guarantees one contact per address, so two records for one person
   * can disagree. A recorded refusal is the answer whenever one exists — the
   * alternative makes the outcome depend on which document the query answered
   * first.
   */
  it('loses to a refusal on a SECOND record for the same person', async () => {
    seedContact(OPTED_IN, { marketingConsent: false })
    const out = await add({ email: OPTED_IN, attestConsent: true })
    expect(out.body.added).toBe(0)
    expect(out.body.results[0].reason).toBe('declined')
  })
})

describe('a consent read that throws', () => {
  /*
   * It falls to `declined` for the whole batch, which reads oddly until the
   * alternative is named. A throwing read can neither say the person
   * consented nor that they refused; the question is which way the unknown
   * should fall. `unrecorded` would leave the attestation control on screen
   * and let the operator add somebody whose stored refusal the route simply
   * failed to see, and no later surface would revisit it. A refusal costs a
   * retry.
   */
  it('refuses everybody rather than treating the unknown as no record', async () => {
    contactsUnreadable = true
    const out = await add({
      emails: [OPTED_IN, UNKNOWN],
      attestConsent: true,
    })
    expect(out.body.added).toBe(0)
    expect(
      out.body.results.map((result: any) => result.reason),
    ).toEqual(['declined', 'declined'])
    expect(memberRows()).toHaveLength(0)
  })

  it('says so on the preview too, offering no attestation', async () => {
    contactsUnreadable = true
    const out = await preview({ email: UNKNOWN })
    expect(out.body.refused).toBe(1)
    expect(out.body.needAttestation).toBe(0)
  })

  it('THE CONTROL: the same batch goes through when the read works', async () => {
    const out = await add({ emails: [OPTED_IN, UNKNOWN], attestConsent: true })
    expect(out.body.added).toBe(2)
  })
})

describe('a suppressed address', () => {
  it('is refused at enrollment by the platform list, and named', async () => {
    platformSuppressed.add(OPTED_IN)
    const out = await add({ email: OPTED_IN, attestConsent: true })
    expect(out.body.added).toBe(0)
    expect(out.body.results[0].reason).toBe('suppressed-platform')
    expect(memberRows()).toHaveLength(0)
  })

  it('is refused by this site’s own list, and told apart from the platform one', async () => {
    hostSuppressed.add(OPTED_IN)
    const out = await preview({ email: OPTED_IN })
    expect(out.body.verdicts[0].refusal).toBe('suppressed-host')
    expect(out.body.verdicts[0].summary).toContain('unsubscribed')
  })

  /*
   * Suppression outranks a good consent record in the READOUT, so the surface
   * never offers a control the route would then refuse.
   */
  it('offers no attestation however good the consent record is', async () => {
    platformSuppressed.add(UNKNOWN)
    const out = await preview({ email: UNKNOWN })
    expect(out.body.needAttestation).toBe(0)
    expect(out.body.verdicts[0].requiresAttestation).toBe(false)
  })
})

describe('the two gates on the route', () => {
  it('refuses an unauthenticated caller', async () => {
    const out = await add({ email: OPTED_IN }, {})
    expect(out.code).toBe(401)
    expect(memberRows()).toHaveLength(0)
  })

  it('refuses a site VIEWER, who is not an editor of anything', async () => {
    store[`hosts/${HOST_ID}`].memberRoles = { 'editor-uid': 'viewer' }
    const out = await add({ email: OPTED_IN })
    expect(out.code).toBe(403)
    expect(memberRows()).toHaveLength(0)
  })

  /*
   * THE SECOND GATE, and the one a host role alone would miss. A site
   * collaborator is an org member with `allHosts: false`. Lists are org-wide
   * and their members are contacts, so a collaborator invited to one site must
   * not be able to enroll people into an audience every other site can mail —
   * nor, through the preview, read the consent record of any address they care
   * to type.
   */
  it('refuses a site COLLABORATOR, on both routes', async () => {
    membership = {
      orgId: ORG_ID,
      member: { role: 'editor', allHosts: false, hostAccess: { [HOST_ID]: true } },
    }
    expect((await add({ email: OPTED_IN })).code).toBe(403)
    expect((await preview({ email: OPTED_IN })).code).toBe(403)
    expect(memberRows()).toHaveLength(0)
  })

  it('refuses a SUSPENDED org', async () => {
    membership = {
      orgId: ORG_ID,
      member: { role: 'owner', allHosts: true, orgSuspended: true },
    }
    expect((await add({ email: OPTED_IN })).code).toBe(403)
    expect(memberRows()).toHaveLength(0)
  })

  it('does not CREATE a list that does not exist', async () => {
    const out = await add({ listId: 'nope', email: OPTED_IN })
    expect(out.code).toBe(404)
    expect(store['orgs/org-1/lists/nope']).toBeUndefined()
    expect(memberRows()).toHaveLength(0)
  })
})

describe('a pasted batch', () => {
  it('REPORTS an unusable line rather than dropping it', async () => {
    const out = await add({
      emails: [OPTED_IN, 'not an address', UNKNOWN],
      attestConsent: true,
    })
    expect(out.body.results).toHaveLength(3)
    const bad = out.body.results.find(
      (result: any) => result.input === 'not an address',
    )
    expect(bad.enrolled).toBe(false)
    expect(bad.reason).toBe('unroutable-address')
    // The other two went on, so the report above is about that line and not
    // about the batch having been abandoned.
    expect(out.body.added).toBe(2)
  })

  it('counts one person once, however many times the paste names them', async () => {
    const out = await add({
      emails: [UNKNOWN, UNKNOWN.toUpperCase(), ` ${UNKNOWN} `],
      attestConsent: true,
    })
    expect(out.body.results).toHaveLength(1)
    expect(out.body.added).toBe(1)
    expect(memberRows()).toHaveLength(1)
  })

  /*
   * ONE attestation, applied per address by the policy — so it reaches only
   * the people who need it. An operator who ticks the box for the two people
   * with no record has not thereby restamped everybody else's basis.
   */
  it('applies the single attestation only where it is needed', async () => {
    await add({ emails: [OPTED_IN, UNKNOWN], attestConsent: true })
    expect((memberFor(OPTED_IN) as any)['marketingConsentBasis']).toBe(
      'contact-opt-in',
    )
    expect((memberFor(UNKNOWN) as any)['marketingConsentBasis']).toBe(
      'operator-attested',
    )
  })

  it('refuses more addresses than one go can take, and writes nothing', async () => {
    const emails = Array.from(
      { length: LIST_MEMBER_BATCH_MAX + 1 },
      (_value, index) => `person${index}@lumen.co`,
    )
    const out = await add({ emails, attestConsent: true })
    expect(out.code).toBe(400)
    expect(memberRows()).toHaveLength(0)
    // At the cap it goes through, so the refusal is the ceiling and not a
    // batch path that never worked.
    expect(
      (await add({ emails: emails.slice(0, LIST_MEMBER_BATCH_MAX), attestConsent: true }))
        .code,
    ).toBe(200)
  })
})

describe('the preview and the add cannot drift', () => {
  /*
   * The operator attests against the preview's COUNT. If the two ran different
   * rules — or the same rule over different reads — the number they stood
   * behind would not be the number that acted, which is the only thing that
   * makes one assertion over a batch defensible.
   */
  it('the preview writes nothing, and its counts are what the add does', async () => {
    const emails = [OPTED_IN, REFUSED, UNKNOWN, 'nope']
    const shown = await preview({ emails })
    expect(memberRows()).toHaveLength(0)
    expect(shown.body.optedIn).toBe(1)
    expect(shown.body.needAttestation).toBe(1)
    expect(shown.body.refused).toBe(2)

    const done = await add({ emails, attestConsent: true })
    expect(done.body.added).toBe(shown.body.optedIn + shown.body.needAttestation)
    expect(memberRows()).toHaveLength(2)
  })

  /*
   * The preview has nowhere to put an attestation, so sending one changes
   * nothing about its answer. The person with no record on file comes back
   * needing one, and — this is the half a `no-basis` refusal would break —
   * NOT as somebody who cannot be added.
   */
  it('answers the same whether or not an attestation is sent with it', async () => {
    const asked = await preview({ email: UNKNOWN })
    const askedWithBox = await preview({ email: UNKNOWN, attestConsent: true })
    expect(askedWithBox.body).toEqual(asked.body)
    expect(asked.body.needAttestation).toBe(1)
    expect(asked.body.refused).toBe(0)
    expect(asked.body.verdicts[0]).toMatchObject({
      requiresAttestation: true,
      refusal: null,
    })
  })
})

/**
 * FINDING PEOPLE IS THE SAME ACT AS TYPING THEM, and meets the same gate.
 *
 * The register already carries four bulk paths that reached real inboxes with
 * no unsubscribe header, no suppression check and no cap. An "add the 500
 * people who match" button is exactly the shape of a fifth, and the only thing
 * that stops it being one is that the addresses a search finds go through the
 * SAME resolution a pasted column does — before they are offered, and again
 * when they are added.
 *
 * The scanner is doubled here and the policy is not, so every assertion below
 * is about the gate rather than about who a rule selects.
 */
describe('finding people by rule meets the consent gate', () => {
  it('THE CONTROL: the route asks the scanner and reports what it found', async () => {
    // Anti-vacuity for the whole block. Every assertion after this is of the
    // form "the refused address did not come back enrollable", and a route
    // that returned nothing at all would satisfy all of them.
    mockScan = {
      candidates: [{ silo: 'contacts', email: OPTED_IN }],
      complete: true,
    }
    const out = await findPeople()
    expect(out.code).toBe(200)
    expect(mockScanCalls).toHaveLength(1)
    expect(mockScanCalls[0]['hostId']).toBe(HOST_ID)
    expect(out.body.matched).toBe(1)
    expect(out.body.emails).toEqual([OPTED_IN])
    expect(out.body.optedIn).toBe(1)
    expect(out.body.needAttestation).toBe(0)
    expect(out.body.refused).toBe(0)
  })

  it('reports a SUPPRESSED match as refused, not as enrollable', async () => {
    hostSuppressed.add(UNKNOWN)
    mockScan = {
      candidates: [
        { silo: 'contacts', email: OPTED_IN },
        { silo: 'contacts', email: UNKNOWN },
      ],
      complete: true,
    }
    const out = await findPeople()
    expect(out.body.refused).toBe(1)
    expect(out.body.optedIn).toBe(1)
    const verdict = out.body.verdicts.find((row: any) => row.email === UNKNOWN)
    expect(verdict.refusal).toBeTruthy()
  })

  it('a match with no opt-in on record needs the attestation', async () => {
    mockScan = {
      candidates: [{ silo: 'leads', email: UNKNOWN }],
      complete: true,
    }
    const out = await findPeople()
    expect(out.body.needAttestation).toBe(1)
    expect(out.body.optedIn).toBe(0)
    expect(
      out.body.verdicts.find((row: any) => row.email === UNKNOWN)
        .requiresAttestation,
    ).toBe(true)
  })

  it('a stored refusal is refused however the person was found', async () => {
    // The one that matters most. `REFUSED` records `marketingConsent: false`,
    // and being selected by a rule is not a reason to overrule a person's own
    // decision — a search that could enroll them would be a way to launder a
    // refusal through a filter.
    mockScan = {
      candidates: [{ silo: 'contacts', email: REFUSED }],
      complete: true,
    }
    const out = await findPeople()
    expect(out.body.refused).toBe(1)
    expect(out.body.needAttestation).toBe(0)
  })

  it('writes nothing at all', async () => {
    mockScan = {
      candidates: [{ silo: 'contacts', email: OPTED_IN }],
      complete: true,
    }
    await findPeople()
    expect(memberRows()).toEqual([])
  })

  it('adding what it found still meets the add route’s own checks', async () => {
    // The preview is a readout, never a permission. The add re-runs every
    // check server-side, so a client that posts the found addresses straight
    // to the add route gets the same refusals.
    mockScan = {
      candidates: [
        { silo: 'contacts', email: OPTED_IN },
        { silo: 'contacts', email: REFUSED },
      ],
      complete: true,
    }
    const found = await findPeople()
    const out = await add({ emails: found.body.emails, attestConsent: true })
    expect(out.code).toBe(200)
    expect(out.body.added).toBe(1)
    expect(memberFor(OPTED_IN)).toBeTruthy()
    expect(memberFor(REFUSED)).toBeUndefined()
  })

  it('caps the batch and still reports the WHOLE match', async () => {
    /*
     * The number a merchant is told and the number the button acts on are
     * different things, and conflating them is how "add everyone who matches"
     * silently adds a hundred of four hundred. `matched` is the audience;
     * `emails` is one batch of it; `truncated` says so.
     */
    const many = Array.from(
      { length: LIST_MEMBER_BATCH_MAX + 25 },
      (_unused, index) => ({
        silo: 'leads',
        email: `p${String(index).padStart(3, '0')}@lumen.co`,
      }),
    )
    mockScan = { candidates: many, complete: true }
    const out = await findPeople()
    expect(out.body.matched).toBe(LIST_MEMBER_BATCH_MAX + 25)
    expect(out.body.emails).toHaveLength(LIST_MEMBER_BATCH_MAX)
    expect(out.body.truncated).toBe(true)
  })

  it('says when the SCAN itself was cut short', async () => {
    // A different shortfall from a truncated batch, and reported separately:
    // here `matched` is a floor rather than a total, because the scan stopped
    // at its read budget.
    mockScan = {
      candidates: [{ silo: 'leads', email: UNKNOWN }],
      complete: false,
    }
    const out = await findPeople()
    expect(out.body.complete).toBe(false)
    expect(out.body.truncated).toBe(false)
  })

  it('a rule with no source is EMPTY, not a search that found nobody', async () => {
    // The two look identical in a count and are not the same fact — one is a
    // rule that cannot select anybody, the other is one that ran and matched
    // none.
    const out = await findPeople({ rule: { sources: [] } })
    expect(out.body.empty).toBe(true)
    expect(out.body.matched).toBe(0)
    // And it does not pay for a scan to find that out.
    expect(mockScanCalls).toEqual([])
  })

  it('is behind the same two gates as the add', async () => {
    // A single-site collaborator may not read the consent record of everybody
    // a rule selects, any more than they may enroll them.
    membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: false } }
    mockScan = {
      candidates: [{ silo: 'contacts', email: OPTED_IN }],
      complete: true,
    }
    const out = await findPeople()
    expect(out.code).toBe(403)
    expect(mockScanCalls).toEqual([])
  })

  it('refuses an unauthenticated caller', async () => {
    const out = await findPeople({}, {})
    expect(out.code).toBe(401)
  })
})
