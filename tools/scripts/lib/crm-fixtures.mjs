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

// The CRM's e2e fixtures (AGL-2610): one small business's book of contacts,
// the company, two pipelines and their deals, a catalog product, tasks,
// activity, custom fields, leads, audience and the two forms that sit around
// them — written by `seed-e2e.mjs` and re-written by the CRM specs under
// `tools/e2e/` when a spec has changed what it drove.
//
// ## One module, two callers
//
// The seed and the specs both need the same documents: the seed so a fresh
// emulator has a CRM to open, and a spec so a fixture it mutates — a lead it
// converts, two contacts it removes from the site, a record it deletes — comes
// back before the next run. A spec that carried its own copy of a contact
// would drift from the seeded one the moment somebody touched either, and the
// screenshot taken from one would show a different person than the docs
// describe. So the documents live here, and both callers write them through
// `seedCrmFixtures`.
//
// ## Plain `set`, not merge
//
// Every write here REPLACES the document. The rest of the seed merges, which
// is right for a fixture nothing mutates and wrong for these: a merge cannot
// remove the owner a spec assigned, the `convertedContactId` a conversion
// stamped, or the tag a bulk action added, so a merged re-seed would leave
// the second run starting from the first run's end state. Replacing is still
// idempotent — the same input yields the same document — which is the
// property the seed promises.
//
// ## The data looks like a business
//
// A bakery that roasts its own coffee and sells to the cafés, grocers and
// caterers around it. The people are that business's wholesale buyers, one
// retail subscriber, and the two inquiries it has not answered yet, because
// the screenshots the specs take feed the docs and the press kit, and a CRM
// full of "test test" tells a reader nothing about what the surface is for.
//
// ## What every record carries, and why
//
// - `visibleTo: ['host:demo']` — the token `crmScopeTokens` stamps for a site
//   whose org has declared no `defaultResourceScope`: the site alone. NOT
//   `['org']`, which the older seeded contacts use, because `planContactDetach`
//   counts `'org'` as a holder that remains, and a "remove from this site" on
//   an org-scoped row would leave the row in the list with its facet gone.
//   The host token is what a real capture on this site produces, and it is
//   what makes the detach a delete.
// - `facets.demo` — the holder's own profile. The CRM list, the record page
//   and the export all read THROUGH the viewing group's facet, so a contact
//   whose tags and stage sat at the top level would read as blank. The group
//   id is the host id, because the org declares no consent group.
// - `createdAt` as a real Timestamp spread over the last month, because the
//   reports count new contacts per week and the dashboard counts the week's,
//   and a seed that stamped everything "now" would draw one bar.
// - The fields every listener orders by: `updatedAt` (contacts, companies,
//   deals), `dueAtMs` (tasks), `atMs` (activities), `lastSeenAtMs` (leads).
//   A document missing its `orderBy` field is dropped from the query, which
//   is the seed invariant `docs/E2E_LOCAL.md` states.

import { Timestamp } from 'firebase-admin/firestore'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Mirrors `DEFAULT_DEAL_STAGES` in `libs/aglyn/src/lib/app-utils/crm.ts`. */
const DEFAULT_DEAL_STAGES = [
  { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
  { id: 'contact-made', name: 'Contact made', order: 1, probability: 20, kind: 'open' },
  { id: 'proposal-sent', name: 'Proposal sent', order: 2, probability: 40, kind: 'open' },
  { id: 'negotiation', name: 'Negotiation', order: 3, probability: 60, kind: 'open' },
  { id: 'won', name: 'Won', order: 4, probability: 100, kind: 'won' },
  { id: 'lost', name: 'Lost', order: 5, probability: 0, kind: 'lost' },
]

/**
 * The search keys a company document carries, as `nameSearchFields` writes
 * them — the lowercase name and every word prefix up to twelve characters.
 */
function nameSearchFields(name) {
  const nameLower = name.trim().replace(/\s+/g, ' ').toLowerCase()
  const tokens = new Set()
  for (const word of nameLower.split(' ')) {
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) tokens.add(capped.slice(0, end))
  }
  return { name, nameLower, nameTokens: [...tokens] }
}

