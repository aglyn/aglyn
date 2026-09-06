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

// The decision half of `backfill-crm-lifecycle-stages.mjs` (AGL-2631).
//
// Three derivations, each pure so the sibling test can drive every case
// without a database, and each a restatement of a rule the tree already
// applies at capture time:
//
//   1. THE STAGE FLOOR. AGL-2612 made every capture door name the earliest
//      lifecycle stage that describes what just happened — an order makes a
//      customer, a form or a booking request makes a lead, a sign-up or a
//      newsletter opt-in makes a subscriber — and apply it through
//      `advanceContactLifecycleStage`, which never moves anybody back. The
//      people captured BEFORE that rule shipped carry no stage on any facet.
//      `planFacetStages` reads each facet's `sources` (the record of which
//      surfaces met the person) and derives the same floor the doors would
//      have written on the day.
//
//   2. THE HISTORICAL LEAD. A lead surface — a form whose author switched
//      `routing.lead` on, or a booking request — files a row at
//      `hosts/{hostId}/leads/{personKey}` today. A person who submitted such
//      a form before routing existed, or before it was switched on, landed
//      in Contacts and never in the Leads queue. `planLeadForHost` finds the
//      evidence on the contact's timeline and plans the row `addHostLead`
//      would have written, with `status: 'new'` and nobody working it.
//      A form that was never routed is a lead surface only under
//      `--any-form` (`hostLeadContext`'s `anyForm`): the backlog from before
//      lead routing existed came in through forms nobody could have switched
//      on, and several of those forms are gone — known now only through the
//      submissions they left behind.
//
//   3. THE COMPANY COUNT. AGL-2613 keeps `contactsCount` on a company by
//      `increment` alongside every link, so a link made before the counter
//      existed was never counted. `planCompanyCounts` re-derives the figure
//      from the mirror the counter is defined over and reports the drift.
//
// ## The restatements are guarded, not trusted
//
// This is a plain module and the helpers it mirrors are TypeScript, so
// nothing here can import them. What CAN be checked is that the tree still
// says what this file assumes: the stage list in the same order, the doors
// still naming their floors, the person key still derived the same way, the
// field names still spelled the same. `preconditionsForTree` reads the
// sources and answers, and the runner refuses `--apply` on a disagreement —
// a backfill that fills a field nothing maintains going forward reports
// success on the day and is wrong from the next capture on.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*==========================================
 * WHAT THE TREE SAYS, RESTATED.
 *=========================================*/

/** `CONTACT_LIFECYCLE_STAGES` in `crm.ts` — order is the whole contract. */
export const CONTACT_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing-qualified',
  'sales-qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
]

/** The field names this script reads and writes, as the tree spells them. */
export const FIELDS = {
  facets: 'facets',
  capturedByHostIds: 'capturedByHostIds',
  formIds: 'formIds',
  companyIds: 'companyIds',
  contactsCount: 'contactsCount',
  marketingConsent: 'marketingConsent',
  marketingConsentByHost: 'marketingConsentByHost',
}

/** The `reason` an erasure row on `hosts/{hostId}/suppressions` carries. */
export const HOST_ERASURE_SUPPRESSION_REASON = 'erasure'

/** The status a lead nobody has touched reads as, written explicitly here. */
export const LEAD_STATUS_NEW = 'new'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `normalizeContactEmail`, restated: trimmed, lowercased, or `null`. */
export function normalizeEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

