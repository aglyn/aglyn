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
 * Dynamic list membership, and the one rule it may never break.
 *
 * Capacity in this product is enforced at the REDUCTION and never at the use:
 * a limit that refuses a person or their data leaks, because the person is
 * already there and dropping them is not a refusal, it is deletion. A
 * materializer is the easiest place in the system to get that wrong — a
 * `.slice(0, cap)` reads as prudence and silently un-enrolls people who
 * qualified.
 *
 * So the assertions below are made against the MEMBER ROWS that exist
 * afterwards, not against the returned counts. A run that reports the right
 * number and left the collection short is the failure being guarded.
 */

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

const store: Record<string, Record<string, any>> = {}

/** `orderBy(FieldPath.documentId())` — the sentinel the fake recognizes. */
const DOCUMENT_ID = { __documentId: true }

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: { FieldPath: { documentId: () => DOCUMENT_ID } },
  },
}))

jest.mock('./organizations', () => ({
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    firestore.collection(`orgs/org-1/${name}`),
  // Identity: what `scopedToHost` narrows is asserted by its own suite, and a
  // fake filter here would only assert the fake.
  scopedToHost: (ref: unknown) => ref,
}))

/**
 * A path-keyed Firestore stand-in.
 *
 * `orderBy`/`startAfter` are implemented for real over sorted document ids,
 * because the paging cursor is the mechanism under test in the resume case —
 * a fake that returned every document on every page would let a broken cursor
 * pass.
 */
const childrenOf = (path: string) =>
  Object.keys(store)
    .filter(
      (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
    .sort()

const snapshotOf = (path: string) => ({
  id: path.split('/').pop() as string,
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => store[path]?.[field],
  ref: docRef(path),
})

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get firestore() {
      return firestore
    },
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      store[path] = options?.merge
        ? { ...(store[path] ?? {}), ...value }
        : { ...value }
    },
    delete: async () => {
      delete store[path]
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const build = (state: {
    ordered: boolean
    after: string
    take: number
    filters: Array<[string, unknown]>
  }): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    orderBy: (field: unknown) => {
      if (field !== DOCUMENT_ID) throw new Error('expected orderBy(documentId)')
      return build({ ...state, ordered: true })
    },
    limit: (take: number) => build({ ...state, take }),
    startAfter: (after: string) => build({ ...state, after }),
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return build({ ...state, filters: [...state.filters, [field, value]] })
    },
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
    get: async () => {
      let keys = childrenOf(path)
      if (state.after) {
        keys = keys.filter((key) => (key.split('/').pop() as string) > state.after)
      }
      for (const [field, value] of state.filters) {
        keys = keys.filter((key) => store[key]?.[field] === value)
      }
      if (state.take) keys = keys.slice(0, state.take)
      const docs = keys.map(snapshotOf)
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  })
  return build({ ordered: false, after: '', take: 0, filters: [] })
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => snapshotOf(ref.path)),
}

import { personKey } from '@aglyn/aglyn/server'
import { materializeDynamicList } from './dynamic-list-materialize'

const LIST = 'orgs/org-1/lists/list-1'
const listRef = () => docRef(LIST)
const memberRows = () => childrenOf(`${LIST}/members`)
const memberEmails = () =>
  memberRows()
    .map((key) => String(store[key]['email']))
    .sort()

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  store['hosts/host-1'] = { subdomain: 'acme' }
  store[LIST] = { name: 'VIPs', kind: 'dynamic' }
})

/** Seeds `count` contacts that all match a `tags: ['vip']` rule. */
function seedMatchingContacts(count: number) {
  for (let index = 0; index < count; index += 1) {
    store[`orgs/org-1/contacts/c${String(index).padStart(5, '0')}`] = {
      email: `person${index}@example.com`,
      name: `Person ${index}`,
      tags: ['vip'],
      sources: { form: true },
    }
  }
}

const VIP_RULE = { sources: ['contacts'], tags: ['vip'] }

describe('a dynamic list materializes the whole rule', () => {
  it('enrolls everyone the rule matches, keyed by personKey', async () => {
    seedMatchingContacts(3)
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(result).toMatchObject({ matched: 3, enrolled: 3, removed: 0, complete: true })
    expect(memberEmails()).toEqual([
      'person0@example.com',
      'person1@example.com',
      'person2@example.com',
    ])
    // The one derivation, not a fourth one: `enrollListMember` owns the id.
    expect(memberRows()).toContain(
      `${LIST}/members/${personKey('person0@example.com')}`,
    )
  })

  /**
   * ⚠️ THE ASSERTION THIS RULE EXISTS FOR.
   *
   * 620 matches is past `MAX_RECIPIENTS_PER_SEND` (500) and past a free
   * plan's audience band. Every one of them is enrolled. A ceiling may refuse
   * the SEND — `performCampaignSend` does, naming the count — but nothing may
   * remove a person from a list they qualify for, because the removal is
   * silent, unreproducible and indistinguishable from never having matched.
   */
  it('never sheds a matching person for a quota, however many match', async () => {
    seedMatchingContacts(620)
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(result.matched).toBe(620)
    expect(memberRows()).toHaveLength(620)
    expect(store[LIST]['memberCount']).toBe(620)
  })

  /**
   * ⛔ A rule match is not a consent basis. Stamping one from a rule would let
   * any merchant manufacture consent for their whole contact list by writing
   * a rule that selects it — the exact inference the consent arc refused.
   */
  it('writes no consent basis onto a row it enrolled', async () => {
    seedMatchingContacts(1)
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    const [row] = memberRows()
    expect(store[row]).not.toHaveProperty('marketingConsent')
    expect(store[row]).not.toHaveProperty('marketingConsentAtMs')
    expect(store[row]['via']).toBe('rule')
  })
})