/**
 * The fixture, by name, for the specs to address. Ids, addresses and the
 * text a spec asserts on all come from here so a rename lands in one place.
 */
export const CRM_FIXTURE = {
  /** The host whose facet every profile lives under. */
  hostId: 'demo',
  pipelineId: 'seed-crm-pipeline-sales',
  /** A second, non-default pipeline (AGL-2620): the switcher, the Pipelines dialog. */
  renewalsPipelineId: 'seed-crm-pipeline-renewals',
  renewalsPipelineName: 'Renewals',
  /** The one open deal in Renewals — the deal the products card is driven on. */
  renewalDealId: 'seed-crm-deal-littlefox-renewal',
  renewalDealTitle: 'Little Fox Café — annual renewal',
  /** Three more open Sales deals so the board has a card in every open stage. */
  boardDeals: {
    voss: { id: 'seed-crm-deal-voss', title: 'Voss & Co. — retail shelf trial', stageId: 'qualified', amountCents: 60_000 },
    northShore: {
      id: 'seed-crm-deal-northshore',
      title: 'North Shore Hotel — lobby coffee program',
      stageId: 'contact-made',
      amountCents: 180_000,
    },
    cedar: { id: 'seed-crm-deal-cedar', title: 'Cedar & Salt — event season catering', stageId: 'negotiation', amountCents: 120_000 },
  },
  /** The catalog product the products card's search finds (AGL-2620). */
  product: {
    id: 'seed-crm-product-house-blend',
    name: 'House blend, 5 lb bag',
    priceUsd: 45,
  },
  companyId: 'seed-crm-company-littlefox',
  companyName: 'Little Fox Café',
  companyDomain: 'littlefoxcafe.com',
  dealId: 'seed-crm-deal-littlefox',
  dealTitle: 'Little Fox Café — standing wholesale order',
  wonDealId: 'seed-crm-deal-harborline',
  wonDealTitle: 'Harborline Books — launch-night catering',
  overdueTaskId: 'seed-crm-task-call-maya',
  overdueTaskTitle: 'Call Maya about the spring roast lineup',
  upcomingTaskId: 'seed-crm-task-menu-theo',
  upcomingTaskTitle: 'Send Harborline the tasting menu',
  activityId: 'seed-crm-activity-call-maya',
  activityBody:
    'Walked through the spring lineup. Maya wants a sample of the Ethiopian ' +
    'natural before committing to the standing order.',
  /** The select field the record spec sets a value on. */
  roastField: {
    id: 'seed-crm-field-roast',
    key: 'preferred_roast',
    label: 'Preferred roast',
    options: ['Light', 'Medium', 'Dark'],
  },
  volumeField: {
    id: 'seed-crm-field-volume',
    key: 'weekly_volume_lb',
    label: 'Weekly volume (lb)',
  },
  listId: 'seed-crm-list-wholesale',
  listName: 'Wholesale accounts',
  /**
   * The site's forms, as the Leads section's note names them (AGL-2612,
   * AGL-2638): the inquiry that routes leads — the source the seeded lead
   * carries and the visit the wholesale contacts made — and the catering
   * inquiry that could route and does not, so the note has a switch to offer.
   */
  forms: {
    wholesale: { id: 'seed-wholesale-inquiry', name: 'Wholesale inquiry' },
    catering: { id: 'seed-catering-inquiry', name: 'Event catering inquiry' },
  },
  contacts: {
    /** The customer with a phone number: the search-by-digits target. */
    maya: {
      id: 'seed-crm-contact-maya',
      email: 'maya@littlefoxcafe.com',
      name: 'Maya Delgado',
      phone: '+15125550142',
    },
    theo: {
      id: 'seed-crm-contact-theo',
      email: 'theo@harborlinebooks.com',
      name: 'Theo Brandt',
    },
    priya: {
      id: 'seed-crm-contact-priya',
      email: 'priya.raman@gmail.com',
      name: 'Priya Raman',
    },
    /** The two rows the bulk bar spec ticks, acts on, and removes. */
    marcus: {
      id: 'seed-crm-contact-marcus',
      email: 'marcus@northshorehotel.com',
      name: 'Marcus Bell',
    },
    elena: {
      id: 'seed-crm-contact-elena',
      email: 'elena@vossandco.com',
      name: 'Elena Voss',
    },
    /** The record the contact-page spec edits and then deletes. */
    nadia: {
      id: 'seed-crm-contact-nadia',
      email: 'nadia@cedarandsalt.com',
      name: 'Nadia Farouk',
    },
  },
  leads: {
    /** The inquiry the leads spec converts — company suggested from its domain. */
    owen: {
      id: 'seed-crm-lead-copper-kettle',
      email: 'owen@copperkettlediner.com',
      name: 'Owen Whitfield',
      companyDomain: 'copperkettlediner.com',
    },
    /** The booking the leads spec works and then unqualifies. */
    june: {
      id: 'seed-crm-lead-riverbend',
      email: 'june@riverbendyoga.com',
      name: 'June Okafor',
    },
  },
}

