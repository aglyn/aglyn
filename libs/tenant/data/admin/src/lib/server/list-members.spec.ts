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
 * The only writer of a list membership — what it records, and what it refuses.
 *
 * These assertions are about the WRITER rather than about any route, because
 * four routes reach it (the commerce newsletter handler, the workflow
 * `enrollList` step, the dynamic-list materializer, and the Inbox's
 * assignment) and the guarantees have to hold for all of them. A route's own
 * file can only prove its own path; this one proves the collection's.
 *
 * `apps/console/specs/list-enrollment-is-one-document-per-person.spec.ts`
 * owns the id derivation and the legacy adoption. What is here is the consent
 * basis and the refusal, which that file predates.
 *
 * The Firestore double is a path→document map with a keyed `getAll` and a
 * merging `set`, which is all this function uses.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

const LIST_PATH = 'orgs/org-1/lists/list-1'
const MEMBERS_PATH = `${LIST_PATH}/members`
const EMAIL = 'priya@lumen.co'

let store: Record<string, Record<string, any>> = {}

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
    // Nested maps MERGE, as Firestore's `{ merge: true }` does. A shallow
    // fake would let a write that erases every other site's consent entry
    // pass here and erase them in production.
    const deepMerge = (
      into: Record<string, any>,
      from: Record<string, any>,
    ): Record<string, any> => {
      const next = { ...into }
      for (const [key, value] of Object.entries(from)) {
        next[key] =
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          next[key] &&
          typeof next[key] === 'object' &&
          !Array.isArray(next[key])
            ? deepMerge(next[key], value)
            : value
      }
      return next
    }
    store[path] = options?.merge ? deepMerge(store[path] ?? {}, data) : data
  },
  collection: (name: string) => ({
    doc: (id: string) => docHandle(`${path}/${name}/${id}`),
  }),
})

