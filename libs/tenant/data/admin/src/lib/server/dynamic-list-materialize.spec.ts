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

/** Every `consentGroupForSite` call the sweep made — a rule's opt-in org read. */
let groupLookups: string[] = []
/** The group this site's contacts were captured under, for the facet reads. */
const GROUP_ID = 'group-acme'

jest.mock('./organizations', () => ({
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    firestore.collection(`orgs/org-1/${name}`),
  // Identity: what `scopedToHost` narrows is asserted by its own suite, and a
  // fake filter here would only assert the fake.
  scopedToHost: (ref: unknown) => ref,
  // A DECLARED group rather than the solo one, so a facet read keyed by the
  // host id instead of the group id fails here rather than passing by
  // coincidence — the two are the same string for an undeclared site.
  consentGroupForSite: async (hostId: string) => {
    groupLookups.push(hostId)
    return {
      hostId,
      groupId: GROUP_ID,
      name: 'Acme',
      hostIds: [hostId],
      declared: true,
    }
  },
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
  groupLookups = []
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

/*==========================================
 * AN AUDIENCE BUILT FROM A CAMPAIGN.
 *
 * The merchant filed forms under a campaign; the submissions carry the filing
 * they arrived with and the contacts carry it inside the capturing holder's
 * facet. The scan reads both off documents it has already paged — no query, no
 * index, nothing that can drop a document for missing a field.
 *
 * The assertion that matters most here is the LAST one: a campaign is not a
 * consent basis, and a dimension that could select a whole contact list must
 * not be a way to stamp one.
 *=========================================*/

const SPRING = 'camp_spring'

describe('a campaign is an audience', () => {
  /** A contact filed under `campaigns`, inside the capturing group's facet. */
  function seedFiledContact(
    id: string,
    email: string,
    campaigns: string[],
  ) {
    store[`orgs/org-1/contacts/${id}`] = {
      email,
      facets: { [GROUP_ID]: { sources: { form: true }, campaignIds: campaigns } },
    }
  }

  it('enrolls the contacts one holder filed under the campaign', async () => {
    seedFiledContact('c1', 'filed@example.com', [SPRING])
    seedFiledContact('c2', 'elsewhere@example.com', ['camp_summer'])
    seedFiledContact('c3', 'unfiled@example.com', [])
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], campaignIds: [SPRING] },
    })
    expect(result.matched).toBe(1)
    expect(memberEmails()).toEqual(['filed@example.com'])
  })

  /**
   * ⛔ THE FACET IS THE HOLDER'S OWN RECORD.
   *
   * A contact row is shared by every site in the org, and which campaigns a
   * merchant filed somebody under is that merchant's business record on the
   * same footing as their notes. A read that fell back to the top of the
   * document, or reached another group's facet, would build one agency
   * client's audience out of another client's segmentation.
   */
  it('reads no other holder’s filing, and no top-level field', async () => {
    store['orgs/org-1/contacts/c1'] = {
      email: 'someone-elses@example.com',
      campaignIds: [SPRING],
      facets: { 'group-other': { campaignIds: [SPRING] } },
    }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], campaignIds: [SPRING] },
    })
    expect(result.matched).toBe(0)
    expect(memberRows()).toHaveLength(0)
  })

  it('enrolls the people who came in through the campaign’s forms', async () => {
    store['hosts/host-1/formSubmissions/s1'] = {
      formName: 'Spring signup',
      campaignIds: [SPRING],
      fields: { email: 'asker@example.com', name: 'Ada' },
    }
    store['hosts/host-1/formSubmissions/s2'] = {
      formName: 'Support',
      fields: { email: 'other@example.com' },
    }
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['formSubmissions'], campaignIds: [SPRING] },
    })
    expect(memberEmails()).toEqual(['asker@example.com'])
    expect(result.matched).toBe(1)
  })

  /**
   * A lead carries no campaign at all, so the dimension is SKIPPED for that
   * silo rather than failed. A rule of "the spring push, and every lead" that
   * contributed no leads would be the silently-shrinking source this rule
   * language exists to prevent.
   */
  it('still contributes the silos that carry no campaign', async () => {
    seedFiledContact('c1', 'filed@example.com', [SPRING])
    store['hosts/host-1/leads/l1'] = { email: 'lead@example.com' }
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts', 'leads'], campaignIds: [SPRING] },
    })
    expect(memberEmails()).toEqual(['filed@example.com', 'lead@example.com'])
  })

  /**
   * The group lookup is an org read, and it is charged only to the rules that
   * ask for it — the same opt-in shape the engagement and list lookups take.
   */
  it('resolves the holder once per sweep, and not at all without a campaign', async () => {
    seedFiledContact('c1', 'filed@example.com', [SPRING])
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], campaignIds: [SPRING] },
    })
    expect(groupLookups).toEqual(['host-1'])

    groupLookups = []
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
    })
    expect(groupLookups).toEqual([])
  })

  /**
   * ⛔ MEMBERSHIP IN A CAMPAIGN IS NOT CONSENT.
   *
   * The reason the materializer passes no basis at all: a rule that stamped
   * one would let any merchant manufacture consent for their whole contact
   * list by writing a rule that selects it. A campaign dimension is the most
   * tempting version of exactly that — the people it selects were filed under
   * a marketing push — so the guarantee is asserted against this dimension
   * specifically and not only against the tag rule above.
   */
  it('writes no consent basis onto a row a campaign selected', async () => {
    seedFiledContact('c1', 'filed@example.com', [SPRING])
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], campaignIds: [SPRING] },
    })
    const [row] = memberRows()
    expect(store[row]).not.toHaveProperty('marketingConsent')
    expect(store[row]).not.toHaveProperty('marketingConsentAtMs')
    expect(store[row]['via']).toBe('rule')
  })
})

