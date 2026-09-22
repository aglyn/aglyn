// The one-record migration's decisions (AGL-3235), one case per rule that
// decides whether a live row is written, folded, followed or deleted.

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DELETE_FIELD,
  classifyContact,
  contactOwnReasons,
  foldContactIntoLead,
  hostsForContact,
  leadIsOpen,
  personKey,
  planContact,
  preconditionsForTree,
  repointContactToLead,
  repointLeadToContact,
} from './one-record-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')

const HOST = 'site-1'
const NOW = 1_800_000_000_000
const EMAIL = 'dana@example.com'
const KEY = personKey(EMAIL)

/** A contact an import made at stage Lead, with a profile, on one site. */
const importedContact = (overrides = {}) => ({
  email: EMAIL,
  name: 'Dana Marsh',
  capturedByHostIds: [HOST],
  facets: {
    [HOST]: {
      sources: { import: true },
      interactions: [{ type: 'import', atMs: NOW - 5_000 }],
      lifecycleStage: 'lead',
      phone: '+15125550107',
      jobTitle: 'CMO',
      companyName: 'Acme Brands',
      tags: ['icp2', 'a-list'],
      notes: 'Met at the show',
      ownerUid: 'rep-uid',
    },
  },
  ...overrides,
})

describe('classifyContact', () => {
  it('reads a contact with nothing but a capture as a duplicate of a lead', () => {
    assert.deepEqual(classifyContact(importedContact()), { kind: 'duplicate-lead', reasons: [] })
    const fromForm = importedContact({
      facets: { [HOST]: { sources: { form: true }, interactions: [{ type: 'form', atMs: 1 }], lifecycleStage: 'lead' } },
    })
    assert.equal(classifyContact(fromForm).kind, 'duplicate-lead')
  })

  it('reads a member, a buyer, a subscriber, a deal or a stage past Lead as a relationship', () => {
    const cases = [
      [{ sources: { member: true }, lifecycleStage: 'lead' }, ['member']],
      [{ sources: { order: true } }, ['order']],
      [{ sources: { newsletter: true }, lifecycleStage: 'subscriber' }, ['newsletter', 'stage:subscriber']],
      [{ sources: { form: true }, ordersCount: 2 }, ['order']],
      [{ sources: { form: true }, lifecycleStage: 'sales-qualified' }, ['stage:sales-qualified']],
      [{ sources: { form: true }, lifecycleStage: 'customer' }, ['stage:customer']],
    ]
    for (const [facet, reasons] of cases) {
      const contact = importedContact({ facets: { [HOST]: { interactions: [], ...facet } } })
      assert.deepEqual(contactOwnReasons(contact), reasons, JSON.stringify(facet))
      assert.equal(classifyContact(contact).kind, 'relationship')
    }
    assert.deepEqual(classifyContact(importedContact(), { hasDeals: true }), { kind: 'relationship', reasons: ['deal'] })
  })

  it('leaves a row nothing can key', () => {
    assert.deepEqual(classifyContact({ email: 'nope' }), { kind: 'no-email', reasons: [] })
  })
})

describe('hostsForContact', () => {
  it('names every site that captured the person and every site a sequence enrolled them from, within the org', () => {
    const contact = { capturedByHostIds: ['site-1', 'site-9'], hostId: 'site-2' }
    assert.deepEqual(
      hostsForContact(contact, { orgHostIds: ['site-1', 'site-2', 'site-3'], enrollmentHostIds: ['site-3'] }),
      ['site-1', 'site-2', 'site-3'],
    )
  })
})

