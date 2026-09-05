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
 * `upsertHostContact`'s RFM branch for an EXISTING contact.
 *
 * The defect this pins was found empirically by the AGL-1753 backfill dry
 * run: the production e2e contact carried `ltvCents` and `lastPurchaseAtMs`
 * but NO `firstPurchaseAtMs`, because only the CREATE path ever wrote it. A
 * lead captured by a form who later buys is exactly the customer RFM is
 * for, and their recency anchor was permanently absent.
 */

import { upsertHostContact } from './upsert-contact'

// The revenue join is a different question, proved in
// `upsert-contact-attribution.spec.ts`. Stubbed here so this file's fake
// firestore — which models the contacts collection and nothing else — is not
// asked for a person document it has no notion of.
jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: async () => null,
}))

// Faithful increment semantics: the fake applies `{ __inc }` the way the
// Admin SDK applies `FieldValue.increment` — add to the stored number, or
// start from the operand when the field is absent. An unfaithful fake here
// would hide exactly the compounding the AGL-1745/1752 issues warn about.
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
/**
 * The org's stored sharing default. Undefined is the shipped one — a new
 * contact is scoped to the capturing group — and `'org'` is the deliberate
 * widening an org running one brand across several sites may choose.
 */
let mockOrgDefaultScope: 'org' | 'host' | undefined
let added: Record<string, any>[] = []

/**
 * Applies a merge-set the way Firestore does: given keys only, increments
 * applied, and NESTED MAPS MERGED rather than replaced.
 *
 * The recursion is load-bearing. The per-holder facets and the per-host
 * consent entries are both maps written one key at a time, and a shallow fake
 * would let a write that erases every other holder's notes, order history and
 * consent pass here and erase them in production.
 */
function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('__serverTimestamp' in value) &&
      !('__arrayUnion' in value)
    ) {
      target[key] = { ...(target[key] ?? {}) }
      mergeApply(target[key], value)
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(target[key]) ? target[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      target[key] = current
    } else {
      target[key] = value
    }
  }
}

const contactsRef = {
  where: (field: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(contacts).filter(
          ([, data]) => data[field] === wanted,
        )
        return {
          empty: hits.length === 0,
          docs: hits.map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            // A real snapshot answers both; the facet read takes the whole
            // document because one parser covers every holder.
            data: () => data,
            ref: {
              set: async (
                payload: Record<string, any>,
                options?: { merge?: boolean },
              ) => {
                if (!options?.merge) throw new Error('expected merge set')
                mergeApply(data, payload)
              },
            },
          })),
        }
      },
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(contacts).length }) }),
  }),
  add: async (data: Record<string, any>) => {
    added.push(data)
    return { id: `auto-${added.length}` }
  },
}

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: async () => undefined }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  // The real resolution, which for an org that declared nothing is the
  // group of one — the shape every case in this file exercises.
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  getOrgForHost: async () => ({
    orgId: 'org1',
    org: { plan: 'starter', defaultResourceScope: mockOrgDefaultScope },
  }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => {
  // The pure contact helpers are the real ones — a reimplementation here
  // would be the unfaithful-double trap (normalization or the interaction
  // cap drifting from production without a red).
  const contactsModule = jest.requireActual(
    '../../../../../../aglyn/src/lib/app-utils/contacts',
  )
  return {
    ...contactsModule,
    // The real consent and scope helpers. Reimplementing them here is the
    // unfaithful-double trap: a fake that wrote a basis at the top of the
    // document, or scoped a new contact org-wide, would pass this file while
    // shipping the leak.
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
    // The real campaign coercion, for the same reason: a fake that skipped
    // the dedupe or the cap would let this file pass while the writer grew a
    // membership array no reader is allowed to render.
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/campaign-membership'),
    ORG_SCOPE_TOKEN: 'org',
    checkContactQuota: () => ({ allowed: true }),
  }
})

/**
 * The commercial figures are the HOLDER's, not the org's.
 *
 * Two unrelated merchants who both sell to one person have two different
 * lifetime values and neither is entitled to the other's, so these live in
 * the capturing group's facet rather than at the top of the shared row.
 * `facet()` is how every assertion below reads them.
 */
const facet = (id: string, groupId = 'h1') =>
  contacts[id]?.facets?.[groupId] ?? {}