/**
 * Writes every CRM fixture, replacing what is there.
 *
 * @param {object} options
 * @param {import('firebase-admin/firestore').Firestore} options.firestore
 * @param {string} options.orgId  The org whose `orgs/{orgId}/…` collections hold the CRM.
 * @param {string} options.hostId The site the records were captured on.
 * @param {string} options.ownerUid The workspace owner — assignee of the tasks, owner of the accounts.
 * @param {string} options.ownerName How the owner's name reads on a logged activity.
 * @param {string} options.teammateUid A second member, so the roster has somebody to hand a lead to.
 * @param {(ref: FirebaseFirestore.DocumentReference, data: object) => Promise<void>} [options.write]
 *   The writer, for a caller that counts or stamps writes. Defaults to a plain `set`.
 * @param {number} [options.nowMs] The clock the relative dates hang off.
 */
export async function seedCrmFixtures(options) {
  const {
    firestore,
    orgId,
    hostId,
    ownerUid,
    ownerName,
    teammateUid,
    nowMs = Date.now(),
    write = (ref, data) => ref.set(data),
  } = options
  const orgRef = firestore.collection('orgs').doc(orgId)
  const hostRef = firestore.collection('hosts').doc(hostId)
  const F = CRM_FIXTURE
  const groupId = hostId
  const visibleTo = [`host:${hostId}`]
  const at = (daysAgo, hoursAgo = 0) => nowMs - daysAgo * DAY_MS - hoursAgo * HOUR_MS
  const stamp = (ms) => Timestamp.fromMillis(ms)
  /**
   * One person: the shared identity at the top, this site's profile in the
   * facet, and the two search echoes (`phone`, `companyName`) the global
   * search reads off the top level because it never resolves a facet.
   */
  const contact = ({ id, email, name, phone, createdDaysAgo, facet, interactions }) => ({
    ref: orgRef.collection('contacts').doc(id),
    data: {
      email,
      name,
      sources: facet.sources,
      interactions,
      tags: facet.tags ?? [],
      capturedByHostIds: [hostId],
      visibleTo,
      hostId,
      ...(phone ? { phone } : {}),
      ...(facet.companyName ? { companyName: facet.companyName } : {}),
      facets: {
        [groupId]: {
          ...facet,
          ...(phone ? { phone } : {}),
          interactions,
        },
      },
      createdAt: stamp(at(createdDaysAgo)),
      updatedAt: stamp(at(createdDaysAgo, -1)),
    },
  })
  const formVisit = (daysAgo, summary, path) => ({
    type: 'form',
    atMs: at(daysAgo),
    summary,
    hostId,
    formId: F.forms.wholesale.id,
    path,
  })

  const contacts = [
    contact({
      ...F.contacts.maya,
      createdDaysAgo: 26,
      facet: {
        sources: { form: true, order: true },
        tags: ['wholesale', 'cafe'],
        notes:
          'Standing order every Tuesday: two cases of the house blend and a case ' +
          'of decaf. Prefers a lighter roast for the pour-over bar.',
        jobTitle: 'Owner',
        companyName: F.companyName,
        companyId: F.companyId,
        ownerUid,
        lifecycleStage: 'customer',
        ltvCents: 184_000,
        ordersCount: 12,
        lastPurchaseAtMs: at(2),
        firstPurchaseAtMs: at(24),
        custom: { [F.roastField.key]: 'Light', [F.volumeField.key]: 40 },
      },
      interactions: [
        { type: 'order', atMs: at(2), summary: 'Order #1041 — $312.00', hostId, refId: 'seed-order-1041' },
        formVisit(26, 'Wholesale inquiry', '/wholesale'),
      ],
    }),
    contact({
      ...F.contacts.theo,
      createdDaysAgo: 12,
      facet: {
        sources: { form: true },
        tags: ['events'],
        notes: 'Launch nights are the third Friday of the month: forty pastries and two airpots.',
        jobTitle: 'Events manager',
        companyName: 'Harborline Books',
        ownerUid: teammateUid,
        lifecycleStage: 'opportunity',
      },
      interactions: [formVisit(12, 'Event catering inquiry', '/catering')],
    }),
    contact({
      ...F.contacts.priya,
      createdDaysAgo: 5,
      facet: {
        sources: { newsletter: true },
        tags: ['newsletter'],
        lifecycleStage: 'subscriber',
      },
      interactions: [
        { type: 'newsletter', atMs: at(5), summary: 'Subscribed to the roast calendar', hostId, path: '/' },
      ],
    }),
    contact({
      ...F.contacts.marcus,
      createdDaysAgo: 3,
      facet: {
        sources: { form: true },
        tags: ['wholesale'],
        jobTitle: 'Food & beverage director',
        companyName: 'North Shore Hotel',
        lifecycleStage: 'lead',
      },
      interactions: [formVisit(3, 'Wholesale inquiry', '/wholesale')],
    }),
    contact({
      ...F.contacts.elena,
      createdDaysAgo: 9,
      facet: {
        sources: { form: true },
        tags: ['wholesale', 'retail'],
        jobTitle: 'Buyer',
        companyName: 'Voss & Co. Grocers',
        lifecycleStage: 'marketing-qualified',
      },
      interactions: [formVisit(9, 'Wholesale inquiry', '/wholesale')],
    }),
    contact({
      ...F.contacts.nadia,
      createdDaysAgo: 1,
      facet: {
        sources: { form: true },
        tags: ['catering'],
        jobTitle: 'Catering lead',
        companyName: 'Cedar & Salt Catering',
        lifecycleStage: 'sales-qualified',
      },
      interactions: [formVisit(1, 'Event catering inquiry', '/catering')],
    }),
  ]
  for (const { ref, data } of contacts) await write(ref, data)

  await write(orgRef.collection('companies').doc(F.companyId), {
    ...nameSearchFields(F.companyName),
    domain: F.companyDomain,
    website: `https://${F.companyDomain}`,
    phone: F.contacts.maya.phone,
    industry: 'Café',
    ownerUid,
    notes: 'Two locations; the second opens a pour-over bar this spring.',
    createdByUid: ownerUid,
    visibleTo,
    hostId,
    createdAt: stamp(at(26)),
    updatedAt: stamp(at(26)),
  })

  await write(orgRef.collection('pipelines').doc(F.pipelineId), {
    name: 'Sales',
    stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
    isDefault: true,
    archivedAt: null,
    visibleTo,
    hostId,
    createdAt: stamp(at(30)),
    updatedAt: stamp(at(30)),
  })
  await write(orgRef.collection('pipelines').doc(F.renewalsPipelineId), {
    name: F.renewalsPipelineName,
    stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
    isDefault: false,
    archivedAt: null,
    visibleTo,
    hostId,
    createdAt: stamp(at(15)),
    updatedAt: stamp(at(15)),
  })

  const deal = (id, title, fields) => ({
    ref: orgRef.collection('deals').doc(id),
    data: {
      title,
      titleLower: title.toLowerCase(),
      pipelineId: F.pipelineId,
      currency: 'usd',
      createdByUid: ownerUid,
      visibleTo,
      hostId,
      ...fields,
    },
  })
  const deals = [
    deal(F.dealId, F.dealTitle, {
      stageId: 'proposal-sent',
      status: 'open',
      amountCents: 240_000,
      expectedCloseAtMs: at(-14),
      stageChangedAtMs: at(3),
      ownerUid,
      contactId: F.contacts.maya.id,
      companyId: F.companyId,
      notes: 'Weekly delivery, net 30. Proposal covers both locations.',
      createdAt: stamp(at(20)),
      updatedAt: stamp(at(3)),
    }),
    deal(F.wonDealId, F.wonDealTitle, {
      stageId: 'won',
      status: 'won',
      amountCents: 85_000,
      closedAtMs: at(5),
      stageChangedAtMs: at(5),
      ownerUid: teammateUid,
      contactId: F.contacts.theo.id,
      createdAt: stamp(at(11)),
      updatedAt: stamp(at(5)),
    }),
    // One card in each open stage of Sales (AGL-2620), with expected
    // closes spread across the coming months and one left undated, so the
    // forecast by close month has a row of every kind.
    deal(F.boardDeals.voss.id, F.boardDeals.voss.title, {
      stageId: F.boardDeals.voss.stageId,
      status: 'open',
      amountCents: F.boardDeals.voss.amountCents,
      expectedCloseAtMs: at(-40),
      stageChangedAtMs: at(6),
      ownerUid,
      contactId: F.contacts.elena.id,
      createdAt: stamp(at(8)),
      updatedAt: stamp(at(6)),
    }),
    deal(F.boardDeals.northShore.id, F.boardDeals.northShore.title, {
      stageId: F.boardDeals.northShore.stageId,
      status: 'open',
      amountCents: F.boardDeals.northShore.amountCents,
      stageChangedAtMs: at(2),
      ownerUid: teammateUid,
      contactId: F.contacts.marcus.id,
      createdAt: stamp(at(3)),
      updatedAt: stamp(at(2)),
    }),
    deal(F.boardDeals.cedar.id, F.boardDeals.cedar.title, {
      stageId: F.boardDeals.cedar.stageId,
      status: 'open',
      amountCents: F.boardDeals.cedar.amountCents,
      expectedCloseAtMs: at(-75),
      stageChangedAtMs: at(1),
      ownerUid,
      contactId: F.contacts.nadia.id,
      createdAt: stamp(at(1)),
      updatedAt: stamp(at(1)),
    }),
    // The Renewals pipeline's one open deal: no line items yet, so the
    // products card starts empty and the amount is typed.
    {
      ...deal(F.renewalDealId, F.renewalDealTitle, {
        stageId: 'qualified',
        status: 'open',
        amountCents: 250_000,
        expectedCloseAtMs: at(-150),
        stageChangedAtMs: at(4),
        ownerUid,
        contactId: F.contacts.maya.id,
        companyId: F.companyId,
        createdAt: stamp(at(4)),
        updatedAt: stamp(at(4)),
      }),
    },
  ]
  deals[deals.length - 1].data.pipelineId = F.renewalsPipelineId
  for (const { ref, data } of deals) await write(ref, data)

  // A catalog product on the host (AGL-2620), keyed the way the products
  // hub writes it — `productSearchFields` — so the deal page's catalog
  // search finds it by a name-token prefix among active products.
  await write(hostRef.collection('products').doc(F.product.id), {
    ...nameSearchFields(F.product.name),
    nameReversed: F.product.name.trim().replace(/\s+/g, ' ').toLowerCase().split('').reverse().join(''),
    slug: 'house-blend-5-lb-bag',
    description: 'Five pounds of the house blend, whole bean.',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: F.product.priceUsd, inventory: null }],
    createdAtMs: at(60),
    updatedAtMs: at(60),
    deletedAt: null,
  })

  const task = (id, title, fields) => ({
    ref: orgRef.collection('crmTasks').doc(id),
    data: {
      title,
      status: 'open',
      assigneeUid: ownerUid,
      createdByUid: ownerUid,
      visibleTo,
      hostId,
      ...fields,
    },
  })
  const tasks = [
    // Due YESTERDAY, so the dashboard card and the reports count one overdue.
    task(F.overdueTaskId, F.overdueTaskTitle, {
      kind: 'call',
      priority: 'high',
      dueAtMs: at(1, 3),
      contactId: F.contacts.maya.id,
      dealId: F.dealId,
      notes: 'She asked for the Ethiopian natural and the new decaf.',
      createdAt: stamp(at(4)),
      updatedAt: stamp(at(4)),
    }),
    task(F.upcomingTaskId, F.upcomingTaskTitle, {
      kind: 'email',
      priority: 'normal',
      dueAtMs: at(-3),
      contactId: F.contacts.theo.id,
      createdAt: stamp(at(2)),
      updatedAt: stamp(at(2)),
    }),
  ]
  for (const { ref, data } of tasks) await write(ref, data)

  const activity = (id, fields) => ({
    ref: orgRef.collection('crmActivities').doc(id),
    data: { byUid: ownerUid, byName: ownerName, visibleTo, hostId, ...fields },
  })
  const activities = [
    activity(F.activityId, {
      kind: 'call',
      body: F.activityBody,
      atMs: at(2, 4),
      contactId: F.contacts.maya.id,
      dealId: F.dealId,
      outcome: 'Agreed to a tasting',
      durationMinutes: 15,
      createdAt: stamp(at(2, 4)),
      updatedAt: stamp(at(2, 4)),
    }),
    activity('seed-crm-activity-note-theo', {
      kind: 'note',
      body: 'Launch night is the third Friday of the month — forty pastries and two airpots.',
      atMs: at(1, 6),
      contactId: F.contacts.theo.id,
      createdAt: stamp(at(1, 6)),
      updatedAt: stamp(at(1, 6)),
    }),
  ]
  for (const { ref, data } of activities) await write(ref, data)

  const field = ({ id, key, label, options }, type, order) => ({
    ref: orgRef.collection('contactFields').doc(id),
    data: {
      key,
      label,
      type,
      ...(options ? { options } : {}),
      order,
      // `null`, not absent: a `where('retiredAt', '==', null)` finds it.
      retiredAt: null,
      visibleTo,
      hostId,
      createdAt: stamp(at(28)),
      updatedAt: stamp(at(28)),
    },
  })
  for (const { ref, data } of [
    field(F.roastField, 'select', 0),
    field(F.volumeField, 'number', 1),
  ]) {
    await write(ref, data)
  }

  // A live audience: the bulk bar's "Add to list" picker offers it, and a
  // dynamic list is the case the dialog explains ("whoever you add stays").
  await write(orgRef.collection('lists').doc(F.listId), {
    name: F.listName,
    kind: 'dynamic',
    rule: { sources: ['contacts'], tags: ['wholesale'] },
    createdAt: stamp(at(20)),
    updatedAt: stamp(at(20)),
  })

  /*
   * Two leads, as `addHostLead` writes them: no `status`, no owner, nothing
   * the CRM has stamped yet. The section reads an absent status as New.
   */
  const lead = ({ id, email, name }, source, fields) => ({
    ref: hostRef.collection('leads').doc(id),
    data: {
      email,
      name,
      source,
      sources: [source],
      submissionCount: 1,
      capturedByHostIds: [hostId],
      ...fields,
    },
  })
  const leads = [
    lead(F.leads.owen, 'form:seed-wholesale-inquiry', {
      firstSeenAtMs: at(0, 3),
      lastSeenAtMs: at(0, 3),
      createdAt: stamp(at(0, 3)),
      updatedAt: stamp(at(0, 3)),
    }),
    lead(F.leads.june, 'booking', {
      firstSeenAtMs: at(1, 2),
      lastSeenAtMs: at(1, 2),
      createdAt: stamp(at(1, 2)),
      updatedAt: stamp(at(1, 2)),
    }),
  ]
  for (const { ref, data } of leads) await write(ref, data)

  /*
   * The two forms those visits and that lead's source name, as the form
   * route stores one: the published field list, the consent field the author
   * declared, and `routing.lead` on the inquiry that files leads. Both carry
   * an email field and a consent field, so the note's verdict on the one
   * that does not route is "could" — the switch is offered, not refused.
   */
  const form = ({ id, name }, slug, routing) => ({
    ref: hostRef.collection('forms').doc(id),
    data: {
      displayName: name,
      slug,
      fields: [
        { fieldName: 'name', fieldType: 'text', label: 'Name' },
        { fieldName: 'email', fieldType: 'email', label: 'Email', required: true },
        { fieldName: 'message', fieldType: 'text', label: 'Message' },
        { fieldName: 'marketingConsent', fieldType: 'checkbox', label: 'Send me the roast calendar' },
      ],
      consentFieldName: 'marketingConsent',
      routing,
      hostId,
      createdAt: stamp(at(40)),
      updatedAt: stamp(at(40)),
    },
  })
  const forms = [
    form(F.forms.wholesale, 'wholesale', { lead: true }),
    form(F.forms.catering, 'catering', {}),
  ]
  for (const { ref, data } of forms) await write(ref, data)
}