/*==========================================
 * ENRICHMENT — the dimensions the scan cannot read off a silo row.
 *
 * Engagement and other-audience membership describe an ADDRESS, so they come
 * from keyed lookups rather than from the document the sweep just paged. The
 * assertions here are about the two things that could break the sweep: those
 * reads must be charged to the SAME budget, and the cursor must still resume
 * where it stopped.
 *=========================================*/

/** The person rollup document, at the key the delivery log writes it under. */
function seedEngagement(email: string, engagement: Record<string, number>) {
  store[`emailDeliveries/${personKey(email)}`] = engagement
}

describe('an engagement rule reads the per-person rollup', () => {
  const OPENED_30 = {
    sources: ['contacts'],
    engagement: { openedWithinDays: 30 },
  }
  const NOW = Date.UTC(2026, 7, 29)
  const DAY = 86_400_000

  beforeEach(() => {
    seedMatchingContacts(3)
    seedEngagement('person0@example.com', { lastOpenedAtMs: NOW - 5 * DAY })
    seedEngagement('person1@example.com', { lastOpenedAtMs: NOW - 90 * DAY })
    // person2 has no rollup at all — never opened anything.
  })

  it('enrolls the people who opened inside the window and nobody else', async () => {
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: OPENED_30,
      nowMs: NOW,
    })

    expect(result.matched).toBe(1)
    expect(memberEmails()).toEqual(['person0@example.com'])
  })

  it('selects the quiet ones, silence included, on the other arm', async () => {
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], engagement: { notOpenedForDays: 30 } },
      nowMs: NOW,
    })

    expect(memberEmails()).toEqual([
      'person1@example.com',
      'person2@example.com',
    ])
  })

  /**
   * ⚠️ The reads are CHARGED, which is what keeps the budget honest.
   *
   * Three contacts and three rollup lookups is six documents. A budget of
   * five must therefore stop the sweep — and if the lookups were free, this
   * run would sail through and the budget would be describing a different
   * amount of work than the one being done.
   */
  it('charges the lookups to the same scan budget', async () => {
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: OPENED_30,
      nowMs: NOW,
      scanBudget: 5,
    })

    expect(result.complete).toBe(false)
    expect(result.cursor).toMatchObject({ source: 'contacts' })
    // And an incomplete run still removes nobody and publishes no count.
    expect(result.removed).toBe(0)
    expect(store[LIST]['memberCount']).toBeUndefined()
  })

  it('resumes an engagement sweep from its cursor rather than restarting', async () => {
    const first = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: OPENED_30,
      nowMs: NOW,
      scanBudget: 5,
    })
    expect(first.complete).toBe(false)

    const second = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: OPENED_30,
      nowMs: NOW,
      resume: first.cursor,
    })
    expect(second.complete).toBe(true)
    // The resumed run saw only the remainder, and a resumed run may not
    // reconcile: everybody the first run enrolled is still here.
    expect(second.removed).toBe(0)
    expect(memberEmails()).toEqual(['person0@example.com'])
  })

  /*
   * A rule with no engagement clause must not pay for one. The budget is the
   * observable: six documents of work would stop at a budget of five, and
   * three would not.
   */
  it('spends nothing on a rule that asks for no engagement', async () => {
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: VIP_RULE,
      scanBudget: 5,
    })

    expect(result.complete).toBe(true)
    expect(memberRows()).toHaveLength(3)
  })
})