describe('upsertHostContact RFM fields on an existing contact', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
  })

  it('sets firstPurchaseAtMs when a pre-existing contact makes their FIRST purchase', async () => {
    // A lead captured by a form: contact exists, has never bought.
    contacts['c1'] = { email: 'lead@example.com', sources: { form: true }, interactions: [] }
    await upsertHostContact({
      hostId: 'h1',
      email: 'Lead@Example.com',
      source: 'order',
      purchaseCents: 1800,
      interaction: { refId: 'o1', summary: 'Placed an order' },
    })
    expect(facet('c1').ltvCents).toBe(1800)
    expect(facet('c1').ordersCount).toBe(1)
    expect(facet('c1').lastPurchaseAtMs).toEqual(expect.any(Number))
    // The red before the fix: this field stayed absent forever.
    expect(facet('c1').firstPurchaseAtMs).toEqual(expect.any(Number))
    // And a sister brand sees none of it — a lifetime value is the holder's
    // own business record, not the account's.
    expect(facet('c1', 'h2')).toEqual({})
  })

  it('never moves firstPurchaseAtMs on a later purchase', async () => {
    contacts['c1'] = {
      email: 'buyer@example.com',
      sources: { order: true },
      interactions: [],
      facets: {
        h1: {
          sources: { order: true },
          interactions: [],
          ltvCents: 1000,
          ordersCount: 1,
          firstPurchaseAtMs: 111,
          lastPurchaseAtMs: 111,
        },
      },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'buyer@example.com',
      source: 'order',
      purchaseCents: 2500,
      interaction: { refId: 'o2', summary: 'Placed an order' },
    })
    expect(facet('c1').firstPurchaseAtMs).toBe(111) // anchored
    expect(facet('c1').ltvCents).toBe(3500) // increment applied for real
    expect(facet('c1').ordersCount).toBe(2)
    expect(facet('c1').lastPurchaseAtMs).toBeGreaterThan(111)
  })

  it('leaves every RFM field untouched when there is no purchase', async () => {
    contacts['c1'] = { email: 'lead@example.com', sources: { form: true }, interactions: [] }
    await upsertHostContact({
      hostId: 'h1',
      email: 'lead@example.com',
      source: 'form',
      interaction: { refId: 'f1', summary: 'Submitted a form' },
    })
    expect(facet('c1').ltvCents).toBeUndefined()
    expect(facet('c1').firstPurchaseAtMs).toBeUndefined()
    expect(facet('c1').lastPurchaseAtMs).toBeUndefined()
  })
})

/**
 * A NEW CONTACT IS SCOPED TO THE CAPTURING GROUP, NOT TO THE ORG.
 *
 * Stamping `['org']` here made every contact readable by every site in the
 * account on the day it was created, so an agency's twelve clients shared one
 * address book by default. Closing the missing-field fail-open would not have
 * touched it: the field was present and said so.
 */
describe('the scope a captured contact starts with', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    mockOrgDefaultScope = undefined
  })

  it('scopes a new contact to the capturing site and no wider', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
    })
    expect(added).toHaveLength(1)
    expect(added[0].visibleTo).toEqual(['host:h1'])
    // ⛔ And not the token that would make it everybody's.
    expect(added[0].visibleTo).not.toContain('org')
  })

  /**
   * ATTRIBUTION GROWS ON THE MERGE BRANCH. A person the first site captured
   * and the second site later met read as the first site's alone forever,
   * because the create-only `hostId` beside this was never rewritten — so
   * "everyone captured on B" missed everybody B met second.
   */
  it('adds a second site to the attribution when it meets the same person', async () => {
    contacts['c1'] = {
      email: 'both@example.com',
      capturedByHostIds: ['h1'],
      facets: { h1: { sources: { form: true }, interactions: [] } },
    }
    await upsertHostContact({
      hostId: 'h2',
      email: 'both@example.com',
      source: 'booking',
      interaction: { refId: 'b1' },
    })
    expect(contacts['c1'].capturedByHostIds).toEqual(
      expect.arrayContaining(['h1', 'h2']),
    )
    // And the second site can now SEE the row it just captured — widened by
    // the capture, never by the lookup that found the person.
    expect(contacts['c1'].visibleTo).toEqual(
      expect.arrayContaining(['host:h2']),
    )
    // ⛔ Still one document: the dedupe is the point.
    expect(added).toHaveLength(0)
  })

  it('records the capturing site as a queryable attribution', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
    })
    // An ARRAY, because "everyone captured on A, B or C" is an audience and
    // `array-contains-any` is what answers it.
    expect(added[0].capturedByHostIds).toEqual(['h1'])
  })

  /**
   * ANTI-VACUITY. The org may still widen deliberately — visibility and
   * consent are separate axes, and an org running one brand across three
   * sites may reasonably want one address book. What changed is that it is
   * an ACT rather than the default.
   */
  it('still honors an org that has chosen org-wide sharing', async () => {
    mockOrgDefaultScope = 'org'
    await upsertHostContact({
      hostId: 'h1',
      email: 'wide@example.com',
      source: 'form',
      interaction: { refId: 'f2' },
    })
    expect(added[0].visibleTo).toEqual(['org'])
  })
})