/** `personKey`, restated: the full sha256 of the normalized address. */
export function personKey(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * `extractEmailFromFields`, restated: a key mentioning "email" first, then
 * the first value that is an address at all. Read off a submission's
 * `fields`, which is what the submit route handed the capture door.
 */
export function emailFromSubmissionFields(fields) {
  const entries = Object.entries(fields ?? {})
  const preferred = entries.find(([key]) => /email/i.test(key))
  const fromPreferred = normalizeEmail(preferred?.[1])
  if (fromPreferred) return fromPreferred
  for (const [, value] of entries) {
    const email = normalizeEmail(value)
    if (email) return email
  }
  return null
}

export function isStage(value) {
  return typeof value === 'string' && CONTACT_LIFECYCLE_STAGES.includes(value)
}

/** Position in the progression; `-1` for anything that is not a stage. */
export function stageIndex(stage) {
  return CONTACT_LIFECYCLE_STAGES.indexOf(stage)
}

/**
 * `advanceContactLifecycleStage`, restated. The floor for a person who had
 * no stage or an earlier one; the stage they already had otherwise. A stored
 * value that is not a stage reads as absent.
 */
export function advanceStage(current, floor) {
  const held = isStage(current) ? current : undefined
  if (!floor) return held
  if (!held) return floor
  return stageIndex(held) < stageIndex(floor) ? floor : held
}

/*==========================================
 * 1. THE STAGE FLOOR A FACET'S EVIDENCE IMPLIES.
 *=========================================*/

/**
 * The earliest stage that describes how this holder met the person, from
 * the facet's own record of it — the same table the doors apply, read off
 * what the doors left behind.
 *
 * Money beats everything: an `order` source, or a purchase figure on the
 * facet, is a customer whatever else they did. A paid booking is the case
 * the figure catches — the request-time capture wrote `booking` and the
 * payment webhook wrote `purchaseCents` onto the same facet, so a booking
 * with money against it is a customer and one without is a lead. Then the
 * two lead surfaces, then the two subscriber surfaces. A facet met only by
 * hand, by import or over the API implies nothing: those doors take the
 * caller's stage or none, and "none" is what they meant.
 */
export function lifecycleFloorForFacet(facet) {
  const sources = facet?.sources ?? {}
  if (
    sources.order === true ||
    Number(facet?.ordersCount ?? 0) > 0 ||
    Number(facet?.ltvCents ?? 0) > 0
  ) {
    return 'customer'
  }
  if (sources.form === true || sources.booking === true) return 'lead'
  if (sources.member === true || sources.newsletter === true) return 'subscriber'
  return null
}

/**
 * The stage a facet will hold once the backfill has run: the one it holds,
 * or the floor its evidence implies, or nothing.
 */
export function facetStageAfterBackfill(facet) {
  return advanceStage(facet?.lifecycleStage, lifecycleFloorForFacet(facet))
}

/**
 * What one contact document needs, facet by facet.
 *
 * Only a facet WITHOUT a usable stage is planned: a stage somebody set, or a
 * door already wrote, stands whatever the evidence says — that is the
 * never-downgrade rule, and a customer who once filled in a form must not
 * come back as a lead. A stored value that is not a stage at all is
 * replaced, exactly as a door would replace it, and counted separately so
 * the report can say it happened.
 */
export function planFacetStages(contact) {
  const facets = readFacets(contact)
  const plan = { writes: [], held: 0, noEvidence: 0, noFacets: false }
  const entries = Object.entries(facets)
  if (!entries.length) {
    plan.noFacets = true
    return plan
  }
  for (const [groupId, facet] of entries) {
    if (isStage(facet.lifecycleStage)) {
      plan.held += 1
      continue
    }
    const floor = lifecycleFloorForFacet(facet)
    if (!floor) {
      plan.noEvidence += 1
      continue
    }
    plan.writes.push({
      groupId,
      path: `${FIELDS.facets}.${groupId}.lifecycleStage`,
      stage: floor,
      replacedUnusable:
        facet.lifecycleStage !== undefined && facet.lifecycleStage !== null,
    })
  }
  return plan
}

/*==========================================
 * 2. THE LEAD A HOST'S SURFACES SHOULD HAVE FILED.
 *=========================================*/

/**
 * What one holder's facet says about this host's lead surfaces.
 *
 * A form capture is attributed by the FORM, because a form id is minted
 * under one site: an interaction naming a lead-surface form of this host is
 * this host's, whichever facet holds it. An interaction that predates the form
 * entity carries no `formId` — the submission it names does, once
 * `backfill-form-ids` has stamped it — so the id is joined through the
 * host's own submissions by `refId`. The top-level `formIds` mirror is read
 * beside the timeline for the person whose oldest captures the timeline's
 * cap has already dropped.
 *
 * A booking is attributed by the interaction's `hostId`. One written before
 * that field existed is taken as this host's only when the facet IS this
 * host's group of one — a shared facet cannot say which site of the group
 * took the booking, and a guess would file a lead under the wrong site.
 */
export function facetEvidenceForHost(groupId, facet, host) {
  const evidence = { formIds: new Set(), bookings: 0, atMs: [] }
  for (const interaction of facet?.interactions ?? []) {
    if (!interaction || typeof interaction !== 'object') continue
    const at = Number(interaction.atMs)
    if (interaction.type === 'form') {
      const formId =
        interaction.formId ??
        (interaction.refId ? host.formIdByRef.get(String(interaction.refId)) : undefined)
      if (formId && host.leadSurfaceFormIds.has(formId)) {
        evidence.formIds.add(formId)
        if (Number.isFinite(at)) evidence.atMs.push(at)
      }
    } else if (interaction.type === 'booking') {
      const here = interaction.hostId
        ? interaction.hostId === host.hostId
        : groupId === host.hostId
      if (here) {
        evidence.bookings += 1
        if (Number.isFinite(at)) evidence.atMs.push(at)
      }
    }
  }
  return evidence
}

/**
 * Whether this site captured the person at all, by the same two fields the
 * org view reads: the growing attribution array, and the scalar first-host
 * stamp every row has carried since the collection existed.
 */
export function contactCapturedByHost(contact, hostId) {
  const captured = contact?.[FIELDS.capturedByHostIds]
  return (
    (Array.isArray(captured) && captured.includes(hostId)) ||
    contact?.hostId === hostId
  )
}

/**
 * The lead one host should hold for one contact, or why it holds none.
 *
 * The verdicts, in the order they are reached:
 *
 *  - `no-email` — a row the key cannot be derived from is left, never keyed
 *    by a guess.
 *  - `not-captured-here` — the ordinary case for a contact against a site
 *    that never met them; not reported per row.
 *  - `no-lead-surface` — the site met them, but through nothing that files
 *    a lead: a form without lead routing, an order, a newsletter opt-in.
 *    Turning routing on and re-running, or running with `anyForm`, is what
 *    changes this verdict for the form; nothing changes it for the rest.
 *  - `erased` — the site's suppression list carries an erasure for the
 *    address. The person asked to be forgotten; nothing is rebuilt.
 *  - `already-a-lead` — a row exists under the person key, or under an
 *    older auto-id carrying the same address. Never overwritten.
 *  - `beyond-lead` — the holder's facet already stands past Lead:
 *    marketing-qualified onward, customers included. Somebody has worked
 *    this person, and a queue entry saying nobody has would be false.
 *
 * Everything else is a row to create.
 */
export function planLeadForHost({ contactId, contact, host }) {
  const email = normalizeEmail(contact?.email)
  const key = personKey(email)
  if (!email || !key) return { kind: 'skip', reason: 'no-email', contactId }

  const facets = readFacets(contact)
  const formIds = new Set()
  let bookings = 0
  const atMs = []
  let highest = -1
  let name
  for (const [groupId, facet] of Object.entries(facets)) {
    const evidence = facetEvidenceForHost(groupId, facet, host)
    if (!evidence.formIds.size && !evidence.bookings) continue
    for (const id of evidence.formIds) formIds.add(id)
    bookings += evidence.bookings
    atMs.push(...evidence.atMs)
    highest = Math.max(highest, stageIndex(facetStageAfterBackfill(facet)))
    if (!name && typeof facet.name === 'string' && facet.name.trim()) {
      name = facet.name.trim()
    }
  }
  // The mirror, for a timeline whose oldest captures were dropped at the cap.
  const mirrored = contact?.[FIELDS.formIds]
  if (Array.isArray(mirrored)) {
    for (const id of mirrored) {
      if (host.leadSurfaceFormIds.has(String(id))) formIds.add(String(id))
    }
  }
  if (!formIds.size && !bookings) {
    return {
      kind: 'skip',
      reason: contactCapturedByHost(contact, host.hostId)
        ? 'no-lead-surface'
        : 'not-captured-here',
      contactId,
    }
  }
  if (host.erasedKeys.has(key)) return { kind: 'skip', reason: 'erased', contactId }
  if (host.leadKeys.has(key) || host.leadEmails.has(email)) {
    return { kind: 'skip', reason: 'already-a-lead', contactId }
  }
  if (highest > stageIndex('lead')) {
    return {
      kind: 'skip',
      reason: 'beyond-lead',
      stage: CONTACT_LIFECYCLE_STAGES[highest],
      contactId,
    }
  }
  const row = leadRowForContact({
    contact,
    email,
    name: name ?? (typeof contact?.name === 'string' ? contact.name.trim() : ''),
    hostId: host.hostId,
    formIds: [...formIds].sort(),
    bookings,
    atMs,
    submissionCount:
      (host.submissionsByEmail.get(email) ?? 0) + bookings,
    nowMs: host.nowMs,
  })
  return { kind: 'create', key, row, contactId }
}

/**
 * The document `addHostLead` would have written, minus the working state
 * nobody has given it yet.
 *
 * `sources` spells each surface the way the doors do — `form:{formId}` and
 * `booking` — so the Leads list resolves the form's name the same way for a
 * historical row as for a live one. `submissionCount` is the submissions
 * this host's routed forms hold for the address plus the bookings, and never
 * below one: a lead exists because at least one capture did. The seen
 * bracket comes from the captures themselves, falling back to the row's own
 * creation when the timeline kept no timestamp for them. No `ownerUid`: the
 * site's default owner and the round-robin apply to captures as they
 * arrive, and a queue of old leads handed to whoever is next up today would
 * be an assignment nobody decided.
 *
 * The consent the contact holds for THIS host rides along when it is a
 * grant. Copied, not re-derived: the entry records what the person was
 * shown when they agreed. A refusal anywhere on the record withholds the
 * copy — a refusal is honored across the whole group the contact was
 * captured under, and the lead's own reader sees only this host's entry.
 *
 * `backfilledAtMs` marks the row as this script's, so a later reader can
 * tell a queue entry the doors wrote from one reconstructed here.
 */
export function leadRowForContact({
  contact,
  email,
  name,
  hostId,
  formIds,
  bookings,
  atMs,
  submissionCount,
  nowMs,
}) {
  const seen = atMs.filter((at) => Number.isFinite(at))
  const createdAtMs = timestampMs(contact?.createdAt)
  const firstSeenAtMs = seen.length
    ? Math.min(...seen)
    : (createdAtMs ?? nowMs)
  const lastSeenAtMs = seen.length ? Math.max(...seen) : firstSeenAtMs
  const consent = grantedConsentEntry(contact, hostId)
  return {
    email,
    ...(name ? { name: name.slice(0, 120) } : {}),
    status: LEAD_STATUS_NEW,
    sources: [
      ...formIds.map((formId) => `form:${formId}`),
      ...(bookings > 0 ? ['booking'] : []),
    ],
    submissionCount: Math.max(1, submissionCount),
    firstSeenAtMs,
    lastSeenAtMs,
    [FIELDS.capturedByHostIds]: [hostId],
    ...(consent
      ? { [FIELDS.marketingConsentByHost]: { [hostId]: consent } }
      : {}),
    backfilledAtMs: nowMs,
  }
}

/**
 * The contact's grant for this host, when the record reads as granted and
 * nothing on it refuses. `null` otherwise — a lead with no entry reads as
 * "no record", which withholds mail, and withholding is the safe direction
 * for a value this script did not witness being given.
 */
export function grantedConsentEntry(contact, hostId) {
  if (contact?.[FIELDS.marketingConsent] === false) return null
  const byHost = contact?.[FIELDS.marketingConsentByHost]
  if (!byHost || typeof byHost !== 'object' || Array.isArray(byHost)) return null
  for (const entry of Object.values(byHost)) {
    if (entry && typeof entry === 'object' && entry[FIELDS.marketingConsent] === false) {
      return null
    }
  }
  const entry = byHost[hostId]
  if (!entry || typeof entry !== 'object' || entry[FIELDS.marketingConsent] !== true) {
    return null
  }
  return { ...entry }
}

/**
 * The per-host inputs a lead plan reads, from the host's own collections.
 *
 * `anyForm` widens the lead surfaces from the routed, live forms to every
 * form the host has ever held: the ones whose author never switched routing
 * on, the archived ones, and the ones deleted outright — a deleted form
 * leaves its submissions behind, and they still name it. Each form counted
 * only because of the flag is listed in `unroutedForms` with why it would
 * not have counted, so the report can say which. Nothing else widens: the
 * skips, the row and the submission count read the same either way.
 *
 * @param {object} input
 * @param {string} input.hostId
 * @param {Array<{id: string, data: object}>} input.forms  `hosts/{hostId}/forms`
 * @param {Array<{id: string, data: object}>} input.submissions  `hosts/{hostId}/formSubmissions`
 * @param {Array<{id: string, data: object}>} input.leads  `hosts/{hostId}/leads`
 * @param {Array<{id: string, data: object}>} input.suppressions  `hosts/{hostId}/suppressions`
 * @param {number} input.nowMs
 * @param {boolean} [input.anyForm]  every form is a lead surface, not only the routed ones
 */
export function hostLeadContext({
  hostId,
  forms,
  submissions,
  leads,
  suppressions,
  nowMs,
  anyForm = false,
}) {
  // `leadSurfaceForms`, restated for the one verdict this script needs: a
  // live form whose author declared `routing.lead`. Every other form is a
  // surface only under `anyForm`, and remembered as such.
  const routedForms = new Map()
  const unroutedForms = new Map()
  for (const form of forms) {
    const name = String(form.data?.displayName ?? '').trim() || form.id
    const live = !form.data?.archivedAt
    if (live && form.data?.routing?.lead === true) {
      routedForms.set(form.id, name)
    } else if (anyForm) {
      unroutedForms.set(form.id, { name, state: live ? 'routing off' : 'archived' })
    }
  }
  const knownFormIds = new Set(forms.map((form) => form.id))
  const formIdByRef = new Map()
  const submissionsByEmail = new Map()
  for (const submission of submissions) {
    const formId = submission.data?.formId
    if (typeof formId !== 'string' || !formId) continue
    formIdByRef.set(submission.id, formId)
    // A form deleted outright keeps its submissions, which are the only
    // record left that it existed on this host.
    if (anyForm && !knownFormIds.has(formId)) {
      unroutedForms.set(formId, { name: formId, state: 'no form document' })
    }
    if (!routedForms.has(formId) && !unroutedForms.has(formId)) continue
    const email = emailFromSubmissionFields(submission.data?.fields)
    if (!email) continue
    submissionsByEmail.set(email, (submissionsByEmail.get(email) ?? 0) + 1)
  }
  const leadKeys = new Set(leads.map((lead) => lead.id))
  const leadEmails = new Set()
  for (const lead of leads) {
    const email = normalizeEmail(lead.data?.email)
    if (email) leadEmails.add(email)
  }
  const erasedKeys = new Set(
    suppressions
      .filter((row) => row.data?.reason === HOST_ERASURE_SUPPRESSION_REASON)
      .map((row) => row.id),
  )
  return {
    hostId,
    anyForm,
    routedFormIds: new Set(routedForms.keys()),
    routedForms,
    unroutedForms,
    leadSurfaceFormIds: new Set([...routedForms.keys(), ...unroutedForms.keys()]),
    formIdByRef,
    submissionsByEmail,
    leadKeys,
    leadEmails,
    erasedKeys,
    nowMs,
  }
}

/*==========================================
 * 3. THE COMPANY COUNT, RE-DERIVED FROM THE MIRROR.
 *=========================================*/

/** How many contacts name each company, from every contact's mirror. */
export function tallyCompanyMirrors(contacts) {
  const tally = new Map()
  for (const contact of contacts) {
    const mirror = contact?.[FIELDS.companyIds]
    if (!Array.isArray(mirror)) continue
    for (const id of new Set(mirror.map((value) => String(value ?? '')))) {
      if (!id) continue
      tally.set(id, (tally.get(id) ?? 0) + 1)
    }
  }
  return tally
}

/**
 * Which companies' stored counts disagree with the mirror, and which ids
 * the mirrors name that no company document answers to.
 *
 * An absent count reads as zero, as the list reads it, so a company nobody
 * has linked is in step with an absent field and gains no write. An orphan
 * id is reported and left: the contact's link is the truth and this script
 * has no company to correct.
 */
export function planCompanyCounts(companies, tally) {
  const plan = { drift: [], inStep: 0, orphans: [] }
  const known = new Set()
  for (const company of companies) {
    known.add(company.id)
    const raw = company.data?.[FIELDS.contactsCount]
    const stored = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    const counted = tally.get(company.id) ?? 0
    if ((stored ?? 0) === counted) {
      plan.inStep += 1
      continue
    }
    plan.drift.push({
      companyId: company.id,
      name: String(company.data?.name ?? '').trim() || company.id,
      stored,
      counted,
    })
  }
  for (const [companyId, counted] of tally) {
    if (!known.has(companyId)) plan.orphans.push({ companyId, counted })
  }
  return plan
}

/*==========================================
 * THE GUARDS: does the tree still say what this file assumes?
 *=========================================*/

/**
 * Comments out, code and strings intact — the scanner `backfill-form-ids`
 * uses, for the reason it gives: a regex pair corrupts real source, and a
 * guard on a live write must read the code and not a comment about it.
 */
export function stripComments(source) {
  let out = ''
  let mode = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        i += 1
      } else if (char === '/' && next === '*') {
        mode = 'block'
        i += 1
      } else {
        if (char === "'" || char === '"' || char === '`') {
          mode = 'string'
          quote = char
        }
        out += char
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      } else if (char === '\n') out += char
    } else {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) mode = 'code'
    }
  }
  return out
}

