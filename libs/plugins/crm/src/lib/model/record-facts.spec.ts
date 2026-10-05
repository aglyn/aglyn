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
  crmCustomFacts,
  crmFactAddress,
  crmFactMoney,
  crmOpenTaskFacts,
  dealFacts,
  importFacts,
  leadFacts,
} from './record-facts'

/**
 * What leaves the CRM when another plugin reads a record (AGL-2917): the
 * WHOLE record since AGL-3520 — contact details, addresses, consent, custom
 * values under their labels, the people and records it names by name — and
 * still never an id. Every fixture carries ids, and the assertions are on the
 * whole facts object, so a field added to a builder shows up here as a
 * failure rather than as a quiet new data flow.
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

/** What never leaves: a uid or a record id, from any field that holds one. */
const SECRET_WORDS = ['owner-uid', 'assignee-uid', 'contact-7', 'company-3', 'manager-contact-9', 'parent-co-1', 'p-1', 'lead-1', 'spring']

/** The team and the org's custom fields, as the server half resolves them. */
const NAMES = {
  member: (uid: string) => ({ 'owner-uid': 'Sam Rep', 'assignee-uid': 'Alex Helper' })[uid] ?? '',
  customFields: [
    { key: 'budget', label: 'Budget', type: 'number' as const, order: 1, object: 'contact' as const },
    { key: 'renewal', label: 'Renewal', type: 'date' as const, order: 0, object: 'contact' as const },
    { key: 'terms', label: 'Payment terms', type: 'text' as const, order: 0, object: 'company' as const },
    { key: 'po', label: 'PO number', type: 'text' as const, order: 0, object: 'deal' as const },
    { key: 'territory', label: 'Territory', type: 'select' as const, order: 0, object: 'lead' as const },
  ],
}

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
        custom: { budget: 25000, renewal: '2027-01-15', legacy: 'kept' },
        salutation: 'Ms.',
        firstName: 'Jane',
        lastName: 'Doe',
        department: 'Facilities',
        mobilePhone: '+15125550111',
        fax: '+15125550122',
        birthdate: '1984-07-21',
        assistantName: 'Pat Assistant',
        reportsToContactId: 'manager-contact-9',
        otherAddress: { line1: '9 Oak Lane', city: 'Austin' },
        doNotCall: true,
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
      names: NAMES,
      reportsToName: 'Lee Manager',
    })
    expect(facts).toEqual({
      record: 'contact',
      name: 'Jane Doe',
      salutation: 'Ms.',
      firstName: 'Jane',
      lastName: 'Doe',
      emails: ['jane@example.com', 'jane.alt@example.com'],
      phone: '+15125550100',
      mobilePhone: '+15125550111',
      homePhone: '',
      otherPhone: '',
      fax: '+15125550122',
      jobTitle: 'Facilities manager',
      department: 'Facilities',
      birthdate: '1984-07-21',
      assistant: 'Pat Assistant',
      assistantPhone: '',
      reportsTo: 'Lee Manager',
      mailingAddress: '100 Congress Ave, Austin',
      otherAddress: '9 Oak Lane, Austin',
      doNotCall: true,
      company: 'Acme Roofing Supply',
      lifecycleStage: 'Opportunity',
      leadSource: '',
      owner: 'Sam Rep',
      // The fixture's consent is in a shape no reader takes: nothing recorded.
      marketingConsent: 'none recorded',
      tags: ['commercial', 'repeat'],
      sources: ['Booking', 'Form'],
      orders: 2,
      lastPurchase: '2026-08-20',
      since: '2026-03-02',
      lastEmailEngagement: '2026-09-10',
      // Under each field's label, in the fields' order; a value with no field under its key.
      custom: [
        { label: 'Renewal', value: '2027-01-15' },
        { label: 'Budget', value: '25000' },
        { label: 'legacy', value: 'kept' },
      ],
      notes: 'Prefers calls after 3pm.',
      timeline: [
        {
          on: '2026-09-12',
          kind: 'Email',
          direction: 'outbound',
          to: 'jane@example.com',
          subject: 'Your inspection report',
          text: 'Attached is the report from Friday.',
          delivery: 'Opened',
        },
        { on: '2026-09-08', kind: 'Call', text: 'Asked for a quote on the warehouse roof.', outcome: 'Wants a quote' },
        // The booking on this site; the form on another site stays with that site.
        { on: '2026-09-05', kind: 'Booking', text: 'Booked "Roof inspection"' },
      ],
      openTasks: [
        { title: 'Send the warehouse quote', kind: 'Email', priority: 'high', due: '2026-09-15', overdue: true, assignee: 'Alex Helper' },
      ],
      deals: [
        { title: 'Warehouse re-roof', stage: 'Proposal sent', status: 'open', amount: 'USD 18450.00', expectedClose: '2026-10-01' },
      ],
    })
    expectNoSecrets(facts)
    expect(JSON.stringify(facts)).not.toContain('Quote request')
    // The team member who logged an email is not a fact of the record.
    expect(JSON.stringify(facts)).not.toContain('Sam Teammate')
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
  it('reports a company whole: its phones, addresses, account fields, parent, owner and custom values (AGL-3520)', () => {
    const facts = companyFacts({
      company: {
        name: 'Acme Roofing Supply',
        domain: 'acme.test',
        website: 'https://acme.test',
        phone: '+15125550100',
        address: { line1: '100 Congress Ave' } as never,
        industry: 'Construction',
        type: 'Customer',
        rating: 'Hot',
        ownership: 'Private',
        accountSource: 'Trade show',
        numberOfEmployees: 120,
        annualRevenueCents: 1_250_000_00,
        currency: 'usd',
        fax: '+15125550199',
        shippingAddress: { line1: '1 Dock Rd' } as never,
        accountNumber: 'ACCT-SECRET-1',
        ownerUid: 'owner-uid',
        tags: ['supplier'],
        contactsCount: 4,
        notes: 'Net 30.',
        custom: { terms: 'Net 30' },
        parentCompanyId: 'parent-co-1',
        createdAt: new Date(day('2025-11-20')),
        visibleTo: ['org'],
        hostId: 'host-1',
      },
      activities: [{ kind: 'meeting', atMs: day('2026-09-02'), body: 'Annual review', outcome: 'Renewed' }],
      tasks: [],
      deals: [],
      pipelines: new Map(),
      nowMs: NOW,
      names: NAMES,
      parentCompanyName: 'Acme Holdings',
    })
    expect(facts).toEqual({
      record: 'company',
      name: 'Acme Roofing Supply',
      domain: 'acme.test',
      website: 'https://acme.test',
      phone: '+15125550100',
      fax: '+15125550199',
      industry: 'Construction',
      type: 'Customer',
      rating: 'Hot',
      ownership: 'Private',
      accountSource: 'Trade show',
      employees: 120,
      annualRevenue: crmFactMoney(1_250_000_00, 'usd'),
      accountNumber: 'ACCT-SECRET-1',
      site: '',
      tickerSymbol: '',
      sicCode: '',
      billingAddress: '100 Congress Ave',
      shippingAddress: '1 Dock Rd',
      parentCompany: 'Acme Holdings',
      owner: 'Sam Rep',
      tags: ['supplier'],
      people: 4,
      since: '2025-11-20',
      custom: [{ label: 'Payment terms', value: 'Net 30' }],
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
        custom: { po: 'PO-7781' },
        createdAt: new Date(day('2026-08-01')),
        visibleTo: ['org'],
        hostId: 'host-1',
      },
      pipeline: PIPELINE,
      activities: [],
      tasks: [{ title: 'Site visit', kind: 'meeting', priority: 'normal', status: 'open', dueAtMs: null }],
      nowMs: NOW,
      names: NAMES,
    })
    expect(facts).toEqual({
      record: 'deal',
      title: 'Warehouse re-roof',
      pipeline: 'Sales',
      // Each stage's odds and forecast category — its kind's on a stage
      // saved without one (AGL-3516).
      stages: [
        { id: 'qualified', name: 'Qualified', kind: 'open', probability: 10, forecastCategory: 'Pipeline' },
        { id: 'proposal-sent', name: 'Proposal sent', kind: 'open', probability: 40, forecastCategory: 'Pipeline' },
        { id: 'won', name: 'Won', kind: 'won', probability: 100, forecastCategory: 'Closed' },
        { id: 'lost', name: 'Lost', kind: 'lost', probability: 0, forecastCategory: 'Omitted' },
      ],
      stageId: 'qualified',
      stage: 'Qualified',
      status: 'open',
      amount: 'EUR 9900.00',
      expectedClose: null,
      inStageSince: '2026-08-30',
      lostReason: '',
      type: '',
      leadSource: '',
      nextStep: '',
      probability: 10,
      forecastCategory: 'Pipeline',
      campaign: '',
      contact: 'Jane Doe',
      company: 'Acme Roofing Supply',
      owner: 'Sam Rep',
      products: [{ name: 'Membrane', quantity: 1, unitAmount: 'EUR 9900.00' }],
      since: '2026-08-01',
      custom: [{ label: 'PO number', value: 'PO-7781' }],
      notes: '',
      timeline: [],
      openTasks: [{ title: 'Site visit', kind: 'Meeting', priority: 'normal', due: null, overdue: false }],
    })
    expectNoSecrets(facts)
  })

  it("reports a deal's Opportunity fields, its own odds over its stage's (AGL-3516)", () => {
    const facts = dealFacts({
      deal: {
        title: 'Warehouse re-roof',
        pipelineId: 'p-1',
        stageId: 'proposal-sent',
        status: 'open',
        visibleTo: ['org'],
        hostId: 'host-1',
        type: 'New Business',
        leadSource: 'Trade show',
        nextStep: 'Send the revised quote',
        probability: 65,
        forecastCategory: 'commit',
        campaignId: 'spring',
      },
      pipeline: PIPELINE,
      activities: [],
      tasks: [],
      nowMs: NOW,
      campaignName: 'Spring push',
    })
    expect(facts).toMatchObject({
      campaign: 'Spring push',
      type: 'New Business',
      leadSource: 'Trade show',
      nextStep: 'Send the revised quote',
      probability: 65,
      forecastCategory: 'Commit',
    })
    // The campaign is named by its name, never by its id.
    expect(JSON.stringify(facts)).not.toContain('"spring"')
  })

  it('reports a lead whole: how to reach them, its account fields, owner, campaigns and custom values (AGL-3520)', () => {
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
        marketingConsentByHost: { 'host-1': { marketingConsent: true, marketingConsentAtMs: day('2026-08-01') } },
        notes: 'Asked about gutters too.',
        // The profile and Salesforce's standard lead fields (AGL-3513).
        salutation: 'Ms.',
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Acme',
        jobTitle: 'Facilities lead',
        leadSource: 'Webinar',
        industry: 'Construction',
        rating: 'Warm',
        numberOfEmployees: 42,
        annualRevenueCents: 125000000,
        currency: 'usd',
        doNotCall: true,
        phone: '+15125550107',
        mobilePhone: '+15125550108',
        fax: '+15125550109',
        website: 'https://acme.test/',
        address: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
        tags: ['roofing'],
        custom: { territory: 'West' },
      },
      activities: [{ kind: 'call', atMs: day('2026-09-15'), body: 'Left a voicemail.', leadId: 'lead-1' }],
      tasks: [{ title: 'Call back', kind: 'call', priority: 'normal', status: 'open', dueAtMs: day('2026-09-17'), leadId: 'lead-1' }],
      nowMs: NOW,
      group: GROUP,
      names: NAMES,
      campaignNames: ['Spring push'],
    })
    expect(facts).toEqual({
      record: 'lead',
      name: 'Jane Doe',
      salutation: 'Ms.',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+15125550107',
      mobilePhone: '+15125550108',
      fax: '+15125550109',
      website: 'https://acme.test/',
      address: '1 Main St, Austin, TX 78701, US',
      company: 'Acme',
      jobTitle: 'Facilities lead',
      leadSource: 'Webinar',
      industry: 'Construction',
      rating: 'Warm',
      employees: 42,
      annualRevenue: 'USD 1250000.00',
      doNotCall: true,
      status: 'Working',
      owner: 'Sam Rep',
      campaigns: ['Spring push'],
      marketingConsent: 'opted in on 2026-08-01',
      tags: ['roofing'],
      sources: ['Booking', 'Form'],
      captures: 3,
      firstSeen: '2026-08-01',
      lastSeen: '2026-09-14',
      assigned: true,
      converted: false,
      unqualifiedReason: '',
      custom: [{ label: 'Territory', value: 'West' }],
      notes: 'Asked about gutters too.',
      timeline: [{ on: '2026-09-15', kind: 'Call', text: 'Left a voicemail.' }],
      openTasks: [{ title: 'Call back', kind: 'Call', priority: 'normal', due: '2026-09-17', overdue: false }],
    })
    expectNoSecrets(facts)
  })
})