/**
 * Removes what a lead's conversion created, so the conversion can be driven
 * again: the contact at the lead's address, every company at its domain, and
 * every deal that pointed at one of those contacts.
 *
 * By address and domain rather than by id, because the convert route mints
 * the ids — the contact's is a hash of the address, the company's and the
 * deal's are auto-ids — and a spec cannot know them before it has run.
 */
export async function removeLeadConversionArtifacts(firestore, orgId, lead) {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const contacts = await orgRef.collection('contacts').where('email', '==', lead.email).get()
  const contactIds = contacts.docs.map((entry) => entry.id)
  for (const entry of contacts.docs) await entry.ref.delete()
  if (lead.companyDomain) {
    const companies = await orgRef
      .collection('companies')
      .where('domain', '==', lead.companyDomain)
      .get()
    for (const entry of companies.docs) await entry.ref.delete()
  }
  for (const contactId of contactIds) {
    const deals = await orgRef.collection('deals').where('contactId', '==', contactId).get()
    for (const entry of deals.docs) await entry.ref.delete()
  }
}

/** Deletes every contact at an address — what a spec that creates one runs first. */
export async function removeContactsAtAddress(firestore, orgId, email) {
  const contacts = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('contacts')
    .where('email', '==', email)
    .get()
  for (const entry of contacts.docs) await entry.ref.delete()
}

