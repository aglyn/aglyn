/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The CRM for the Aglyn app (AGL-3622): leads in every status, contacts
 * held by the site with their stage and owner, companies, a Sales pipeline
 * with deals open, won and lost, and each record's activity log.
 *
 * Shapes are what the console's writers store under `orgs/{orgId}/…`:
 *
 * - every record carries the `CrmScoped` stamp — `hostId` and `visibleTo`,
 *   which `crmScopeTokens` makes `['host:{hostId}']` for a site alone, and
 *   which the rules prove each read by (`canReadScopedPeople`);
 * - leads and contacts are keyed by `personKey` (sha256 of the normalized
 *   address), as the capture door keys them, with `capturedByHostIds`;
 * - a contact's per-site fields live in its holder's facet
 *   (`facets.{groupId}`, the site's id for a site alone);
 * - every record carries the list fields its list queries
 *   (`crmLeadListFields`, `crmContactListFields`, `crmCompanyListFields`,
 *   `crmDealListFields`): `searchTokens`, `scopedSearchTokens`,
 *   `facetKeys`, `emailStatus`, the picklist keys, `titleLower`, and
 *   `nextTaskAtMs: null`, which every contact, company and deal is created
 *   carrying;
 * - the pipeline is the one `usePipeline` seeds: `default`, "Sales", the
 *   default stages, `isDefault`.
 *
 * The seeded owner's member row is written here too (idempotent; the same
 * row the other seeds write): the rules read it for every CRM read. A lead
 * status change or a note needs the org's plan to carry the CRM suite
 * (`plan` Starter or above on `orgs/{orgId}`), as in the console.
 */

import { createHash } from 'node:crypto'

/*
 * `crmSearchTokens` and `scopedSearchTokens` from
 * `libs/aglyn/src/lib/app-utils/crm.ts` and `name-search.ts`, restated:
 * every prefix (to twelve characters) of every word, an address's parts too,
 * and each joined to every scope token with `~`.
 */
const NAME_TOKEN_MAX_PREFIX = 12
const CRM_SEARCH_TOKENS_MAX = 200
const searchKey = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function searchTokens(values) {
  const tokens = new Set()
  const addWord = (word) => {
    const capped = word.slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      if (tokens.size >= CRM_SEARCH_TOKENS_MAX) return
      tokens.add(capped.slice(0, end))
    }
  }
  const addText = (text) => {
    const key = searchKey(text)
    if (!key) return
    for (const word of key.split(' ')) {
      if (!word) continue
      addWord(word)
      if (/[@.+_-]/.test(word)) for (const part of word.split(/[@.+_-]+/)) if (part) addWord(part)
    }
  }
  for (const value of values) {
    if (Array.isArray(value)) for (const entry of value) if (typeof entry === 'string') addText(entry)
    if (typeof value === 'string') addText(value)
  }
  return [...tokens]
}

const scoped = (visibleTo, tokens) => visibleTo.flatMap((scope) => tokens.map((token) => `${scope}~${token}`))

function searchFields(visibleTo, values) {
  const tokens = searchTokens(values)
  return { searchTokens: tokens, scopedSearchTokens: scoped(visibleTo, tokens) }
}

const personKey = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')
const picklistKey = (value) => (typeof value === 'string' && searchKey(value)) || null

/** `crmContactFacetKeys` for one holder: `{group}:{field}` and `{group}:{field}={value}`, also under `*`. */
function facetKeys(groupId, facet) {
  const keys = { any: new Set(), group: new Set() }
  const add = (field, raw) => {
    const value = typeof raw === 'string' ? searchKey(raw).slice(0, 120) : null
    if (!value) return
    for (const [bucket, group] of [['any', '*'], ['group', groupId]]) {
      keys[bucket].add(`${group}:${field}`)
      keys[bucket].add(`${group}:${field}=${value}`)
    }
  }
  add('owner', facet.ownerUid)
  add('stage', facet.lifecycleStage)
  add('company', facet.companyId)
  for (const [source, on] of Object.entries(facet.sources ?? {})) if (on) add('source', source)
  for (const tag of facet.tags ?? []) add('tag', tag)
  return [...keys.any, ...keys.group]
}

const DAY = 86_400_000