describe('a rule can exclude the members of another audience', () => {
  beforeEach(() => {
    seedMatchingContacts(3)
    store[`orgs/org-1/lists/customers/members/${personKey('person1@example.com')}`] =
      { email: 'person1@example.com' }
  })

  it('leaves out everyone already on the named audience', async () => {
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { ...VIP_RULE, notInListIds: ['customers'] },
    })

    expect(memberEmails()).toEqual([
      'person0@example.com',
      'person2@example.com',
    ])
  })

  it('keeps only the members of it on the positive arm', async () => {
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { ...VIP_RULE, inListIds: ['customers'] },
    })

    expect(memberEmails()).toEqual(['person1@example.com'])
  })

  /*
   * TWO named lists, which is what proves the lookups accumulate. Each list
   * is its own `getAll`, so a pass that replaced the membership it found
   * instead of appending to it would leave every candidate holding only the
   * last list — and every multi-list rule would then select nobody.
   */
  it('accumulates membership across every list the rule names', async () => {
    store[`orgs/org-1/lists/vips/members/${personKey('person1@example.com')}`] =
      { email: 'person1@example.com' }
    store[`orgs/org-1/lists/vips/members/${personKey('person2@example.com')}`] =
      { email: 'person2@example.com' }

    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { ...VIP_RULE, inListIds: ['customers', 'vips'] },
    })

    // Only person1 is on both.
    expect(memberEmails()).toEqual(['person1@example.com'])
  })

  /**
   * ⛔ THE OSCILLATION GUARD.
   *
   * A rule that referred to the audience it fills would flip its membership
   * on every beat: nobody is a member on the first sweep so everybody
   * matches, everybody is a member on the second so nobody does, and
   * reconciliation DELETES every row the first sweep created. Half of those
   * beats are deletions, which is the one thing a materializer may never do
   * for a reason that is not a membership change.
   */
  it('ignores a rule that names the audience it is filling', async () => {
    const rule = { ...VIP_RULE, notInListIds: ['list-1'] }
    const first = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule,
    })
    expect(first.enrolled).toBe(3)

    // The second sweep, with everybody now a member of `list-1` itself.
    const second = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule,
    })
    expect(second.removed).toBe(0)
    expect(memberRows()).toHaveLength(3)
  })

  it('selects nobody through an audience that no longer exists', async () => {
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { ...VIP_RULE, inListIds: ['deleted'] },
    })

    // Not "matches everybody": a membership filter whose audience vanished
    // must not start selecting the whole silo.
    expect(memberRows()).toHaveLength(0)
  })
})

/*==========================================
 * THE CRM DIMENSIONS COME OUT OF THE HOLDER'S FACET (AGL-2603).
 *
 * An owner, a lifecycle stage, a company and a custom field are one
 * business's knowledge of a person and live inside that business's facet on
 * the shared row, beside its notes. The sweep reads them under the sweeping
 * site's own group — the same read the campaign membership takes — so the
 * assertions here are the campaign block's, made against each new field:
 * the facet is read, another holder's is not, the top of the document is
 * not, and the org read that resolves the group is charged only to a rule
 * that asks for one of these.
 *=========================================*/