describe('foldContactIntoLead', () => {
  it('creates the lead from the contact where the site holds none, profile and consent carried', () => {
    const contact = importedContact({
      marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: NOW - 9_000 } },
    })
    const fold = foldContactIntoLead({ contact, existingLead: null, hostId: HOST, nowMs: NOW })
    assert.equal(fold.kind, 'create')
    assert.equal(fold.key, KEY)
    assert.deepEqual(fold.row, {
      email: EMAIL,
      name: 'Dana Marsh',
      phone: '+15125550107',
      jobTitle: 'CMO',
      company: 'Acme Brands',
      tags: ['icp2', 'a-list'],
      notes: 'Met at the show',
      ownerUid: 'rep-uid',
      status: 'new',
      sources: ['import'],
      submissionCount: 1,
      firstSeenAtMs: NOW - 5_000,
      lastSeenAtMs: NOW - 5_000,
      capturedByHostIds: [HOST],
      marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: NOW - 9_000 } },
      backfilledAtMs: NOW,
    })
  })

  it('spells a form capture by its forms, and a booking by its kind', () => {
    const contact = importedContact({
      formIds: ['f-1', 'f-2'],
      facets: { [HOST]: { sources: { form: true, booking: true }, interactions: [{ type: 'form', atMs: 1 }, { type: 'booking', atMs: 2 }] } },
    })
    const fold = foldContactIntoLead({ contact, existingLead: null, hostId: HOST, nowMs: NOW })
    assert.deepEqual(fold.row.sources, ['form:f-1', 'form:f-2', 'booking'])
    assert.equal(fold.row.submissionCount, 2)
  })

  it('fills only what the existing lead lacks, unions the tags, and never clears', () => {
    const existingLead = { email: EMAIL, name: 'D. Marsh', jobTitle: 'CMO', tags: ['warm'], ownerUid: 'other-rep', status: 'working' }
    const fold = foldContactIntoLead({ contact: importedContact(), existingLead, hostId: HOST, nowMs: NOW })
    assert.equal(fold.kind, 'merge')
    assert.deepEqual(fold.merge, {
      phone: '+15125550107',
      company: 'Acme Brands',
      tags: ['warm', 'icp2', 'a-list'],
      notes: 'Met at the show',
    })
  })

  it('carries the consent entry only where the lead has none, and answers unchanged when nothing is missing', () => {
    const consented = importedContact({ marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: 5 } } })
    const full = {
      email: EMAIL,
      name: 'Dana Marsh',
      phone: '+15125550107',
      jobTitle: 'CMO',
      company: 'Acme Brands',
      tags: ['icp2', 'a-list'],
      notes: 'Met at the show',
      ownerUid: 'rep-uid',
    }
    const carried = foldContactIntoLead({ contact: consented, existingLead: full, hostId: HOST, nowMs: NOW })
    assert.deepEqual(carried.merge, { [`marketingConsentByHost.${HOST}`]: { marketingConsent: true, marketingConsentAtMs: 5 } })
    const held = foldContactIntoLead({
      contact: consented,
      existingLead: { ...full, marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: 1 } } },
      hostId: HOST,
      nowMs: NOW,
    })
    assert.equal(held.kind, 'unchanged')
    // A refusal anywhere on the contact withholds the copy.
    const refused = importedContact({ marketingConsent: false, marketingConsentByHost: { [HOST]: { marketingConsent: true } } })
    assert.equal(foldContactIntoLead({ contact: refused, existingLead: full, hostId: HOST, nowMs: NOW }).kind, 'unchanged')
  })
})

describe('what follows the person', () => {
  const enrollments = [
    { id: 'seq-1_c-1', data: { contactId: 'c-1', hostId: HOST, target: 'contact' } },
    { id: 'seq-1_c-2', data: { contactId: 'c-2', hostId: HOST } },
    { id: `seq-2_${KEY}`, data: { leadId: KEY, target: 'lead', contactId: '' } },
  ]
  const activities = [
    { id: 'a-1', data: { contactId: 'c-1' } },
    { id: 'a-2', data: { leadId: KEY } },
    { id: 'a-3', data: { leadId: KEY, contactId: 'c-1' } },
  ]
  const tasks = [{ id: 't-1', data: { contactId: 'c-1' } }, { id: 't-2', data: { leadId: KEY } }]

  it('from a duplicate contact to its lead: enrollments re-target, activities and tasks swap the id', () => {
    assert.deepEqual(repointContactToLead({ contactId: 'c-1', key: KEY, enrollments, activities, tasks }), {
      enrollments: [{ id: 'seq-1_c-1', value: { target: 'lead', leadId: KEY, contactId: '' } }],
      // A row already naming the lead beside the contact drops the contact too.
      activities: [
        { id: 'a-1', value: { leadId: KEY, contactId: DELETE_FIELD } },
        { id: 'a-3', value: { leadId: KEY, contactId: DELETE_FIELD } },
      ],
      tasks: [{ id: 't-1', value: { leadId: KEY, contactId: DELETE_FIELD } }],
    })
  })

  it('from a closed lead to the contact: enrollments follow, rows already naming the contact are left', () => {
    assert.deepEqual(repointLeadToContact({ key: KEY, contactId: 'c-1', enrollments, activities, tasks }), {
      enrollments: [{ id: `seq-2_${KEY}`, value: { target: 'contact', contactId: 'c-1' } }],
      activities: [{ id: 'a-2', value: { contactId: 'c-1' } }],
      tasks: [{ id: 't-2', value: { contactId: 'c-1' } }],
    })
  })
})

