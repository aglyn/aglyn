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

/*==========================================
 * WHO CAN BE ENROLLED, AND WHAT THE REP STILL OWES (AGL-2980).
 *
 * The enroll dialog shows every person a view or a search named, each
 * marked eligible, blocked, or waiting on the rep; Confirm asks the same
 * question again, on the server, with what the rep supplied. Both answers
 * come from the engine's `evaluateOutreachGates` — this module only reads
 * the people and asks it the right questions.
 *
 * ## Three questions of one pure function
 *
 * The gates refuse a cold contact until the rep writes a personal line and
 * ticks the attestations, and refuse an address in an unknown country until
 * the rep confirms it is a US business address. So a preview asks:
 *
 *   1. as the person stands, with nothing confirmed — allowed means
 *      ELIGIBLE;
 *   2. as if the rep confirmed everything they can — refused means BLOCKED,
 *      for the reasons that remain, which no tick can clear;
 *   3. otherwise the person is WAITING ON THE REP, for what (1) found
 *      missing.
 *
 * The confirmation in (2) is hypothetical and never stored: Confirm stamps
 * only what the rep ticked, with their uid and the time, and asks again.
 *
 * ## One enrollment per person per sequence, ever
 *
 * The enrollment's id is the sequence and the contact
 * (`outreachEnrollmentId`), and it is written with `create()`. A person who
 * finished, replied or was stopped is not sent the same emails a second
 * time by being enrolled again, and two members confirming the same person
 * at once write one enrollment.
 *==========================================*/