/**
 * Whether `crm.ts` still lists the stages this file lists, in this order.
 * Parsed from the array literal rather than matched as text, so a stage
 * added, removed or moved is named in the refusal.
 */
export function stageTableMatches(crmSource) {
  const source = stripComments(crmSource)
  const match = source.match(
    /export const CONTACT_LIFECYCLE_STAGES = \[([^\]]*)\] as const/,
  )
  if (!match) {
    return { ok: false, why: 'CONTACT_LIFECYCLE_STAGES is no longer an array literal in crm.ts' }
  }
  const listed = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  const same =
    listed.length === CONTACT_LIFECYCLE_STAGES.length &&
    listed.every((stage, index) => stage === CONTACT_LIFECYCLE_STAGES[index])
  return same
    ? { ok: true, why: 'the stage table agrees' }
    : {
        ok: false,
        why: `the stage table moved: crm.ts lists ${listed.join(' → ')}`,
      }
}

/** Whether `advanceContactLifecycleStage` still only ever moves forward. */
export function advanceNeverDowngrades(crmSource) {
  const source = stripComments(crmSource)
  const ok =
    /order\.indexOf\(held\) < order\.indexOf\(floor\) \? floor : held/.test(source)
  return {
    ok,
    why: ok
      ? 'the doors never downgrade'
      : 'advanceContactLifecycleStage no longer keeps the later stage',
  }
}