describe('planContact', () => {
  const groupFor = (hostId) => hostId
  const plan = (contact, leadsByHost = new Map(), extra = {}) =>
    planContact({
      contactId: 'c-1',
      contact,
      orgHostIds: [HOST, 'site-2'],
      groupFor,
      leadsByHost,
      enrollments: [],
      activities: [],
      tasks: [],
      hasDeals: false,
      nowMs: NOW,
      ...extra,
    })

  it('folds a duplicate onto the site’s lead and deletes the contact', () => {
    const leadsByHost = new Map([[HOST, new Map([[KEY, { email: EMAIL, status: 'working' }]])]])
    const verdict = plan(importedContact(), leadsByHost, {
      enrollments: [{ id: 'seq-1_c-1', data: { contactId: 'c-1', hostId: HOST } }],
    })
    assert.equal(verdict.kind, 'duplicate-lead')
    assert.equal(verdict.deleteContact, true)
    assert.equal(verdict.hosts.length, 1)
    assert.equal(verdict.hosts[0].kind, 'merge')
    assert.deepEqual(verdict.follows.enrollments, [{ id: 'seq-1_c-1', value: { target: 'lead', leadId: KEY, contactId: '' } }])
  })

  it('creates the lead on a site that holds none, including a sequence’s site', () => {
    const verdict = plan(importedContact(), new Map(), {
      enrollments: [{ id: 'seq-1_c-1', data: { contactId: 'c-1', hostId: 'site-2' } }],
    })
    assert.deepEqual(verdict.hosts.map((host) => [host.hostId, host.kind]), [[HOST, 'create'], ['site-2', 'create']])
  })

  it('leaves a duplicate whose lead already converted onto another contact, and says so', () => {
    const leadsByHost = new Map([[HOST, new Map([[KEY, { email: EMAIL, status: 'qualified', convertedContactId: 'c-9' }]])]])
    const verdict = plan(importedContact(), leadsByHost)
    assert.equal(verdict.kind, 'converted-elsewhere')
    assert.equal(verdict.deleteContact, undefined)
  })

  it('keeps a relationship and closes every open lead for the address onto it', () => {
    const member = importedContact({ facets: { [HOST]: { sources: { member: true }, interactions: [], lifecycleStage: 'subscriber' } } })
    const leadsByHost = new Map([
      [HOST, new Map([[KEY, { email: EMAIL }]])],
      ['site-2', new Map([[KEY, { email: EMAIL, status: 'unqualified' }]])],
    ])
    const verdict = plan(member, leadsByHost, {
      enrollments: [{ id: `seq-1_${KEY}`, data: { leadId: KEY, target: 'lead', contactId: '' } }],
    })
    assert.equal(verdict.kind, 'relationship')
    assert.deepEqual(verdict.reasons, ['member', 'stage:subscriber'])
    assert.equal(verdict.hosts.length, 1)
    assert.deepEqual(verdict.hosts[0].stamp, {
      status: 'qualified',
      convertedContactId: 'c-1',
      convertedAtMs: NOW,
      convertedBy: 'backfill',
    })
    assert.deepEqual(verdict.hosts[0].follows.enrollments, [{ id: `seq-1_${KEY}`, value: { target: 'contact', contactId: 'c-1' } }])
    assert.equal(leadIsOpen({ status: 'unqualified' }), false)
  })
})

describe('the preconditions', () => {
  it('hold on this tree', () => {
    const verdict = preconditionsForTree(REPO_ROOT)
    assert.equal(verdict.ok, true, verdict.why)
  })

  it('refuse a tree without the one-record model', () => {
    assert.equal(preconditionsForTree('/nowhere').ok, false)
  })
})