/**
 * Removes every contact the site captured that is not the fixture's, with
 * the deals that pointed at them.
 *
 * The specs share one site and each re-seeds the fixture, but a re-seed
 * writes the fixture's records and leaves what the other specs added: a
 * lead's conversion, a contact added by hand. A spec that reads a fixture
 * row off a paged list needs the site's book to be the fixture's book —
 * the fixture's rows are its oldest, and a list sorted newest-first pages
 * them off the screen behind the newcomers.
 *
 * Keyed on `capturedByHostIds`, the mark every site-captured contact
 * carries, so the org-scoped contacts the console seed writes with no site
 * — which are not this site's and which other suites read — stay.
 */
export async function removeSiteContactsOutsideFixture(firestore, orgId, hostId) {
  const fixtureIds = new Set(Object.values(CRM_FIXTURE.contacts).map((contact) => contact.id))
  const orgRef = firestore.collection('orgs').doc(orgId)
  const captured = await orgRef
    .collection('contacts')
    .where('capturedByHostIds', 'array-contains', hostId)
    .get()
  for (const entry of captured.docs) {
    if (fixtureIds.has(entry.id)) continue
    const deals = await orgRef.collection('deals').where('contactId', '==', entry.id).get()
    for (const deal of deals.docs) await deal.ref.delete()
    await entry.ref.delete()
  }
}