/**
 * The doors and the floors each names. Backfilling a floor a door has
 * stopped writing leaves a gap that grows from the moment this reports
 * success, so every door is read before a write is allowed.
 */
export const DOOR_FLOORS = [
  { path: 'apps/tenant/app/api/forms/submit/route.ts', floor: 'lead' },
  { path: 'libs/plugins/bookings/src/lib/server.ts', floor: 'lead' },
  { path: 'libs/plugins/bookings/src/lib/server/billing-webhook.ts', floor: 'customer' },
  { path: 'libs/plugins/commerce/src/lib/server/billing-webhook.ts', floor: 'customer' },
  { path: 'libs/plugins/commerce/src/lib/server/pos-order.ts', floor: 'customer' },
  { path: 'libs/plugins/commerce/src/lib/server/newsletter.ts', floor: 'subscriber' },
  { path: 'libs/plugins/commerce/src/lib/server/membership-register.ts', floor: 'subscriber' },
]

/** Whether one door's source still names its floor, matched on the write. */
export function doorSetsFloor(doorSource, floor) {
  const source = stripComments(doorSource)
  return new RegExp(`initialLifecycleStage:\\s*'${floor}'`).test(source)
}

/**
 * The field names and literals this file restates, and where the tree
 * declares each. A rename on either side must red the guard, never the data.
 */
