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
  contactMergePreview,
  mergeContactFacet,
  mergeInteractions,
  planContactMerge,
} from './contact-merge'
import { CONTACT_INTERACTIONS_CAP } from './contacts'

/**
 * The merge rule (AGL-2625): survivor wins per field, empty fields fill,
 * lists union, figures add, a refusal stands. Each case names the one
 * clause it pins.
 */

const survivor = {
  email: 'jane@acme.com',
  name: 'Jane Doe',
  nameLower: 'jane doe',
  visibleTo: ['host:a'],
  capturedByHostIds: ['a'],
  formIds: ['f1'],
  companyIds: ['c1', 'shared'],
  tags: ['b2b'],
  marketingConsentByHost: { a: { marketingConsent: true, marketingConsentAtMs: 10 } },
  facets: {
    a: {
      sources: { form: true },
      interactions: [
        { type: 'form', atMs: 300, refId: 's1', hostId: 'a' },
        { type: 'form', atMs: 100, refId: 's0', hostId: 'a' },
      ],
      tags: ['vip'],
      notes: 'Met at the expo.',
      phone: '+15125550100',
      lifecycleStage: 'lead',
      ownerUid: 'u-1',
      ltvCents: 1000,
      ordersCount: 1,
      firstPurchaseAtMs: 200,
      lastPurchaseAtMs: 200,
      custom: { tier: 'gold', region: '' },
    },
  },
}

const merged = {
  email: 'jane@gmail.com',
  name: 'J. Doe',
  phone: '+15125550999',
  companyName: 'Acme',
  visibleTo: ['host:b'],
  capturedByHostIds: ['b'],
  formIds: ['f2'],
  companyIds: ['shared', 'c2'],
  tags: ['newsletter'],
  alternateEmails: ['jane.doe@example.org'],
  marketingConsent: false,
  marketingConsentByHost: {
    a: { marketingConsent: true, marketingConsentAtMs: 99 },
    b: { marketingConsent: true, marketingConsentAtMs: 20 },
  },
  facets: {
    a: {
      sources: { order: true },
      interactions: [
        { type: 'order', atMs: 400, refId: 'o1', hostId: 'a' },
        // The same event as the survivor's newest — one row after the merge.
        { type: 'form', atMs: 300, refId: 's1', hostId: 'a' },
      ],
      tags: ['vip', 'wholesale'],
      notes: 'Prefers email.',
      phone: '+15125550999',
      jobTitle: 'Buyer',
      companyName: 'Acme',
      lifecycleStage: 'customer',
      ltvCents: 2500,
      ordersCount: 2,
      firstPurchaseAtMs: 150,
      lastPurchaseAtMs: 400,
      lastEmailEngagementAtMs: 500,
      custom: { tier: 'silver', region: 'TX', size: 'L' },
    },
    b: {
      sources: { newsletter: true },
      interactions: [{ type: 'newsletter', atMs: 50, hostId: 'b' }],
      tags: ['b-side'],
    },
  },
}

describe('planContactMerge — the identity', () => {
  it('keeps the survivor’s address and records the merged one as an alternate', () => {
    const plan = planContactMerge(survivor, merged)
    expect(plan.survivor['email']).toBeUndefined()
    expect(plan.survivor['alternateEmails']).toEqual([
      'jane@gmail.com',
      'jane.doe@example.org',
    ])
    expect(plan.emails).toEqual([
      'jane@acme.com',
      'jane@gmail.com',
      'jane.doe@example.org',
    ])
    expect(plan.mergedEmails).toEqual(['jane@gmail.com', 'jane.doe@example.org'])
  })

  it('never lists the survivor’s own address as an alternate', () => {
    const plan = planContactMerge(
      { ...survivor, alternateEmails: ['jane@acme.com', 'old@acme.com'] },
      { ...merged, alternateEmails: ['jane@acme.com'] },
    )
    expect(plan.survivor['alternateEmails']).toEqual(['old@acme.com', 'jane@gmail.com'])
  })

  it('keeps the survivor’s name and search keys when it has one', () => {
    const plan = planContactMerge(survivor, merged)
    expect(plan.survivor['name']).toBeUndefined()
    expect(plan.survivor['nameLower']).toBeUndefined()
  })

  it('fills a missing canonical name from the merged record, with its search keys', () => {
    const plan = planContactMerge({ ...survivor, name: '', nameLower: '' }, merged)
    expect(plan.survivor['name']).toBe('J. Doe')
    expect(plan.survivor['nameLower']).toBe('j. doe')
    expect(plan.survivor['nameTokens']).toContain('doe')
  })

  it('fills the search echoes the survivor lacks and leaves the ones it has', () => {
    const plan = planContactMerge({ ...survivor, phone: '+15125550100' }, merged)
    expect(plan.survivor['phone']).toBeUndefined()
    expect(plan.survivor['companyName']).toBe('Acme')
  })
})

describe('planContactMerge — the shared lists', () => {
  it('unions scope, attribution, forms and companies', () => {
    const plan = planContactMerge(survivor, merged)
    expect(plan.survivor['visibleTo']).toEqual(['host:a', 'host:b'])
    expect(plan.visibleTo).toEqual(['host:a', 'host:b'])
    expect(plan.survivor['capturedByHostIds']).toEqual(['a', 'b'])
    expect(plan.survivor['formIds']).toEqual(['f1', 'f2'])
    expect(plan.survivor['companyIds']).toEqual(['c1', 'shared', 'c2'])
    expect(plan.survivor['tags']).toEqual(['b2b', 'newsletter'])
  })

  it('counts down only the companies both records were filed under', () => {
    const plan = planContactMerge(survivor, merged)
    expect(plan.companyCounts).toEqual([{ companyId: 'shared', delta: -1 }])
  })
})