describe('the pieces', () => {
  it('reads an email’s delivery and who it was from and to (AGL-3520)', () => {
    expect(
      crmActivityFact({ kind: 'email', atMs: day('2026-09-01'), direction: 'inbound', from: 'sam@acme.test', threadSubject: 'Re: quote', body: 'Looks good' }),
    ).toEqual({ on: '2026-09-01', kind: 'Email', direction: 'inbound', from: 'sam@acme.test', subject: 'Re: quote', text: 'Looks good' })
    expect(crmActivityFact({ kind: 'note', atMs: Number.NaN, body: 'no time' })).toBeNull()
  })

  it('reads a call’s direction, and a task’s own Type and Status labels (AGL-3517)', () => {
    expect(crmActivityFact({ kind: 'call', atMs: day('2026-09-03'), direction: 'internal', body: 'Synced with Sam' })).toEqual({
      on: '2026-09-03',
      kind: 'Call',
      direction: 'internal',
      text: 'Synced with Sam',
    })
    // A direction the kind does not take is not reported.
    expect(crmActivityFact({ kind: 'note', atMs: day('2026-09-03'), direction: 'inbound', body: 'x' })).toEqual({
      on: '2026-09-03',
      kind: 'Note',
      text: 'x',
    })
    expect(
      crmOpenTaskFacts(
        [{ title: 'Walk the site', kind: 'meeting', typeLabel: 'Site visit', priority: 'high', status: 'open', statusLabel: 'In Progress' }],
        NOW,
      ),
    ).toEqual([{ title: 'Walk the site', kind: 'Site visit', priority: 'high', status: 'In Progress', due: null, overdue: false }])
  })

  it('reports text a person wrote as written, addresses and numbers included (AGL-3520)', () => {
    expect(crmActivityFact({ kind: 'call', atMs: day('2026-09-02'), body: 'Asked us to text 512.555.0199 instead' })).toEqual({
      on: '2026-09-02',
      kind: 'Call',
      text: 'Asked us to text 512.555.0199 instead',
    })
    expect(leadFacts({ lead: { name: 'jane@example.com', status: 'new' }, activities: [] }).name).toBe('jane@example.com')
  })

  it('writes an address on one line and a custom value by its type', () => {
    expect(crmFactAddress({ line1: '1 Main St', line2: 'Suite 4', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' })).toBe(
      '1 Main St, Suite 4, Austin, TX 78701, US',
    )
    expect(crmFactAddress(null)).toBe('')
    expect(
      crmCustomFacts(
        { vip: true, since: Date.parse('2026-01-02T00:00:00.000Z'), empty: '', retired: 'old' },
        'contact',
        [
          { key: 'vip', label: 'VIP', type: 'checkbox', order: 0 },
          { key: 'since', label: 'Customer since', type: 'date', order: 1 },
          { key: 'retired', label: 'Old field', type: 'text', order: 0, retiredAt: 5 },
          { key: 'region', label: 'Region', type: 'text', order: 0, object: 'company' },
        ],
      ),
    ).toEqual([
      { label: 'VIP', value: 'yes' },
      { label: 'Customer since', value: '2026-01-02' },
      { label: 'Old field', value: 'old' },
    ])
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