export const FIELD_LITERALS = [
  { path: 'libs/aglyn/src/lib/app-utils/contacts.ts', name: 'CONTACT_FACETS_FIELD', value: FIELDS.facets },
  { path: 'libs/aglyn/src/lib/app-utils/contacts.ts', name: 'CONTACT_FORM_IDS_FIELD', value: FIELDS.formIds },
  { path: 'libs/aglyn/src/lib/app-utils/marketing-consent.ts', name: 'CAPTURED_BY_HOST_FIELD', value: FIELDS.capturedByHostIds },
  { path: 'libs/aglyn/src/lib/app-utils/marketing-consent.ts', name: 'MARKETING_CONSENT_FIELD', value: FIELDS.marketingConsent },
  { path: 'libs/aglyn/src/lib/app-utils/marketing-consent.ts', name: 'MARKETING_CONSENT_BY_HOST_FIELD', value: FIELDS.marketingConsentByHost },
  { path: 'libs/aglyn/src/lib/app-utils/crm.ts', name: 'CONTACT_COMPANY_IDS_FIELD', value: FIELDS.companyIds },
  { path: 'libs/aglyn/src/lib/app-utils/crm.ts', name: 'COMPANY_CONTACTS_COUNT_FIELD', value: FIELDS.contactsCount },
  { path: 'libs/tenant/data/admin/src/lib/server/email-suppression.ts', name: 'HOST_ERASURE_SUPPRESSION_REASON', value: HOST_ERASURE_SUPPRESSION_REASON },
  { path: 'libs/tenant/data/admin/src/lib/server/email-suppression.ts', name: 'HOST_SUPPRESSIONS_SUBCOLLECTION', value: 'suppressions' },
]