const firestoreHandle: any = {
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

import { enrollListMember } from './list-members'
import {
  personKey,
  readMarketingBasis,
  soloConsentGroup,
} from '@aglyn/aglyn/server'

const KEY = personKey(EMAIL) as string
/** The site the enrollment is made in the name of. */
const HOST = 'site-1'
/** A sister brand on the same org — the list is shared, the basis is not. */
const OTHER_HOST = 'site-2'

const enroll = (input: Record<string, unknown> = {}) =>
  enrollListMember({
    listRef: docHandle(LIST_PATH),
    group: soloConsentGroup(HOST),
    email: EMAIL,
    source: 'test',
    ...input,
  } as never)

const theRow = () => store[`${MEMBERS_PATH}/${KEY}`]
const rowCount = () =>
  Object.keys(store).filter((path) => path.startsWith(`${MEMBERS_PATH}/`)).length

beforeEach(() => {
  store = {}
})

describe('a stored refusal on the membership', () => {
  beforeEach(() => {
    store[`${MEMBERS_PATH}/${KEY}`] = {
      email: EMAIL,
      marketingConsent: false,
      source: 'api',
    }
  })

  /*
   * THE BACKSTOP. The guard is here rather than at the four call sites because
   * a guard on one button leaves the newsletter handler, the `enrollList` step
   * and the rule materializer free to put the same person back — and each of
   * those runs without anybody watching.
   */
  it('refuses, whatever basis the caller offers', async () => {
    for (const input of [
      {},
      { marketingConsent: true },
      {
        consent: {
          basis: 'operator-attested',
          atMs: Date.now(),
          byUid: 'someone',
        },
      },
      { consent: { basis: 'contact-opt-in', atMs: Date.now() } },
    ]) {
      expect(await enroll(input)).toEqual({
        enrolled: false,
        refusal: 'declined',
      })
    }
  })

  it('leaves the row exactly as it found it', async () => {
    await enroll({ marketingConsent: true })
    expect(theRow()).toEqual({
      email: EMAIL,
      marketingConsent: false,
      source: 'api',
    })
  })

  it('does not write a second row beside the refusal', async () => {
    await enroll({ marketingConsent: true })
    expect(rowCount()).toBe(1)
  })
})

describe('the basis a row records', () => {
  /** The entry the enrolling site's basis lives in. */
  const entryFor = (hostId: string) =>
    theRow()?.marketingConsentByHost?.[hostId] ?? {}
  /** And the same fact through the reader the send path uses. */
  const basisFor = (hostId: string) =>
    readMarketingBasis(theRow() ?? null, soloConsentGroup(hostId)).basis

  it('reads a ticked checkbox as an opt-in, asserted by nobody', async () => {
    const before = Date.now()
    await enroll({ marketingConsent: true })
    expect(basisFor(HOST)).toBe('granted')
    expect(entryFor(HOST).marketingConsentBasis).toBe('contact-opt-in')
    expect(entryFor(HOST).marketingConsentByUid).toBeNull()
    expect(entryFor(HOST).marketingConsentAtMs).toBeGreaterThanOrEqual(before)
  })

  /**
   * A LIST IS ORG-SHARED AND ITS CONSENT IS NOT.
   *
   * Every site in the org can send to this list, so a basis written at the
   * top of the row would enroll somebody into one client's newsletter and
   * make them mailable by every client the agency runs.
   */
  it('records the basis for the enrolling site and for nobody else', async () => {
    await enroll({ marketingConsent: true })
    expect(basisFor(HOST)).toBe('granted')
    expect(basisFor(OTHER_HOST)).toBe('unrecorded')
    expect('marketingConsent' in theRow()).toBe(false)
  })

  /** And the capture attribution, which is a separate fact. */
  it('stamps the enrolling site as the capturing one', async () => {
    await enroll({ marketingConsent: true })
    expect(theRow().capturedByHostIds).toEqual([HOST])
  })

  /**
   * A second site enrolling the same person ADDS a grant. A write that
   * replaced the map would silently revoke the first site's basis, which is
   * the leak inverted and equally invisible.
   */
  it('adds a second site’s basis without erasing the first', async () => {
    await enroll({ marketingConsent: true })
    await enrollListMember({
      listRef: docHandle(LIST_PATH),
      group: soloConsentGroup(OTHER_HOST),
      email: EMAIL,
      source: 'test',
      marketingConsent: true,
    } as never)
    expect(basisFor(HOST)).toBe('granted')
    expect(basisFor(OTHER_HOST)).toBe('granted')
  })

  it('keeps an attestation’s account and moment', async () => {
    const atMs = Date.UTC(2026, 7, 29)
    await enroll({
      consent: { basis: 'operator-attested', atMs, byUid: 'editor-uid' },
    })
    expect(entryFor(HOST).marketingConsentBasis).toBe('operator-attested')
    expect(entryFor(HOST).marketingConsentByUid).toBe('editor-uid')
    expect(entryFor(HOST).marketingConsentAtMs).toBe(atMs)
  })

  /*
   * Enrolling is an ACT. A caller with no basis has nothing to say about
   * consent, and a row that recorded `false` for them would be a refusal
   * nobody made — which is the one value this collection must never
   * manufacture, because `readMarketingBasis` treats it as unmailable forever.
   */
  it('writes no consent field at all when the caller has no basis', async () => {
    await enroll()
    expect(theRow().marketingConsentByHost).toBeUndefined()
    expect('marketingConsent' in theRow()).toBe(false)
    expect(basisFor(HOST)).toBe('unrecorded')
  })

  it('never erases a basis given on an earlier enrollment', async () => {
    await enroll({ marketingConsent: true })
    await enroll({ source: 'newsletter' })
    expect(basisFor(HOST)).toBe('granted')
    expect(entryFor(HOST).marketingConsentBasis).toBe('contact-opt-in')
  })

  /*
   * A row keyed under one of the two pre-`personKey` derivations is ADOPTED,
   * and the basis has to land on the row that was adopted. Writing it to the
   * canonical id instead would split the person in half: a membership at one
   * id and their consent at another.
   */
  it('lands on a legacy row rather than beside it', async () => {
    const { createHmac } = require('node:crypto')
    const legacyId = createHmac('sha256', 'aglyn-list-member')
      .update(EMAIL)
      .digest('hex')
      .slice(0, 20)
    store[`${MEMBERS_PATH}/${legacyId}`] = { email: EMAIL, source: 'newsletter' }

    const result = await enroll({ marketingConsent: true })

    expect(result).toMatchObject({ enrolled: true, memberId: legacyId, adopted: true })
    expect(rowCount()).toBe(1)
    expect(
      store[`${MEMBERS_PATH}/${legacyId}`].marketingConsentByHost?.[HOST]
        ?.marketingConsentBasis,
    ).toBe('contact-opt-in')
  })
})

describe('an address the collection cannot key', () => {
  it('is refused as unusable, and distinguishably so', async () => {
    expect(await enroll({ email: 'not-an-address' })).toEqual({
      enrolled: false,
      refusal: 'unusable-address',
    })
    expect(rowCount()).toBe(0)
  })
})