describe('planContactMerge — consent', () => {
  it('keeps the survivor’s grant per site and fills the sites it had none for', () => {
    const plan = planContactMerge(survivor, merged)
    expect(plan.survivor['marketingConsentByHost']).toEqual({
      a: { marketingConsent: true, marketingConsentAtMs: 10 },
      b: { marketingConsent: true, marketingConsentAtMs: 20 },
    })
  })

  it('lets a recorded refusal on either record stand', () => {
    expect(planContactMerge(survivor, merged).survivor['marketingConsent']).toBe(false)
    expect(
      planContactMerge({ ...survivor, marketingConsent: false }, { ...merged, marketingConsent: true })
        .survivor['marketingConsent'],
    ).toBe(false)
    expect(
      planContactMerge(survivor, { ...merged, marketingConsent: true }).survivor['marketingConsent'],
    ).toBe(true)
    expect(
      planContactMerge(survivor, { ...merged, marketingConsent: undefined }).survivor[
        'marketingConsent'
      ],
    ).toBeUndefined()
  })
})

describe('planContactMerge — the facets', () => {
  it('writes only the groups the merged record held, and brings a new group whole', () => {
    const plan = planContactMerge(survivor, merged)
    const facets = plan.survivor['facets'] as Record<string, Record<string, unknown>>
    expect(Object.keys(facets).sort()).toEqual(['a', 'b'])
    expect(facets['b']).toEqual(merged.facets.b)
  })

  it('lets the survivor’s scalars win and fills the ones it lacks', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.phone).toBe('+15125550100')
    expect(facet.lifecycleStage).toBe('lead')
    expect(facet.ownerUid).toBe('u-1')
    expect(facet.jobTitle).toBe('Buyer')
    expect(facet.companyName).toBe('Acme')
  })

  it('unions the sources, tags and campaigns', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.sources).toEqual({ form: true, order: true })
    expect(facet.tags).toEqual(['vip', 'wholesale'])
  })

  it('unions the timeline by event, newest first', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.interactions.map((entry: any) => entry.atMs)).toEqual([400, 300, 100])
  })

  it('appends the merged notes under the survivor’s', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.notes).toBe('Met at the expo.\n\nPrefers email.')
  })

  it('adds the figures and keeps the earliest first and the latest last', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.ltvCents).toBe(3500)
    expect(facet.ordersCount).toBe(3)
    expect(facet.firstPurchaseAtMs).toBe(150)
    expect(facet.lastPurchaseAtMs).toBe(400)
    expect(facet.lastEmailEngagementAtMs).toBe(500)
  })

  it('fills custom values key by key, treating an empty string as empty', () => {
    const facet = (planContactMerge(survivor, merged).survivor['facets'] as any)['a']
    expect(facet.custom).toEqual({ tier: 'gold', region: 'TX', size: 'L' })
  })
})

describe('mergeContactFacet', () => {
  it('answers the one facet present when the other holder has none', () => {
    expect(mergeContactFacet(undefined, { sources: { form: true }, interactions: [] })).toEqual({
      sources: { form: true },
      interactions: [],
    })
    expect(mergeContactFacet({ sources: {}, interactions: [], tags: ['x'] }, undefined)).toEqual({
      sources: {},
      interactions: [],
      tags: ['x'],
    })
  })
})

describe('mergeInteractions', () => {
  it('caps the union the way every capture caps a timeline', () => {
    const many = (start: number) =>
      Array.from({ length: 40 }, (_, index) => ({
        type: 'form' as const,
        atMs: start + index,
      }))
    const out = mergeInteractions(many(0), many(1000))
    expect(out).toHaveLength(CONTACT_INTERACTIONS_CAP)
    expect(out[0].atMs).toBe(1039)
  })
})

describe('contactMergePreview', () => {
  it('shows each field as the viewing group sees it, with where the result came from', () => {
    const rows = contactMergePreview(survivor, merged, 'a', {
      memberName: (uid) => (uid === 'u-1' ? 'Ada' : uid),
    })
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey['email']).toMatchObject({
      survivor: 'jane@acme.com',
      merged: 'jane@gmail.com, jane.doe@example.org',
      result: 'jane@acme.com, jane@gmail.com, jane.doe@example.org',
      from: 'both',
    })
    expect(byKey['phone']).toMatchObject({ result: '+15125550100', from: 'survivor' })
    expect(byKey['jobTitle']).toMatchObject({ result: 'Buyer', from: 'merged' })
    expect(byKey['owner']).toMatchObject({ survivor: 'Ada', result: 'Ada' })
    expect(byKey['lifecycleStage']).toMatchObject({ survivor: 'Lead', merged: 'Customer', result: 'Lead' })
    expect(byKey['orders']).toMatchObject({ result: '3 · $35.00', from: 'both' })
    expect(byKey['timeline']).toMatchObject({ survivor: '2', merged: '2', result: '3' })
    expect(byKey['custom.size']).toMatchObject({ result: 'L', from: 'merged' })
  })

  it('reads nothing from another holder’s facet', () => {
    const rows = contactMergePreview(survivor, merged, 'b')
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    expect(byKey['tags']).toMatchObject({ survivor: '', merged: 'b-side', result: 'b-side' })
    expect(byKey['phone']).toMatchObject({ survivor: '', merged: '', result: '', from: 'none' })
  })
})