/** Whether a source declares `export const <name> = '<value>'`. */
export function declaresLiteral(source, name, value) {
  return new RegExp(`export const ${name}\\s*=\\s*'${value}'`).test(stripComments(source))
}

/** `person-key.ts` still hashes the normalized address, untruncated. */
export function personKeyMatches(source) {
  const normalizes = /const normalized = normalizeContactEmail\(email\)/.test(source)
  const hashes =
    /createHash\('sha256'\)\s*\.update\(normalized\)\s*\.digest\('hex'\)(?!\s*\.slice)/.test(
      source,
    )
  if (!normalizes) return { ok: false, why: 'person-key.ts no longer normalizes first' }
  if (!hashes) return { ok: false, why: 'person-key.ts no longer takes a full sha256' }
  return { ok: true, why: 'the person key agrees' }
}

/** `addHostLead` still keys a lead by the person key this file derives. */
export function leadWriterKeysByPerson(source) {
  const ok = /const key = personKey\(lead\.email\)/.test(stripComments(source))
  return {
    ok,
    why: ok
      ? 'the lead writer keys by person'
      : 'addHostLead no longer keys a lead by personKey(email)',
  }
}

/**
 * Every guard, against the tree at `repoRoot`. Reads files only — no
 * credentials, no Firestore — so the test can ask the same question of the
 * checkout it runs in.
 */