/*==========================================
 * THE CAMPAIGNS A CAPTURE FILES SOMEBODY UNDER.
 *
 * A contact row is shared by every site in the org, and which campaigns a
 * merchant filed somebody under is that merchant's business record on the same
 * footing as their notes and their tags. So it goes inside the capturing
 * group's facet, it ACCUMULATES rather than replaces, and it grants nothing.
 *=========================================*/

describe('a capture files the person under the surface’s campaigns', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    mockOrgDefaultScope = undefined
  })

  it('writes the membership into the capturing group’s facet on a create', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
      campaignIds: ['camp_spring'],
    })
    expect(added[0].facets.h1.campaignIds).toEqual(['camp_spring'])
    // ⛔ And nowhere else. At the top of the document it would be readable by
    // every other site in an agency's account.
    expect(added[0]).not.toHaveProperty('campaignIds')
  })

  /**
   * ADDED TO, never replaced. A person who filled in the spring form and
   * later the summer one is in both pushes; a write that replaced would take
   * a campaign the merchant filed them under back out with nothing on screen
   * to say so — which is why the field is an array and every writer unions.
   */
  it('adds to an existing filing rather than replacing it', async () => {
    contacts['c1'] = {
      email: 'both@example.com',
      facets: {
        h1: {
          sources: { form: true },
          interactions: [],
          campaignIds: ['camp_spring'],
        },
      },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'both@example.com',
      source: 'form',
      interaction: { refId: 'f2' },
      campaignIds: ['camp_summer'],
    })
    expect(facet('c1').campaignIds).toEqual(['camp_spring', 'camp_summer'])
  })

  /**
   * ⛔ ONE HOLDER'S FACET, and not a top-level key with dots in its name.
   *
   * This is a merge-`set`, and a `set` treats a dotted string as a literal
   * field NAME — only `update()` reads dots as a path. A writer that reached
   * for the dotted path here would mint `facets.h1.campaignIds` at the top of
   * a shared document, where it is both unreadable by the facet parser and
   * visible to every other site in the org.
   */
  it('leaves another holder’s facet untouched', async () => {
    contacts['c1'] = {
      email: 'shared@example.com',
      facets: {
        h1: { sources: { form: true }, interactions: [] },
        h2: {
          sources: { booking: true },
          interactions: [],
          campaignIds: ['camp_theirs'],
        },
      },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'shared@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
      campaignIds: ['camp_ours'],
    })
    expect(facet('c1', 'h1').campaignIds).toEqual(['camp_ours'])
    expect(facet('c1', 'h2').campaignIds).toEqual(['camp_theirs'])
    // The LITERAL key, checked against the key list rather than with
    // `toHaveProperty`, which reads a dotted string as a path and would
    // resolve the nested value this assertion exists to distinguish from.
    expect(Object.keys(contacts['c1'])).not.toContain('facets.h1.campaignIds')
  })

  it('writes no key at all for a capture in no campaign', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'plain@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
    })
    expect(added[0].facets.h1).not.toHaveProperty('campaignIds')
  })

  /**
   * ⛔ MEMBERSHIP IS NOT CONSENT. Filing a form under a campaign is the
   * merchant's own act and says nothing about what the person agreed to; only
   * `marketingConsent` records a basis.
   */
  it('records no marketing basis from a campaign', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'filed@example.com',
      source: 'form',
      interaction: { refId: 'f1' },
      campaignIds: ['camp_spring'],
    })
    expect(added[0]).not.toHaveProperty('marketingConsent')
    expect(added[0]).not.toHaveProperty('marketingConsentByHost')
  })
})

