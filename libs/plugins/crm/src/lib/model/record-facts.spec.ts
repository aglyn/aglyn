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

import type { ConsentGroup, CrmPipeline } from '@aglyn/aglyn/server'
import {
  CRM_FACTS_TIMELINE_MAX,
  companyFacts,
  contactFacts,
  crmActivityFact,
  crmFactMoney,
  crmFactProse,
  crmOpenTaskFacts,
  dealFacts,
  importFacts,
  leadFacts,
} from './record-facts'

/**
 * What leaves the CRM when another plugin reads a record (AGL-2917). Every
 * fixture below carries the fields that must NEVER be reported — addresses,
 * phone numbers, consent, custom values, owners, ids — and the assertions
 * are on the whole facts object, so a field added to a builder shows up here
 * as a failure rather than as a quiet new data flow.
 */

const NOW = Date.parse('2026-09-16T15:00:00.000Z')
const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`)

const GROUP: ConsentGroup = {
  hostId: 'host-1',
  groupId: 'host-1',
  name: 'Roofing site',
  hostIds: ['host-1'],
  declared: false,
} as ConsentGroup

const PIPELINE: CrmPipeline = {
  name: 'Sales',
  stages: [
    { id: 'won', name: 'Won', order: 4, probability: 100, kind: 'won' },
    { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
    { id: 'proposal-sent', name: 'Proposal sent', order: 2, probability: 40, kind: 'open' },
    { id: 'lost', name: 'Lost', order: 5, probability: 0, kind: 'lost' },
  ],
  visibleTo: ['org'],
  hostId: 'host-1',
}

const SECRET_WORDS = [
  'jane@example.com',
  'jane.alt@example.com',
  '+15125550100',
  'Congress Ave',
  'owner-uid',
  'assignee-uid',
  'contact-7',
  'company-3',
  'secret custom value',
  'sam@acme.test',
  'Sam Teammate',
]

function expectNoSecrets(facts: unknown) {
  const text = JSON.stringify(facts)
  for (const word of SECRET_WORDS) expect([word, text.includes(word)]).toEqual([word, false])
}

describe('a contact’s facts', () => {
  const row = {
    email: 'jane@example.com',
    alternateEmails: ['jane.alt@example.com'],
    name: 'Jane Canonical',
    createdAt: new Date(day('2026-03-02')),
    marketingConsentByHost: { 'host-1': true },
    facets: {
      'host-1': {
        name: 'Jane Doe',
        phone: '+15125550100',
        jobTitle: 'Facilities manager',
        companyName: 'Acme Roofing Supply',
        companyId: 'company-3',
        address: { line1: '100 Congress Ave', city: 'Austin' },
        ownerUid: 'owner-uid',
        lifecycleStage: 'opportunity',
        tags: ['commercial', 'repeat'],
        sources: { form: true, booking: true },
        ordersCount: 2,
        lastPurchaseAtMs: day('2026-08-20'),
        lastEmailEngagementAtMs: day('2026-09-10'),
        notes: 'Prefers calls after 3pm.',
        custom: { budget: 'secret custom value' },
        interactions: [
          { type: 'booking', atMs: day('2026-09-05'), summary: 'Booked "Roof inspection"', hostId: 'host-1' },
          { type: 'form', atMs: day('2026-08-01'), summary: 'Submitted Quote request', hostId: 'host-2' },
        ],
      },
    },
  }

  it('reports what a person on the team reads, and nothing that identifies or reaches them', () => {
    const facts = contactFacts({
      row,
      group: GROUP,
      activities: [
        {
          kind: 'email',
          atMs: day('2026-09-12'),
          subject: 'Your inspection report',
          body: 'Attached is the report from Friday.',
          to: 'jane@example.com',
          direction: 'outbound',
          deliveryState: 'opened',
          byUid: 'owner-uid',
          byName: 'Sam Teammate',
          contactId: 'contact-7',
        },
        { kind: 'call', atMs: day('2026-09-08'), body: 'Asked for a quote on the warehouse roof.', outcome: 'Wants a quote', byUid: 'owner-uid' },
      ],
      tasks: [
        { title: 'Send the warehouse quote', kind: 'email', priority: 'high', status: 'open', dueAtMs: day('2026-09-15'), assigneeUid: 'assignee-uid' },
        { title: 'Old follow-up', kind: 'call', priority: 'normal', status: 'done', dueAtMs: day('2026-09-01') },
      ],
      deals: [
        { title: 'Warehouse re-roof', pipelineId: 'p-1', stageId: 'proposal-sent', status: 'open', amountCents: 1_845_000, currency: 'usd', expectedCloseAtMs: day('2026-10-01'), contactId: 'contact-7' },
      ],
      pipelines: new Map([['p-1', PIPELINE]]),
      nowMs: NOW,
    })
    expect(facts).toEqual({
      record: 'contact',
      name: 'Jane Doe',
      jobTitle: 'Facilities manager',
      company: 'Acme Roofing Supply',
      lifecycleStage: 'Opportunity',
      tags: ['commercial', 'repeat'],
      sources: ['Booking', 'Form'],
      orders: 2,
      lastPurchase: '2026-08-20',
      since: '2026-03-02',
      lastEmailEngagement: '2026-09-10',
      notes: 'Prefers calls after 3pm.',
      timeline: [
        {
          on: '2026-09-12',
          kind: 'Email',
          direction: 'outbound',
          subject: 'Your inspection report',
          text: 'Attached is the report from Friday.',
          delivery: 'Opened',
        },
        { on: '2026-09-08', kind: 'Call', text: 'Asked for a quote on the warehouse roof.', outcome: 'Wants a quote' },
        // The booking on this site; the form on another site stays with that site.
        { on: '2026-09-05', kind: 'Booking', text: 'Booked "Roof inspection"' },
      ],
      openTasks: [{ title: 'Send the warehouse quote', kind: 'Email', priority: 'high', due: '2026-09-15', overdue: true }],
      deals: [
        { title: 'Warehouse re-roof', stage: 'Proposal sent', status: 'open', amount: 'USD 18450.00', expectedClose: '2026-10-01' },
      ],
    })
    expectNoSecrets(facts)
    expect(JSON.stringify(facts)).not.toContain('Quote request')
  })

  it('reports the same bytes for the same records, and keeps a tie in the order the rows arrived', () => {
    const input = {
      row,
      group: GROUP,
      activities: [
        { kind: 'note' as const, atMs: day('2026-09-01'), body: 'One' },
        { kind: 'note' as const, atMs: day('2026-09-01'), body: 'Two' },
      ],
      tasks: [],
      deals: [],
      pipelines: new Map<string, CrmPipeline>(),
      nowMs: NOW,
    }
    expect(JSON.stringify(contactFacts(input))).toBe(JSON.stringify(contactFacts({ ...input })))
    // A tie keeps the order the rows arrived in.
    expect(contactFacts(input).timeline.slice(1, 3).map((entry) => entry.text)).toEqual(['One', 'Two'])
  })

  it('cuts the timeline to its newest entries', () => {
    const activities = Array.from({ length: 30 }, (_, index) => ({
      kind: 'note' as const,
      atMs: day('2026-09-06') + index * 86_400_000,
      body: `Note ${index}`,
    }))
    const facts = contactFacts({ row, group: GROUP, activities, tasks: [], deals: [], pipelines: new Map(), nowMs: NOW })
    expect(facts.timeline).toHaveLength(CRM_FACTS_TIMELINE_MAX)
    expect(facts.timeline[0].text).toBe('Note 29')
  })
})

describe('a company’s, a deal’s and a lead’s facts', () => {
  it('reports a company without its phone, address, owner or custom values', () => {
    const facts = companyFacts({
      company: {
        name: 'Acme Roofing Supply',
        domain: 'acme.test',
        website: 'https://acme.test',
        phone: '+15125550100',
        address: { line1: '100 Congress Ave' } as never,
        industry: 'Construction',
        ownerUid: 'owner-uid',
        tags: ['supplier'],
        contactsCount: 4,
        notes: 'Net 30.',
        custom: { terms: 'secret custom value' },
        createdAt: new Date(day('2025-11-20')),
        visibleTo: ['org'],
        hostId: 'host-1',
      },
      activities: [{ kind: 'meeting', atMs: day('2026-09-02'), body: 'Annual review', outcome: 'Renewed' }],
      tasks: [],
      deals: [],
      pipelines: new Map(),
      nowMs: NOW,
    })
    expect(facts).toEqual({
      record: 'company',
      name: 'Acme Roofing Supply',
      domain: 'acme.test',
      industry: 'Construction',
      tags: ['supplier'],
      people: 4,
      since: '2025-11-20',
      notes: 'Net 30.',
      timeline: [{ on: '2026-09-02', kind: 'Meeting', text: 'Annual review', outcome: 'Renewed' }],
      openTasks: [],
      deals: [],
    })
    expectNoSecrets(facts)
  })

  it('reports a deal with its pipeline’s stages in order, by id, for a stage to be named from', () => {
    const facts = dealFacts({
      deal: {
        title: 'Warehouse re-roof',
        pipelineId: 'p-1',
        stageId: 'qualified',
        status: 'open',
        amountCents: 990_000,
        currency: 'eur',
        stageChangedAtMs: day('2026-08-30'),
        contactId: 'contact-7',
        contactName: 'Jane Doe',
        companyId: 'company-3',
        companyName: 'Acme Roofing Supply',
        ownerUid: 'owner-uid',
        lineItems: [{ name: 'Membrane', quantity: 1, unitAmountCents: 990_000, currency: 'eur' }],
        custom: { po: 'secret custom value' },
        createdAt: new Date(day('2026-08-01')),
        visibleTo: ['org'],
        hostId: 'host-1',
      },
      pipeline: PIPELINE,
      activities: [],
      tasks: [{ title: 'Site visit', kind: 'meeting', priority: 'normal', status: 'open', dueAtMs: null }],
      nowMs: NOW,
    })
    expect(facts).toEqual({
      record: 'deal',
      title: 'Warehouse re-roof',
      pipeline: 'Sales',
      stages: [
        { id: 'qualified', name: 'Qualified', kind: 'open' },
        { id: 'proposal-sent', name: 'Proposal sent', kind: 'open' },
        { id: 'won', name: 'Won', kind: 'won' },
        { id: 'lost', name: 'Lost', kind: 'lost' },
      ],
      stageId: 'qualified',
      stage: 'Qualified',
      status: 'open',
      amount: 'EUR 9900.00',
      expectedClose: null,
      inStageSince: '2026-08-30',
      lostReason: '',
      contact: 'Jane Doe',
      company: 'Acme Roofing Supply',
      products: 1,
      since: '2026-08-01',
      notes: '',
      timeline: [],
      openTasks: [{ title: 'Site visit', kind: 'Meeting', priority: 'normal', due: null, overdue: false }],
    })
    expectNoSecrets(facts)
  })

  it('reports a lead’s standing, and never its address, consent or owner', () => {
    const facts = leadFacts({
      lead: {
        email: 'jane@example.com',
        name: 'Jane Doe',
        status: 'working',
        sources: ['form:quote', 'booking', 'form:contact'],
        submissionCount: 3,
        firstSeenAtMs: day('2026-08-01'),
        lastSeenAtMs: day('2026-09-14'),
        ownerUid: 'owner-uid',
        marketingConsent: { 'host-1': true },
        notes: 'Asked about gutters too.',
      },
      activities: [{ kind: 'call', atMs: day('2026-09-15'), body: 'Left a voicemail.', leadId: 'lead-1' }],
    })
    expect(facts).toEqual({
      record: 'lead',
      name: 'Jane Doe',
      status: 'Working',
      sources: ['Booking', 'Form'],
      captures: 3,
      firstSeen: '2026-08-01',
      lastSeen: '2026-09-14',
      assigned: true,
      converted: false,
      unqualifiedReason: '',
      notes: 'Asked about gutters too.',
      timeline: [{ on: '2026-09-15', kind: 'Call', text: 'Left a voicemail.' }],
    })
    expectNoSecrets(facts)
  })
})

describe('the pieces', () => {
  it('reads an email’s delivery and never its addresses', () => {
    expect(
      crmActivityFact({ kind: 'email', atMs: day('2026-09-01'), direction: 'inbound', from: 'sam@acme.test', threadSubject: 'Re: quote', body: 'Looks good' }),
    ).toEqual({ on: '2026-09-01', kind: 'Email', direction: 'inbound', subject: 'Re: quote', text: 'Looks good' })
    expect(crmActivityFact({ kind: 'note', atMs: Number.NaN, body: 'no time' })).toBeNull()
  })

  it('replaces an address or a number typed into free text, and leaves days, amounts and short numbers', () => {
    expect(crmFactProse('Call Jane on (512) 555-0100 or +44 20 7946 0958, or write jane@example.com.', 280)).toBe(
      'Call Jane on [phone number] or [phone number], or write [email address].',
    )
    expect(crmFactProse('Met 2026-09-09 2026-09-12; quoted USD 18450.00 for 3 bays, order 55512.', 280)).toBe(
      'Met 2026-09-09 2026-09-12; quoted USD 18450.00 for 3 bays, order 55512.',
    )
    // Replaced before the cut, so a cut cannot leave half an address behind.
    expect(crmFactProse('Reach her at jane.alt@example.com', 24)).toBe('Reach her at [email add…')
    expect(crmActivityFact({ kind: 'call', atMs: day('2026-09-02'), body: 'Asked us to text 512.555.0199 instead' })).toEqual({
      on: '2026-09-02',
      kind: 'Call',
      text: 'Asked us to text [phone number] instead',
    })
    expect(crmFactProse(42, 280)).toBe('')
  })

  it('orders open tasks by due day, undated last, and marks the ones past their day', () => {
    expect(
      crmOpenTaskFacts(
        [
          { title: 'Undated', kind: 'todo', status: 'open', dueAtMs: null },
          { title: 'Today', kind: 'call', status: 'open', dueAtMs: day('2026-09-16') },
          { title: 'Yesterday', kind: 'call', status: 'open', dueAtMs: day('2026-09-15'), priority: 'low' },
        ],
        NOW,
      ).map((task) => [task.title, task.due, task.overdue, task.priority]),
    ).toEqual([
      ['Yesterday', '2026-09-15', true, 'low'],
      ['Today', '2026-09-16', false, 'normal'],
      ['Undated', null, false, 'normal'],
    ])
  })

  it('writes money as a code and a fixed amount', () => {
    expect(crmFactMoney(125_000, 'usd')).toBe('USD 1250.00')
    expect(crmFactMoney(99, undefined)).toBe('USD 0.99')
    expect(crmFactMoney(undefined, 'usd')).toBeNull()
  })

  it('lists an import’s fields with their types and the one it needs, and only live custom fields for the record', () => {
    const contacts = importFacts('contacts', [
      { key: 'budget', label: 'Budget', type: 'number', order: 2, object: 'contact' },
      { key: 'renewal', label: 'Renewal', type: 'date', order: 1 },
      { key: 'retired', label: 'Retired', type: 'text', order: 0, retiredAt: 5 },
      { key: 'region', label: 'Region', type: 'select', order: 0, object: 'company' },
    ])
    expect(contacts.fields.find((field) => field.key === 'email')).toEqual({
      key: 'email',
      label: 'Email (required)',
      type: 'email',
      required: true,
    })
    expect(contacts.fields.slice(-2)).toEqual([
      { key: 'custom:renewal', label: 'Renewal', type: 'date', required: false },
      { key: 'custom:budget', label: 'Budget', type: 'number', required: false },
    ])
    expect(contacts.fields.filter((field) => field.required).map((field) => field.key)).toEqual(['email'])
    // Deals and leads take no custom fields through an import.
    expect(importFacts('deals', [{ key: 'po', label: 'PO', type: 'text', order: 0, object: 'deal' }]).fields.some((field) => field.key.startsWith('custom:'))).toBe(false)
    expect(importFacts('companies', [{ key: 'region', label: 'Region', type: 'select', order: 0, object: 'company' }]).fields.at(-1)).toEqual({
      key: 'custom:region',
      label: 'Region',
      type: 'text',
      required: false,
    })
  })
})