export function preconditionsForTree(repoRoot) {
  const read = (path) => {
    try {
      return readFileSync(join(repoRoot, path), 'utf8')
    } catch {
      return null
    }
  }
  const crm = read('libs/aglyn/src/lib/app-utils/crm.ts')
  if (!crm) return { ok: false, why: 'crm.ts could not be read' }
  const verdicts = [stageTableMatches(crm), advanceNeverDowngrades(crm)]
  for (const door of DOOR_FLOORS) {
    const source = read(door.path)
    if (!source) {
      verdicts.push({ ok: false, why: `${door.path} could not be read` })
      continue
    }
    if (!doorSetsFloor(source, door.floor)) {
      verdicts.push({
        ok: false,
        why: `${door.path} no longer sets initialLifecycleStage: '${door.floor}'`,
      })
    }
  }
  for (const literal of FIELD_LITERALS) {
    const source = read(literal.path)
    if (!source || !declaresLiteral(source, literal.name, literal.value)) {
      verdicts.push({
        ok: false,
        why: `${literal.path} no longer declares ${literal.name} = '${literal.value}'`,
      })
    }
  }
  const personKeySource = read('libs/aglyn/src/lib/app-utils/person-key.ts')
  verdicts.push(
    personKeySource
      ? personKeyMatches(personKeySource)
      : { ok: false, why: 'person-key.ts could not be read' },
  )
  const leadWriter = read('libs/tenant/data/admin/src/lib/server/host-visitor-records.ts')
  verdicts.push(
    leadWriter
      ? leadWriterKeysByPerson(leadWriter)
      : { ok: false, why: 'host-visitor-records.ts could not be read' },
  )
  const failed = verdicts.filter((verdict) => !verdict.ok)
  if (failed.length) {
    return { ok: false, why: failed.map((verdict) => verdict.why).join('; ') }
  }
  return {
    ok: true,
    why: `${verdicts[0].why}; ${verdicts[1].why}; every door sets its floor; the field names agree; ${verdicts.at(-2).why}; ${verdicts.at(-1).why}`,
  }
}

/*==========================================
 * SHARED READERS.
 *=========================================*/

/** The facet map as stored, or an empty one. */
export function readFacets(contact) {
  const facets = contact?.[FIELDS.facets]
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return {}
  const out = {}
  for (const [groupId, facet] of Object.entries(facets)) {
    if (!groupId || !facet || typeof facet !== 'object' || Array.isArray(facet)) continue
    out[groupId] = facet
  }
  return out
}

/** Milliseconds from a Timestamp, a Date, a number, or `null`. */
export function timestampMs(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  if (typeof value._seconds === 'number') return value._seconds * 1000
  if (value instanceof Date) return value.getTime()
  return null
}