describe('reconciliation removes for MEMBERSHIP, never for capacity', () => {
  it('drops a rule-owned row once the person stops matching', async () => {
    seedMatchingContacts(2)
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(memberRows()).toHaveLength(2)
    // Person 1 loses the tag the rule selects on.
    store['orgs/org-1/contacts/c00001']['tags'] = []
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(result.removed).toBe(1)
    expect(memberEmails()).toEqual(['person0@example.com'])
  })

  /**
   * A row somebody added by hand was put there by a decision, and a rule that
   * does not happen to select that person is not a decision to remove them.
   * Rows written before `via` existed carry no `via` at all and are ineligible
   * for the same reason — the conservative direction for a field introduced
   * after the data.
   */
  it('never removes a manual row, or a row predating the `via` field', async () => {
    store[`${LIST}/members/manual-1`] = {
      email: 'hand@example.com',
      via: 'manual',
    }
    store[`${LIST}/members/legacy-1`] = { email: 'legacy@example.com' }
    seedMatchingContacts(1)
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(result.removed).toBe(0)
    expect(memberEmails()).toEqual([
      'hand@example.com',
      'legacy@example.com',
      'person0@example.com',
    ])
  })
})

describe('the scan budget bounds WORK, not membership', () => {
  /**
   * ⚠️ The second half of the no-drop guarantee, and the subtler one.
   *
   * An incomplete sweep has seen only part of the population, so everybody it
   * did not reach looks like a non-match. Reconciling on that basis deletes
   * real members because a budget ran out — a quota drop wearing the costume
   * of a membership change. The run must remove nobody and must not claim to
   * be complete.
   */
  it('removes nobody when the budget runs out mid-sweep', async () => {
    seedMatchingContacts(20)
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(memberRows()).toHaveLength(20)

    // Now nobody matches — a complete sweep would legitimately empty the
    // list. This sweep cannot complete, so it may not act on that.
    for (let index = 0; index < 20; index += 1) {
      store[`orgs/org-1/contacts/c${String(index).padStart(5, '0')}`]['tags'] = []
    }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
      scanBudget: 5,
    })
    expect(result.complete).toBe(false)
    expect(result.removed).toBe(0)
    expect(memberRows()).toHaveLength(20)
    // …and it does not overwrite the count with a figure it did not measure.
    expect(store[LIST]['memberCount']).toBe(20)
  })

  it('hands back a cursor that resumes rather than restarts', async () => {
    seedMatchingContacts(20)
    const first = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
      scanBudget: 5,
    })
    expect(first.complete).toBe(false)
    expect(first.cursor).toMatchObject({ source: 'contacts' })
    const second = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
      resume: first.cursor,
    })
    expect(second.complete).toBe(true)
    // The resumed run saw only the remainder, so its own match count is the
    // remainder — the rows from both runs are what make the list whole.
    expect(memberRows()).toHaveLength(20)
  })
})

describe('a rule that selects nobody says so', () => {
  it('reports an empty rule rather than materializing an empty list', async () => {
    store[`${LIST}/members/manual-1`] = { email: 'hand@example.com', via: 'manual' }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: [] },
    })
    expect(result.empty).toBe(true)
    // And it touches nothing: an unrunnable rule is not a licence to empty
    // the collection.
    expect(memberRows()).toHaveLength(1)
  })

  it('narrows to nothing when the referenced segment was deleted', async () => {
    seedMatchingContacts(2)
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], segmentId: 'gone' },
    })
    // Not "matches everybody": a rule whose filter vanished must not start
    // selecting the whole org.
    expect(result.empty).toBe(true)
    expect(memberRows()).toHaveLength(0)
  })
})

describe('the rule can draw from silos other than contacts', () => {
  it('answers "everyone who submitted form X"', async () => {
    store['hosts/host-1/formSubmissions/s1'] = {
      formName: 'Contact us',
      fields: { email: 'asker@example.com', name: 'Ada' },
    }
    store['hosts/host-1/formSubmissions/s2'] = {
      formName: 'Newsletter',
      fields: { email: 'other@example.com' },
    }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['formSubmissions'], formNames: ['Contact us'] },
    })
    expect(result.matched).toBe(1)
    expect(memberEmails()).toEqual(['asker@example.com'])
  })

  it('answers "site members created after Z", and dedupes across silos', async () => {
    const now = Date.now()
    store['hosts/host-1/siteMembers/m1'] = {
      email: 'new@example.com',
      displayName: 'Nia',
      createdAt: now - 86_400_000,
    }
    store['hosts/host-1/siteMembers/m2'] = {
      email: 'old@example.com',
      createdAt: now - 400 * 86_400_000,
    }
    // The same person also holds a matching contact — one list row, not two.
    store['orgs/org-1/contacts/c1'] = {
      email: 'NEW@example.com',
      tags: ['vip'],
    }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: {
        sources: ['siteMembers', 'contacts'],
        tags: ['vip'],
        createdAfterMs: now - 30 * 86_400_000,
      },
      nowMs: now,
    })
    expect(result.matched).toBe(1)
    expect(memberEmails()).toEqual(['new@example.com'])
  })
})
