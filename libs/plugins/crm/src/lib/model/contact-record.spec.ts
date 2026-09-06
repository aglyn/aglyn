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
 * The flat record a surface renders is ONE holder's view (AGL-2596).
 *
 * A contact document is shared by every site in the org, and the projection
 * is the one place the facet is read — so this pins that every per-holder
 * field comes from the VIEWING group's facet and none from another's, that
 * the two genuinely shared fields (the address and the canonical name) come
 * from the top, and that a stage the list does not know reads as absent.
 */

import { soloConsentGroup } from '@aglyn/aglyn/app-utils/consent-groups'
import { contactRecordFromDoc, parseContactTags } from './contact-record'

const OTHER = 'other-holder'

const sharedContact = () => ({
  $id: 'con-1',
  email: 'jo@example.com',
  name: 'Jo Canonical',
  // Top-level profile echoes — the search's, never the reader's.
  phone: `+1555${OTHER}`,
  companyName: `${OTHER}-echo`,
  facets: {
    'host-1': {
      name: 'Jo (ours)',
      sources: { form: true },
      interactions: [
        { type: 'form', atMs: 2, summary: 'Ours', hostId: 'host-1' },
        { type: 'order', atMs: 3, summary: 'Theirs', hostId: 'host-2' },
        { type: 'manual', atMs: 1, summary: 'Unattributed' },
      ],
      tags: ['vip'],
      notes: 'Our notes',
      campaignIds: ['camp-1'],
      ltvCents: 4200,
      ordersCount: 2,
      phone: '+15125550107',
      jobTitle: 'Buyer',
      companyName: 'Acme',
      companyId: 'co-1',
      address: { line1: '1 Main St', country: 'US' },
      ownerUid: 'owner-1',
      lifecycleStage: 'lead',
      lastEmailEngagementAtMs: 1_700_000_000_000,
    },
    'host-2': {
      name: `${OTHER}-name`,
      sources: { order: true },
      interactions: [],
      tags: [OTHER],
      notes: `${OTHER}-notes`,
      phone: `+1555${OTHER}`,
      jobTitle: `${OTHER}-title`,
      companyName: `${OTHER}-company`,
      ownerUid: `${OTHER}-owner`,
      lifecycleStage: 'evangelist',
      lastEmailEngagementAtMs: 1_800_000_000_000,
    },
  },
})

describe('contactRecordFromDoc', () => {
  it("flattens THIS holder's facet and nothing of the other's", () => {
    const record = contactRecordFromDoc(sharedContact(), soloConsentGroup('host-1'))

    expect(record).toMatchObject({
      $id: 'con-1',
      email: 'jo@example.com',
      name: 'Jo (ours)',
      canonicalName: 'Jo Canonical',
      nameOverride: 'Jo (ours)',
      sources: { form: true },
      tags: ['vip'],
      notes: 'Our notes',
      campaignIds: ['camp-1'],
      ltvCents: 4200,
      ordersCount: 2,
      phone: '+15125550107',
      jobTitle: 'Buyer',
      companyName: 'Acme',
      companyId: 'co-1',
      address: { line1: '1 Main St', country: 'US' },
      ownerUid: 'owner-1',
      lifecycleStage: 'lead',
      lastEmailEngagementAtMs: 1_700_000_000_000,
    })
    // The timeline is narrowed to the sites the group covers; an entry with
    // no host is everybody's.
    expect(record.interactions.map((entry) => entry.summary)).toEqual([
      'Ours',
      'Unattributed',
    ])
    expect(JSON.stringify(record)).not.toContain(OTHER)
  })

  it('falls back to the canonical name and to empties for a holder with no facet', () => {
    const record = contactRecordFromDoc(sharedContact(), soloConsentGroup('host-3'))

    expect(record.name).toBe('Jo Canonical')
    expect(record.nameOverride).toBe('')
    expect(record.tags).toEqual([])
    expect(record.interactions).toEqual([])
    expect(record.phone).toBe('')
    expect(record.address).toBeNull()
    expect(record.lifecycleStage).toBe('')
    expect(record.ltvCents).toBe(0)
    expect(record.lastEmailEngagementAtMs).toBeNull()
  })

  it('reads an engagement stamp that is not a usable instant as none', () => {
    const contact = sharedContact()
    ;(contact.facets['host-1'] as Record<string, unknown>).lastEmailEngagementAtMs = 'soon'
    expect(
      contactRecordFromDoc(contact, soloConsentGroup('host-1')).lastEmailEngagementAtMs,
    ).toBeNull()
  })

  it('reads a stage it does not know as absent rather than rendering it', () => {
    const contact = sharedContact()
    contact.facets['host-1'].lifecycleStage = 'vip'
    const record = contactRecordFromDoc(contact, soloConsentGroup('host-1'))
    expect(record.lifecycleStage).toBe('')
  })
})

describe('parseContactTags', () => {
  it('lower-cases, trims, dedupes and caps what was typed', () => {
    expect(parseContactTags(' VIP, vip ,Beta,, newsletter ')).toEqual([
      'vip',
      'beta',
      'newsletter',
    ])
    expect(parseContactTags('')).toEqual([])
    expect(
      parseContactTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')),
    ).toHaveLength(20)
  })
})