const DEFAULT_STAGES = [
  { id: 'prospecting', name: 'Prospecting', order: 0, probability: 10, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'qualification', name: 'Qualification', order: 1, probability: 10, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'needs-analysis', name: 'Needs Analysis', order: 2, probability: 20, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'value-proposition', name: 'Value Proposition', order: 3, probability: 50, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'id-decision-makers', name: 'Id. Decision Makers', order: 4, probability: 60, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'perception-analysis', name: 'Perception Analysis', order: 5, probability: 70, kind: 'open', forecastCategory: 'pipeline' },
  { id: 'proposal-price-quote', name: 'Proposal/Price Quote', order: 6, probability: 75, kind: 'open', forecastCategory: 'bestCase' },
  { id: 'negotiation-review', name: 'Negotiation/Review', order: 7, probability: 90, kind: 'open', forecastCategory: 'commit' },
  { id: 'won', name: 'Closed Won', order: 8, probability: 100, kind: 'won', forecastCategory: 'closed' },
  { id: 'lost', name: 'Closed Lost', order: 9, probability: 0, kind: 'lost', forecastCategory: 'omitted' },
]

export async function seedCrm({ put, uid, orgId, hostId, now }) {
  const nowMs = now.getTime()
  const at = (days) => new Date(nowMs - days * DAY)
  const visibleTo = [`host:${hostId}`]
  const stamp = { hostId, visibleTo }
  const root = `orgs/${orgId}`

  await put(`${root}/members/${uid}`, { uid, role: 'owner', allHosts: true, joinedAt: now })

  /* ---------- companies ---------- */
  const companies = [
    { id: 'co-northwind', name: 'Northwind Traders', domain: 'northwind.example', phone: '+1 555 0100', industry: 'Retail', owner: uid },
    { id: 'co-contoso', name: 'Contoso Coffee', domain: 'contoso.example', phone: '+1 555 0101', industry: 'Food & Beverage', owner: uid },
    { id: 'co-fabrikam', name: 'Fabrikam Studio', domain: 'fabrikam.example', phone: '+1 555 0102', industry: 'Design' },
    { id: 'co-tailspin', name: 'Tailspin Bikes', domain: 'tailspin.example', phone: '+1 555 0103', industry: 'Retail', owner: uid },
    { id: 'co-litware', name: 'Litware Books', domain: 'litware.example', industry: 'Publishing' },
    { id: 'co-adatum', name: 'Adatum Dental', domain: 'adatum.example', phone: '+1 555 0105', industry: 'Healthcare' },
  ]
  for (const [index, company] of companies.entries()) {
    await put(`${root}/companies/${company.id}`, {
      ...stamp,
      name: company.name,
      nameLower: searchKey(company.name),
      domain: company.domain,
      website: `https://${company.domain}`,
      ...(company.phone ? { phone: company.phone } : {}),
      industry: company.industry,
      ...(company.owner ? { ownerUid: company.owner } : {}),
      createdByUid: uid,
      contactsCount: 0,
      nextTaskAtMs: null,
      ...searchFields(visibleTo, [company.name, company.domain]),
      typeKey: null,
      industryKey: picklistKey(company.industry),
      ratingKey: null,
      accountSourceKey: null,
      createdAt: at(40 - index * 3),
      updatedAt: at(index),
    })
  }

  /* ---------- contacts ---------- */
  const contacts = [
    { email: 'grace.hopper@northwind.example', name: 'Grace Hopper', phone: '+1 555 0110', stage: 'customer', company: 'co-northwind', title: 'COO', owner: uid },
    { email: 'alan.turing@contoso.example', name: 'Alan Turing', phone: '+1 555 0111', stage: 'opportunity', company: 'co-contoso', title: 'Founder', owner: uid },
    { email: 'katherine.johnson@fabrikam.example', name: 'Katherine Johnson', stage: 'sales-qualified', company: 'co-fabrikam', title: 'Creative director' },
    { email: 'margaret.hamilton@tailspin.example', name: 'Margaret Hamilton', phone: '+1 555 0113', stage: 'lead', company: 'co-tailspin', owner: uid },
    { email: 'edsger@litware.example', name: 'Edsger Dijkstra', stage: 'subscriber', company: 'co-litware' },
    { email: 'barbara.liskov@adatum.example', name: 'Barbara Liskov', phone: '+1 555 0115', stage: 'customer', company: 'co-adatum', title: 'Practice manager' },
    { email: 'linus@example.test', name: 'Linus Torvalds', stage: 'marketing-qualified' },
  ]
  const contactIds = {}
  for (const [index, contact] of contacts.entries()) {
    const id = personKey(contact.email)
    contactIds[contact.email] = id
    const companyName = companies.find((company) => company.id === contact.company)?.name
    const facet = {
      sources: { form: true },
      interactions: [],
      lifecycleStage: contact.stage,
      ...(contact.phone ? { phone: contact.phone } : {}),
      ...(contact.title ? { jobTitle: contact.title } : {}),
      ...(contact.company ? { companyId: contact.company, companyName } : {}),
      ...(contact.owner ? { ownerUid: contact.owner } : {}),
    }
    await put(`${root}/contacts/${id}`, {
      ...stamp,
      email: contact.email,
      name: contact.name,
      sources: { form: true },
      interactions: [],
      capturedByHostIds: [hostId],
      facets: { [hostId]: facet },
      nextTaskAtMs: null,
      ...searchFields(visibleTo, [contact.name, contact.email]),
      facetKeys: facetKeys(hostId, facet),
      emailStatus: 'none',
      createdAt: at(60 - index * 5),
      updatedAt: at(index * 2),
    })
  }

  /* ---------- leads ---------- */
  const leads = [
    { email: 'ada@analytical.example', name: 'Ada Lovelace', phone: '+1 555 0120', company: 'Analytical Engines', title: 'Founder', status: 'new' },
    { email: 'charles@difference.example', name: 'Charles Babbage', company: 'Difference Works', status: 'working', owner: uid },
    { email: 'hedy@frequency.example', name: 'Hedy Lamarr', phone: '+1 555 0122', mobile: '+1 555 0222', company: 'Frequency Labs', status: 'nurturing' },
    { email: 'tim@web.example', name: 'Tim Berners-Lee', company: 'Web Foundry', title: 'CTO', status: 'working', owner: uid },
    { email: 'radia@spanning.example', name: 'Radia Perlman', phone: '+1 555 0124', company: 'Spanning Tree Co', status: 'new' },
    { email: 'dennis@unix.example', name: 'Dennis Ritchie', company: 'Bell Shop', status: 'unqualified', reason: 'No budget this year' },
    { email: 'frances@compilers.example', name: 'Frances Allen', company: 'Compiler Guild', status: 'qualified', owner: uid },
    { email: 'john@lisp.example', name: 'John McCarthy', status: 'new' },
  ]
  const STATUS_LABELS = { new: 'New', nurturing: 'Nurturing', working: 'Working', qualified: 'Qualified', unqualified: 'Unqualified' }
  const leadIds = []
  for (const [index, lead] of leads.entries()) {
    const id = personKey(lead.email)
    leadIds.push(id)
    await put(`${root}/leads/${id}`, {
      ...stamp,
      email: lead.email,
      name: lead.name,
      ...(lead.phone ? { phone: lead.phone } : {}),
      ...(lead.mobile ? { mobilePhone: lead.mobile } : {}),
      ...(lead.company ? { company: lead.company } : {}),
      ...(lead.title ? { jobTitle: lead.title } : {}),
      status: lead.status,
      statusLabel: STATUS_LABELS[lead.status],
      ...(lead.reason ? { unqualifiedReason: lead.reason } : {}),
      ...(lead.owner ? { ownerUid: lead.owner } : {}),
      capturedByHostIds: [hostId],
      firstSeenAtMs: nowMs - (30 - index) * DAY,
      lastSeenAtMs: nowMs - index * 3_600_000,
      ...searchFields(visibleTo, [lead.name, lead.email, lead.company, lead.title]),
      scopedCampaignIds: [],
      leadSourceKey: null,
      leadSourceDirection: null,
      emailStatus: 'none',
      industryKey: null,
      ratingKey: null,
      createdAt: at(30 - index),
      updatedAt: at(index / 4),
    })
  }

  /* ---------- the pipeline and its deals ---------- */
  await put(`${root}/pipelines/default`, {
    ...stamp,
    name: 'Sales',
    stages: DEFAULT_STAGES,
    isDefault: true,
    archivedAt: null,
    createdAt: at(90),
    updatedAt: at(90),
  })
  const contactOf = (email) => contactIds[email]
  const deals = [
    { id: 'deal-northwind', title: 'Northwind annual plan', cents: 1_250_000, stage: 'proposal-price-quote', company: 'co-northwind', contact: 'grace.hopper@northwind.example', close: 14 },
    { id: 'deal-contoso', title: 'Contoso espresso bar fit-out', cents: 480_000, stage: 'negotiation-review', company: 'co-contoso', contact: 'alan.turing@contoso.example', close: 5 },
    { id: 'deal-fabrikam', title: 'Fabrikam rebrand', cents: 900_000, stage: 'qualification', company: 'co-fabrikam', contact: 'katherine.johnson@fabrikam.example', close: 45 },
    { id: 'deal-tailspin', title: 'Tailspin spring catalog', cents: 215_000, stage: 'prospecting', company: 'co-tailspin', contact: 'margaret.hamilton@tailspin.example', close: 60 },
    { id: 'deal-adatum', title: 'Adatum booking site', cents: 360_000, status: 'won', stage: 'won', company: 'co-adatum', contact: 'barbara.liskov@adatum.example', closed: 6 },
    { id: 'deal-litware', title: 'Litware store launch', cents: 150_000, status: 'lost', stage: 'lost', company: 'co-litware', contact: 'edsger@litware.example', closed: 12, lost: 'Chose to wait until next year' },
  ]
  for (const [index, deal] of deals.entries()) {
    const status = deal.status ?? 'open'
    const contactId = contactOf(deal.contact)
    const stage = DEFAULT_STAGES.find((entry) => entry.id === deal.stage)
    await put(`${root}/deals/${deal.id}`, {
      ...stamp,
      title: deal.title,
      titleLower: searchKey(deal.title),
      pipelineId: 'default',
      stageId: deal.stage,
      status,
      amountCents: deal.cents,
      currency: 'usd',
      ownerUid: uid,
      contactId,
      companyId: deal.company,
      probability: stage.probability,
      forecastCategory: stage.forecastCategory,
      stageChangedAtMs: nowMs - (index + 2) * DAY,
      expectedCloseAtMs: deal.close ? nowMs + deal.close * DAY : null,
      closedAtMs: deal.closed ? nowMs - deal.closed * DAY : null,
      ...(deal.lost ? { lostReason: deal.lost } : {}),
      createdByUid: uid,
      nextTaskAtMs: null,
      ...searchFields(visibleTo, [deal.title]),
      typeKey: null,
      leadSourceKey: null,
      contactRoleContactIds: [contactId],
      scopedContactRoleContactIds: scoped(visibleTo, [contactId]),
      contactRoleKeys: [],
      createdAt: at(50 - index * 4),
      updatedAt: at(index),
    })
  }

  /* ---------- activity ---------- */
  const activities = [
    ['act-lead-1', { leadId: leadIds[0] }, 'note', 'Asked about the Pro plan on the pricing page chat.', 1],
    ['act-lead-2', { leadId: leadIds[1] }, 'call', 'Intro call. Wants a demo next week.', 2, { outcome: 'Connected', durationMinutes: 20, direction: 'outbound' }],
    ['act-lead-3', { leadId: leadIds[1] }, 'email', 'Sent the case study and pricing.', 1, { direction: 'outbound' }],
    ['act-lead-4', { leadId: leadIds[3] }, 'meeting', 'Discovery meeting with the web team.', 3, { durationMinutes: 45 }],
    ['act-contact-1', { contactId: contactOf('grace.hopper@northwind.example'), companyId: 'co-northwind' }, 'call', 'Renewal check-in. Happy with the store.', 4, { outcome: 'Connected', durationMinutes: 15, direction: 'inbound' }],
    ['act-contact-2', { contactId: contactOf('alan.turing@contoso.example'), companyId: 'co-contoso' }, 'note', 'Prefers text over email.', 6],
    ['act-company-1', { companyId: 'co-tailspin' }, 'note', 'Three locations; buying decisions made at head office.', 8],
    ['act-deal-1', { dealId: 'deal-northwind', contactId: contactOf('grace.hopper@northwind.example'), companyId: 'co-northwind' }, 'email', 'Sent the proposal for the annual plan.', 2, { direction: 'outbound' }],
    ['act-deal-2', { dealId: 'deal-contoso', contactId: contactOf('alan.turing@contoso.example'), companyId: 'co-contoso' }, 'meeting', 'Walked through the contract terms.', 1, { durationMinutes: 30 }],
  ]
  for (const [id, link, kind, body, daysAgo, extra] of activities) {
    await put(`${root}/crmActivities/${id}`, {
      ...stamp,
      kind,
      body,
      atMs: nowMs - daysAgo * DAY,
      ...link,
      ...(extra ?? {}),
      byUid: uid,
      byName: 'Mobile Owner',
      createdAt: at(daysAgo),
      updatedAt: at(daysAgo),
    })
  }
}
