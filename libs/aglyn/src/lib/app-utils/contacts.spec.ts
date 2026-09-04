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

import {
  contactDisplayName,
  interactionsForGroup,
  planContactDetach,
  readContactFacet,
  contactMatchesSegment,
  CONTACT_INTERACTIONS_CAP,
  extractEmailFromFields,
  mergeContactInteraction,
  normalizeContactEmail,
} from './contacts'

describe('contacts (AGL-197)', () => {
  it('normalizes emails and rejects junk', () => {
    expect(normalizeContactEmail('  Jane@Example.COM ')).toBe(
      'jane@example.com',
    )
    expect(normalizeContactEmail('not-an-email')).toBeNull()
    expect(normalizeContactEmail('')).toBeNull()
    expect(normalizeContactEmail(undefined)).toBeNull()
    expect(normalizeContactEmail('a b@c.com')).toBeNull()
  })

  it('extracts emails from free-form fields, preferring email-ish keys', () => {
    expect(
      extractEmailFromFields({
        message: 'reach me at home',
        workEmail: 'Work@Co.com',
        reply: 'other@x.com',
      }),
    ).toBe('work@co.com')
    expect(extractEmailFromFields({ note: 'x', addr: 'p@q.org' })).toBe(
      'p@q.org',
    )
    expect(extractEmailFromFields({ note: 'nothing here' })).toBeNull()
    expect(extractEmailFromFields(undefined)).toBeNull()
  })

  it('merges interactions newest-first, capped, keeping existing names', () => {
    const existing = {
      name: 'Jane',
      sources: { form: true as const },
      interactions: Array.from({ length: CONTACT_INTERACTIONS_CAP }, (_, i) => ({
        type: 'form' as const,
        atMs: i,
      })),
    }
    const merged = mergeContactInteraction(existing, {
      source: 'order',
      name: 'J. Doe',
      interaction: { type: 'order', atMs: 999999 },
    })
    expect(merged.name).toBe('Jane')
    expect(merged.sources).toEqual({ form: true, order: true })
    expect(merged.interactions).toHaveLength(CONTACT_INTERACTIONS_CAP)
    expect(merged.interactions[0]).toEqual({ type: 'order', atMs: 999999 })
  })

  it('fills a missing name from the update', () => {
    const merged = mergeContactInteraction(
      { sources: {}, interactions: [] },
      {
        source: 'member',
        name: 'New Name',
        interaction: { type: 'member', atMs: 1 },
      },
    )
    expect(merged.name).toBe('New Name')
  })

  it('matches segments: AND across kinds, OR within one', () => {
    const contact = { tags: ['VIP', 'beta'], sources: { form: true as const } }
    expect(contactMatchesSegment(contact, {})).toBe(true)
    expect(contactMatchesSegment(contact, { tags: ['vip'] })).toBe(true)
    expect(contactMatchesSegment(contact, { tags: ['other'] })).toBe(false)
    expect(contactMatchesSegment(contact, { sources: ['form', 'order'] })).toBe(
      true,
    )
    expect(contactMatchesSegment(contact, { sources: ['order'] })).toBe(false)
    expect(
      contactMatchesSegment(contact, { tags: ['vip'], sources: ['order'] }),
    ).toBe(false)
  })
})

/**
 * ONE DOCUMENT, PER-HOLDER FACETS.
 *
 * A human who touched two sites is one row — that is the dedupe the shared
 * address book exists for, and it is why the org is billed once for them
 * rather than once per site. Almost nothing ON that row is shared: a note, a
 * tag, a call log and a lifetime value are the holder's own business records,
 * and while they lived at the top of the document every site in an agency's
 * account could read every client's.
 */
describe('a contact document is shared and its records are not', () => {
  const A = { groupId: 'group-a', hostIds: ['site-a'] }
  const B = { groupId: 'group-b', hostIds: ['site-b'] }
  const shared = {
    email: 'both@example.test',
    name: 'Robin',
    visibleTo: ['host:site-a', 'host:site-b'],
    facets: {
      'group-a': {
        sources: { form: true },
        interactions: [{ type: 'form', atMs: 1, hostId: 'site-a' }],
        tags: ['vip'],
        notes: 'Called about the leak.',
        ltvCents: 5_000,
      },
      'group-b': {
        sources: { booking: true },
        interactions: [{ type: 'booking', atMs: 2, hostId: 'site-b' }],
        tags: ['walk-in'],
        notes: 'Prefers mornings.',
        ltvCents: 900,
      },
    },
  }

  it('hands each holder only its own records', () => {
    expect(readContactFacet(shared, 'group-a')).toMatchObject({
      tags: ['vip'],
      notes: 'Called about the leak.',
      ltvCents: 5_000,
    })
    expect(readContactFacet(shared, 'group-b')).toMatchObject({
      tags: ['walk-in'],
      notes: 'Prefers mornings.',
      ltvCents: 900,
    })
  })

  /** The leak, stated. Neither holder's notes appear in the other's facet. */
  it('never leaks one holder’s notes into another’s', () => {
    expect(JSON.stringify(readContactFacet(shared, 'group-a'))).not.toContain(
      'Prefers mornings',
    )
    expect(JSON.stringify(readContactFacet(shared, 'group-b'))).not.toContain(
      'Called about the leak',
    )
  })

  /**
   * An absent facet reads EMPTY, never falling back to the top of the
   * document — a fallback would hand every holder the pre-facet fields,
   * which is the disclosure the shape exists to end.
   */
  it('reads an absent facet as empty rather than falling back', () => {
    const legacy = { email: 'x@y.test', tags: ['top-level'], notes: 'old' }
    expect(readContactFacet(legacy, 'group-a')).toEqual({
      sources: {},
      interactions: [],
    })
    for (const broken of [null, 'facet', 42, ['a']]) {
      expect(readContactFacet({ facets: broken }, 'group-a')).toEqual({
        sources: {},
        interactions: [],
      })
    }
  })

  /**
   * The canonical name is shared and mutable, so without an override one
   * business renaming a person changes what an unrelated business sees.
   */
  it('lets each holder keep its own display name over the shared one', () => {
    const named = {
      ...shared,
      facets: {
        ...shared.facets,
        'group-a': { ...shared.facets['group-a'], name: 'R. Fields' },
      },
    }
    expect(contactDisplayName(named, 'group-a')).toBe('R. Fields')
    // The other holder is untouched and falls back to the shared identity.
    expect(contactDisplayName(named, 'group-b')).toBe('Robin')
    expect(contactDisplayName(named, 'group-c')).toBe('Robin')
  })

  it('splits the timeline by the site each visit happened on', () => {
    const timeline = [
      { type: 'form' as const, atMs: 1, hostId: 'site-a' },
      { type: 'booking' as const, atMs: 2, hostId: 'site-b' },
      // No host: predates the attribution, so it stays visible to everyone
      // rather than vanishing from every existing timeline.
      { type: 'order' as const, atMs: 3 },
    ]
    expect(interactionsForGroup(timeline, ['site-a']).map((i) => i.atMs)).toEqual(
      [1, 3],
    )
    expect(interactionsForGroup(timeline, ['site-b']).map((i) => i.atMs)).toEqual(
      [2, 3],
    )
    // A business declaring both sites as one sender sees both.
    expect(
      interactionsForGroup(timeline, ['site-a', 'site-b']).map((i) => i.atMs),
    ).toEqual([1, 2, 3])
  })
})