import { normalizeContactEmail, contactDisplayName, readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import { crmLeadDisplayName, crmLeadStatus } from '@aglyn/aglyn/app-utils/crm'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import {
  evaluateOutreachGates,
  type OutreachGateBlock,
  type OutreachGateLookups,
} from '../engine/gates'
import { outreachAttestationsFrom } from '../engine/enrollment-state'
import {
  OUTREACH_ATTESTATION_KINDS,
  type OutreachAttestationKind,
  type OutreachAttestations,
  type OutreachSequenceSettings,
} from '../model/outreach.types'
import type {
  OutreachEnrollBlock,
  OutreachEnrollPreviewPerson,
  OutreachPersonRef,
} from '../model/outreach-api'

type Firestore = FirebaseFirestore.Firestore

/**
 * One person as the preview and the enroll read them: a contact, or a lead
 * the sequence's site holds (AGL-3234).
 *
 * ## A lead is judged as the contact it would be
 *
 * The gates, the merge fields and the country rule all read a CONTACT
 * document — its facet's sources, stage, address, company and title. A lead
 * carries the same facts in its own shape, so rather than teach every gate
 * two records, a lead is handed to them as {@link leadAsContact}: a
 * contact-shaped view whose one facet, under the sequence's group, holds
 * what the lead holds. An imported lead has no inbound source and is cold;
 * one that wrote in through a form is not; a lead is never a customer; its
 * address decides its country; and `{{contact.firstName}}` or
 * `{{contact.company}}` in a step reads the lead's name and company text,
 * so a sequence written for contacts sends to leads unchanged — which is
 * also what lets an enrollment made on a lead keep sending after the lead
 * converts and the view becomes the real contact.
 */
export interface OutreachEnrollCandidate {
  /** The record's own id: the contact's, or the lead's person key. */
  personId: string
  target: 'contact' | 'lead'
  /** The contact's id; `''` for a lead. */
  contactId: string
  /** The lead's person key; `null` for a contact. */
  leadId: string | null
  /**
   * The contact document (`orgs/{orgId}/contacts/{id}`), or for a lead the
   * contact-shaped view of it — see the module note. `null` when the record
   * no longer exists.
   */
  contact: Record<string, unknown> | null
  /** The lead document as stored, for a lead; `null` for a contact. */
  lead: Record<string, unknown> | null
  /** Whether the sequence's site may see the record. A lead is the site's own. */
  visible: boolean
  /** The name the sequence's site knows them by; `''` for none. */
  name: string
  /** The primary address, normalized, or `null` when there is none. */
  email: string | null
  /** The company the contact is filed under at that site, when there is one. */
  company: Record<string, unknown> | null
  /** A lead already converted: the contact it became. Enroll that instead. */
  convertedContactId: string | null
  /** A lead whose address the workspace already holds as a contact. Enroll that instead. */
  heldAsContactId: string | null
}

/**
 * A lead as the gates and the merge fields read a contact — see the
 * module note. The facet is the sequence's group's, which is the one every
 * reader asks for. The lead's `sources` — `form:{id}`, `booking`, `import`,
 * `manual`, `api`, `signup` — become the facet's source flags by kind, so
 * the inbound rule reads them as it reads a contact's.
 */
export function leadAsContact(
  lead: Record<string, unknown>,
  contactGroupId: string,
): Record<string, unknown> {
  const sources: Record<string, true> = {}
  for (const raw of Array.isArray(lead['sources']) ? lead['sources'] : []) {
    const source = String(raw)
    const kind = source.startsWith('form:') ? 'form' : source === 'signup' ? 'member' : source
    if (kind) sources[kind] = true
  }
  return {
    email: lead['email'],
    name: lead['name'],
    // The verdict on the address (AGL-3245) is the lead's own top-level
    // field, as it is the contact's, so the gates quote it either way.
    ...(lead['emailState'] && typeof lead['emailState'] === 'object' ? { emailState: lead['emailState'] } : {}),
    facets: {
      [contactGroupId]: {
        sources,
        ...(lead['address'] && typeof lead['address'] === 'object' ? { address: lead['address'] } : {}),
        ...(typeof lead['company'] === 'string' ? { companyName: lead['company'] } : {}),
        ...(typeof lead['jobTitle'] === 'string' ? { jobTitle: lead['jobTitle'] } : {}),
        ...(typeof lead['phone'] === 'string' ? { phone: lead['phone'] } : {}),
        ...(Array.isArray(lead['tags']) ? { tags: lead['tags'] } : {}),
      },
    },
  }
}

/** `getAll` takes this many references at most per call. */
const GET_ALL_CHUNK = 300

async function getAllChunked(
  firestore: Firestore,
  refs: readonly FirebaseFirestore.DocumentReference[],
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = []
  for (let start = 0; start < refs.length; start += GET_ALL_CHUNK) {
    snapshots.push(...(await firestore.getAll(...refs.slice(start, start + GET_ALL_CHUNK))))
  }
  return snapshots
}

/**
 * The people, as the sequence's site knows them, and the company each
 * contact is filed under there — batched reads for everyone: the contacts
 * and the leads by id, the companies once, and for each lead one address
 * lookup, because a lead the workspace already holds as a contact is that
 * contact's to enroll.
 */
export async function readOutreachEnrollCandidates(
  firestore: Firestore,
  input: { orgId: string; hostId: string; contactGroupId: string; people: readonly OutreachPersonRef[] },
): Promise<OutreachEnrollCandidate[]> {
  if (!input.people.length) return []
  const org = firestore.collection('orgs').doc(input.orgId)
  const leads = firestore.collection('hosts').doc(input.hostId).collection('leads')
  const snapshots = await getAllChunked(
    firestore,
    input.people.map((person) =>
      person.kind === 'lead' ? leads.doc(person.id) : org.collection('contacts').doc(person.id),
    ),
  )
  const read = await Promise.all(
    input.people.map(async (person, index) => {
      const data = snapshots[index]?.exists ? (snapshots[index].data() as Record<string, unknown>) : null
      if (person.kind === 'lead') {
        const email = data ? normalizeContactEmail(data['email']) : null
        const held =
          data && email ? await findContactByEmail(org.collection('contacts'), email) : null
        return {
          personId: person.id,
          target: 'lead' as const,
          contactId: '',
          leadId: person.id,
          contact: data ? leadAsContact(data, input.contactGroupId) : null,
          lead: data,
          // A lead is the site's own record: no scope to check.
          visible: data !== null,
          name: data ? crmLeadDisplayName(data) : '',
          email,
          companyId: '',
          convertedContactId: data && typeof data['convertedContactId'] === 'string' ? data['convertedContactId'] : null,
          heldAsContactId: held ? held.id : null,
        }
      }
      return {
        personId: person.id,
        target: 'contact' as const,
        contactId: person.id,
        leadId: null,
        contact: data,
        lead: null,
        visible: data ? visibleToHost(data['visibleTo'] as string[] | undefined, input.hostId) : false,
        name: data ? contactDisplayName(data, input.contactGroupId).trim() : '',
        email: data ? normalizeContactEmail(data['email']) : null,
        companyId: data ? String(readContactFacet(data, input.contactGroupId).companyId ?? '') : '',
        convertedContactId: null,
        heldAsContactId: null,
      }
    }),
  )
  const companyIds = [...new Set(read.map((entry) => entry.companyId).filter(Boolean))]
  const companies = new Map<string, Record<string, unknown>>()
  if (companyIds.length) {
    const found = await getAllChunked(
      firestore,
      companyIds.map((id) => org.collection('companies').doc(id)),
    )
    found.forEach((snapshot, index) => {
      if (snapshot.exists) companies.set(companyIds[index], snapshot.data() as Record<string, unknown>)
    })
  }
  return read.map(({ companyId, ...candidate }) => ({
    ...candidate,
    company: companyId ? (companies.get(companyId) ?? null) : null,
  }))
}

/** The person as every answer names them. */
function personOf(candidate: OutreachEnrollCandidate) {
  return {
    personId: candidate.personId,
    target: candidate.target,
    contactId: candidate.contactId,
    leadId: candidate.leadId,
  }
}

/** What stands in the way before the gates are asked anything. */
export function outreachCandidateBlocks(
  candidate: OutreachEnrollCandidate,
  facts: { siteName: string; alreadyInSequence: boolean },
): OutreachEnrollBlock[] {
  if (!candidate.contact) {
    return candidate.target === 'lead'
      ? [{ code: 'lead_missing', reason: "This lead no longer exists in this sequence's site's CRM." }]
      : [{ code: 'contact_missing', reason: 'This contact no longer exists in the CRM.' }]
  }
  const blocks: OutreachEnrollBlock[] = []
  if (candidate.target === 'lead') {
    // A lead that converted, or whose address the workspace already holds
    // as a contact, is that contact's to enroll — one person, one record.
    if (candidate.convertedContactId) {
      blocks.push({
        code: 'lead_converted',
        reason: 'This lead was converted into a contact. Enroll the contact instead.',
      })
    } else if (candidate.heldAsContactId) {
      blocks.push({
        code: 'lead_is_contact',
        reason: 'This address is already a contact in your CRM. Enroll the contact instead.',
      })
    }
    if (crmLeadStatus(candidate.lead) === 'unqualified') {
      blocks.push({
        code: 'lead_unqualified',
        reason: 'This lead was closed as unqualified. Reopen it before enrolling.',
      })
    }
  }
  if (!candidate.visible) {
    blocks.push({
      code: 'not_in_site',
      reason: `This contact isn't in ${facts.siteName || "this sequence's site"}'s CRM.`,
    })
  }
  if (!candidate.email) {
    blocks.push({ code: 'no_email', reason: 'This contact has no email address.' })
  }
  if (facts.alreadyInSequence) {
    blocks.push({
      code: 'already_in_sequence',
      reason: "This person has already been in this sequence, so they won't be sent its emails again.",
    })
  }
  return blocks
}

/** Every attestation, stamped for a hypothetical question only — never stored. */
const EVERYTHING_CONFIRMED: OutreachAttestations = Object.fromEntries(
  OUTREACH_ATTESTATION_KINDS.map((kind) => [kind, { uid: 'preview', atMs: 1 }]),
)

const blocksOf = (blocks: readonly OutreachGateBlock[]): OutreachEnrollBlock[] =>
  blocks.map(({ code, reason }) => ({ code, reason }))

export interface OutreachGateQuestion {
  candidate: OutreachEnrollCandidate
  lookups: OutreachGateLookups
  /** The sequence's settings, its countries already capped by the organization's. */
  settings: OutreachSequenceSettings
  contactGroupId: string
}

/** Where one person stands before the rep confirms anything — see the module note. */
export function previewOutreachPerson(
  question: OutreachGateQuestion,
  facts: { siteName: string; alreadyInSequence: boolean },
): OutreachEnrollPreviewPerson {
  const { candidate } = question
  const person = {
    ...personOf(candidate),
    name: candidate.name,
    email: candidate.email,
  }
  const early = outreachCandidateBlocks(candidate, facts)
  if (early.length) {
    return {
      ...person,
      cold: false,
      country: null,
      status: 'blocked',
      blocks: early,
      requires: { personalLine: false, attestations: [] },
    }
  }
  const ask = (personalLine: string, attestations: OutreachAttestations) =>
    evaluateOutreachGates({
      email: candidate.email ?? '',
      contact: candidate.contact,
      contactGroupId: question.contactGroupId,
      company: candidate.company,
      settings: question.settings,
      personalLine,
      attestations,
      lookups: question.lookups,
    })
  const asIs = ask('', {})
  const known = { cold: asIs.cold, country: asIs.country.country }
  if (asIs.allowed) {
    return {
      ...person,
      ...known,
      status: 'eligible',
      blocks: [],
      requires: { personalLine: false, attestations: [] },
    }
  }
  // The line is only checked for being present, so any sentence stands in.
  const confirmed = ask('A personal line.', EVERYTHING_CONFIRMED)
  if (!confirmed.allowed) {
    return {
      ...person,
      ...known,
      status: 'blocked',
      blocks: blocksOf(confirmed.blocks),
      requires: { personalLine: false, attestations: [] },
    }
  }
  const attestations: OutreachAttestationKind[] = asIs.cold
    ? [...asIs.missingAttestations]
    : asIs.blocks.some((block) => block.code === 'country_unknown')
      ? ['us_business_address']
      : []
  return {
    ...person,
    ...known,
    status: 'needs_confirmation',
    blocks: [],
    requires: {
      personalLine: asIs.blocks.some((block) => block.code === 'personal_line_missing'),
      attestations,
    },
  }
}

export interface OutreachEnrollDecision {
  allowed: boolean
  blocks: OutreachEnrollBlock[]
  cold: boolean
  /** The address as the gates normalized it. */
  email: string | null
  /** What the rep confirmed, stamped with who and when. */
  attestations: OutreachAttestations
}

/** Confirm's answer for one person, with what the rep supplied — see the module note. */
export function decideOutreachEnrollment(
  question: OutreachGateQuestion,
  facts: { siteName: string; alreadyInSequence: boolean },
  supplied: {
    personalLine: string
    attestations: readonly unknown[]
    uid: string
    nowMs: number
  },
): OutreachEnrollDecision {
  const attestations = outreachAttestationsFrom(supplied.attestations, supplied.uid, supplied.nowMs)
  const early = outreachCandidateBlocks(question.candidate, facts)
  if (early.length) {
    return { allowed: false, blocks: early, cold: false, email: question.candidate.email, attestations }
  }
  const result = evaluateOutreachGates({
    email: question.candidate.email ?? '',
    contact: question.candidate.contact,
    contactGroupId: question.contactGroupId,
    company: question.candidate.company,
    settings: question.settings,
    personalLine: supplied.personalLine,
    attestations,
    lookups: question.lookups,
  })
  return {
    allowed: result.allowed,
    blocks: blocksOf(result.blocks),
    cold: result.cold,
    email: result.email,
    attestations,
  }
}