describe('a CRM field is an audience', () => {
  /** A contact with a CRM profile, inside the capturing group's facet. */
  function seedProfiledContact(
    id: string,
    email: string,
    facet: Record<string, unknown>,
  ) {
    store[`orgs/org-1/contacts/${id}`] = {
      email,
      facets: { [GROUP_ID]: { sources: { form: true }, ...facet } },
    }
  }

  it('enrolls the contacts one team member owns', async () => {
    seedProfiledContact('c1', 'mine@example.com', { ownerUid: 'uid-a' })
    seedProfiledContact('c2', 'theirs@example.com', { ownerUid: 'uid-b' })
    seedProfiledContact('c3', 'nobodys@example.com', {})
    const result = await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], ownerUids: ['uid-a'] },
    })
    expect(result.matched).toBe(1)
    expect(memberEmails()).toEqual(['mine@example.com'])
  })

  it('enrolls the contacts in a lifecycle stage', async () => {
    seedProfiledContact('c1', 'lead@example.com', { lifecycleStage: 'lead' })
    seedProfiledContact('c2', 'customer@example.com', {
      lifecycleStage: 'customer',
    })
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], lifecycleStages: ['customer'] },
    })
    expect(memberEmails()).toEqual(['customer@example.com'])
  })

  it('enrolls the contacts at a company', async () => {
    seedProfiledContact('c1', 'acme@example.com', { companyId: 'co-acme' })
    seedProfiledContact('c2', 'globex@example.com', { companyId: 'co-globex' })
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: { sources: ['contacts'], companyIds: ['co-acme'] },
    })
    expect(memberEmails()).toEqual(['acme@example.com'])
  })

  it('enrolls the contacts whose custom field satisfies the clause', async () => {
    seedProfiledContact('c1', 'enterprise@example.com', {
      custom: { plan: 'Enterprise', seats: 40 },
    })
    seedProfiledContact('c2', 'starter@example.com', {
      custom: { plan: 'starter', seats: 3 },
    })
    seedProfiledContact('c3', 'blank@example.com', {})
    await materializeDynamicList({
      listRef: listRef(),
      hostId: 'host-1',
      rule: {
        sources: ['contacts'],
        custom: [
          { key: 'plan', op: 'eq', value: 'enterprise' },
          { key: 'seats', op: 'gt', value: 10 },
        ],
      },
    })
    expect(memberEmails()).toEqual(['enterprise@example.com'])
  })

  /**
   * ⛔ THE FACET IS THE HOLDER'S OWN RECORD.
   *
   * A read that fell back to the top of the document, or reached another
   * group's facet, would build one agency client's audience out of another
   * client's CRM — who owns a person and where they sit in a funnel is a
   * business record on the same footing as the notes.
   */
  it('reads no other holder’s profile, and no top-level field', async () => {
    store['orgs/org-1/contacts/c1'] = {
      email: 'someone-elses@example.com',
      ownerUid: 'uid-a',
      lifecycleStage: 'customer',
      companyId: 'co-acme',
      custom: { plan: 'enterprise' },
      facets: {
        'group-other': {
          ownerUid: 'uid-a',
          lifecycleStage: 'customer',
          companyId: 'co-acme',
          custom: { plan: 'enterprise' },
        },
      },
    }
    for (const rule of [
      { sources: ['contacts'], ownerUids: ['uid-a'] },
      { sources: ['contacts'], lifecycleStages: ['customer'] },
      { sources: ['contacts'], companyIds: ['co-acme'] },
      { sources: ['contacts'], custom: [{ key: 'plan', op: 'eq', value: 'enterprise' }] },
    ]) {
      const result = await materializeDynamicList({
        listRef: listRef(),
        hostId: 'host-1',
        rule,
      })
      expect(result.matched).toBe(0)
    }
    expect(memberRows()).toHaveLength(0)
  })

  it('resolves the holder once per sweep, for any of the four', async () => {
    seedProfiledContact('c1', 'mine@example.com', { ownerUid: 'uid-a' })
    for (const clause of [
      { ownerUids: ['uid-a'] },
      { lifecycleStages: ['lead'] },
      { companyIds: ['co-acme'] },
      { custom: [{ key: 'plan', op: 'set' }] },
    ]) {
      groupLookups = []
      await materializeDynamicList({
        listRef: listRef(),
        hostId: 'host-1',
        rule: { sources: ['contacts'], ...clause },
      })
      expect(groupLookups).toEqual(['host-1'])
    }
  })
})