/**
 * DELETE IS A DETACH; ERASURE IS NOT.
 *
 * One holder removing a contact must not destroy another holder's
 * relationship with that person. The document dies when the LAST holder lets
 * go, which is reference counting — and a lawful erasure must never be routed
 * through that counting, or it becomes a partial erasure that reports success.
 */
describe('letting go of a shared contact', () => {
  const A = { groupId: 'group-a', hostIds: ['site-a'] }
  const B = { groupId: 'group-b', hostIds: ['site-b'] }

  it('detaches one holder while another still holds the person', () => {
    const plan = planContactDetach(
      { visibleTo: ['host:site-a', 'host:site-b'] },
      A,
    )
    expect(plan.action).toBe('detach')
    if (plan.action !== 'detach') throw new Error('unreachable')
    expect(plan.remove).toContain('facets.group-a')
    expect(plan.remove).toContain('marketingConsentByHost.site-a')
    expect(plan.removeTokens).toEqual(['host:site-a'])
    expect(plan.removeHostIds).toEqual(['site-a'])
    // ⛔ And nothing belonging to the other holder is touched.
    expect(plan.remove).not.toContain('facets.group-b')
    expect(plan.remove).not.toContain('marketingConsentByHost.site-b')
    expect(plan.removeTokens).not.toContain('host:site-b')
  })

  /** The last holder, which is the only case that destroys the row. */
  it('deletes the document once nobody else holds it', () => {
    expect(planContactDetach({ visibleTo: ['host:site-a'] }, A)).toEqual({
      action: 'delete',
    })
    expect(planContactDetach({ visibleTo: [] }, A)).toEqual({ action: 'delete' })
    expect(planContactDetach(null, A)).toEqual({ action: 'delete' })
  })

  /**
   * ANTI-VACUITY. The pair above would both pass against a planner that
   * always detached, or always deleted. This drives the SAME document from
   * both holders and requires the second one to be the delete.
   */
  it('deletes only after the second holder has also let go', () => {
    const held = { visibleTo: ['host:site-a', 'host:site-b'] }
    expect(planContactDetach(held, A).action).toBe('detach')
    expect(planContactDetach({ visibleTo: ['host:site-b'] }, B).action).toBe(
      'delete',
    )
  })

  /**
   * An org-wide row is held by every site in the account, so one site letting
   * go leaves it held. Narrowing it here would be a scope decision, and a
   * delete button is not where that belongs.
   */
  it('does not destroy an org-wide row on one site’s delete', () => {
    expect(planContactDetach({ visibleTo: ['org'] }, A).action).toBe('detach')
  })

  /** A declared group lets go of every site it covers, in one act. */
  it('detaches every site a group covers', () => {
    const plan = planContactDetach(
      { visibleTo: ['host:site-a', 'host:site-b', 'host:site-c'] },
      { groupId: 'nw', hostIds: ['site-a', 'site-b'] },
    )
    if (plan.action !== 'detach') throw new Error('unreachable')
    expect(plan.removeTokens.sort()).toEqual(['host:site-a', 'host:site-b'])
    expect(plan.remove).toContain('marketingConsentByHost.site-a')
    expect(plan.remove).toContain('marketingConsentByHost.site-b')
  })

  /**
   * The counting reads `visibleTo`, which is what both enforcement layers
   * evaluate — not the facet map. A holder who can still READ the row is
   * holding it whether or not they ever wrote a note, and counting facets
   * would leave them able to see a document nothing believes they hold.
   */
  it('counts holders by what can still read the row', () => {
    const noFacets = { visibleTo: ['host:site-a', 'host:site-b'], facets: {} }
    expect(planContactDetach(noFacets, A).action).toBe('detach')
  })
})