/*==========================================
 * THE ENTRY POINT: which form, and which page.
 *
 * `sources` says only that SOME form produced this contact — every form on a
 * site sets the same flag — so the interaction the capture already writes is
 * where the specific door is recorded.
 *=========================================*/

describe('an interaction records the door the person came in through', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    mockOrgDefaultScope = undefined
  })

  it('keeps the form and the page on the interaction it belongs to', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'form',
      interaction: { refId: 's1', formId: 'f1', path: '/spring-offer' },
    })
    expect(added[0].facets.h1.interactions[0]).toMatchObject({
      type: 'form',
      refId: 's1',
      formId: 'f1',
      path: '/spring-offer',
      hostId: 'h1',
    })
  })

  /**
   * Per interaction rather than per contact. Somebody who came in through the
   * pricing page and returned through a blog post has two entry points and
   * one row; a single field at the top would keep whichever wrote last.
   */
  it('keeps a second visit’s door beside the first, not over it', async () => {
    contacts['c1'] = {
      email: 'twice@example.com',
      facets: {
        h1: {
          sources: { form: true },
          interactions: [
            { type: 'form', atMs: 1, refId: 's1', formId: 'f1', path: '/one' },
          ],
        },
      },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'twice@example.com',
      source: 'form',
      interaction: { refId: 's2', formId: 'f2', path: '/two' },
    })
    expect(
      facet('c1').interactions.map(
        (entry: Record<string, unknown>) => entry['path'],
      ),
    ).toEqual(['/two', '/one'])
  })

  it('writes no key for a door that knows neither', async () => {
    // Firestore rejects `undefined` inside an array element outright, so an
    // absent entry point has to be an absent field rather than a written one.
    await upsertHostContact({
      hostId: 'h1',
      email: 'plain@example.com',
      source: 'booking',
      interaction: { refId: 'b1' },
    })
    const [entry] = added[0].facets.h1.interactions
    expect(entry).not.toHaveProperty('formId')
    expect(entry).not.toHaveProperty('path')
  })
})

/**
 * The create hook (AGL-2605): the one fact a capture door cannot learn any
 * other way — that its capture made a NEW person, and which document — so
 * the runtime can announce `contactCreated`. A merge is a repeat visit and
 * is never reported; a hook that throws costs nothing the capture already
 * did.
 */
describe('upsertHostContact onCreated', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    mockOrgDefaultScope = undefined
  })

  it('reports a NEW contact once, with its id, address, source and campaigns', async () => {
    const reported: unknown[] = []
    await upsertHostContact({
      hostId: 'h1',
      email: 'New@Example.com',
      name: 'Ada Lovelace',
      source: 'form',
      interaction: { refId: 's1', summary: 'Submitted "Contact"' },
      campaignIds: ['spring-2026', 'spring-2026', ' '],
      onCreated: (created) => {
        reported.push(created)
      },
    })
    expect(added).toHaveLength(1)
    expect(reported).toEqual([
      {
        contactId: 'auto-1',
        hostId: 'h1',
        // Normalized, so a filter on the address matches what the row holds.
        email: 'new@example.com',
        name: 'Ada Lovelace',
        source: 'form',
        // Deduped and trimmed by the same coercion the document stores.
        campaignIds: ['spring-2026'],
      },
    ])
  })

  it('says nothing on a merge — a repeat visit is not a new contact', async () => {
    contacts['c1'] = { email: 'held@example.com', sources: { form: true }, interactions: [] }
    const onCreated = jest.fn()
    await upsertHostContact({
      hostId: 'h1',
      email: 'held@example.com',
      source: 'booking',
      interaction: { refId: 'b1', summary: 'Booked' },
      onCreated,
    })
    expect(added).toHaveLength(0)
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('survives a hook that throws, and the contact is still created', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        upsertHostContact({
          hostId: 'h1',
          email: 'hook@example.com',
          source: 'form',
          interaction: { refId: 's2' },
          onCreated: async () => {
            throw new Error('emit failed')
          },
        }),
      ).resolves.toEqual({ contactId: expect.any(String), created: true })
      expect(added).toHaveLength(1)
      // Its own catch, so the failure is named as the hook's — not as the
      // capture's, which succeeded.
      expect(errors).toHaveBeenCalledWith(
        'upsertHostContact onCreated failed',
        expect.any(Error),
      )
    } finally {
      errors.mockRestore()
    }
  })
})
