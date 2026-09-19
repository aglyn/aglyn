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
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
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
import type { OutreachEnrollBlock, OutreachEnrollPreviewPerson } from '../model/outreach-api'

type Firestore = FirebaseFirestore.Firestore

/** One person as the preview and the enroll read them. */
export interface OutreachEnrollCandidate {
  contactId: string
  /** The contact document, or `null` when it no longer exists. */
  contact: Record<string, unknown> | null
  /** Whether the sequence's site may see the contact. */
  visible: boolean
  /** The name the sequence's site knows them by; `''` for none. */
  name: string
  /** The primary address, normalized, or `null` when there is none. */
  email: string | null
  /** The company the contact is filed under at that site, when there is one. */
  company: Record<string, unknown> | null
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
 * The contacts, as the sequence's site knows them, and the company each is
 * filed under there — two batched reads for everyone.
 */
export async function readOutreachEnrollCandidates(
  firestore: Firestore,
  input: { orgId: string; hostId: string; contactGroupId: string; contactIds: readonly string[] },
): Promise<OutreachEnrollCandidate[]> {
  if (!input.contactIds.length) return []
  const org = firestore.collection('orgs').doc(input.orgId)
  const snapshots = await getAllChunked(
    firestore,
    input.contactIds.map((id) => org.collection('contacts').doc(id)),
  )
  const read = input.contactIds.map((contactId, index) => {
    const data = snapshots[index]?.exists ? (snapshots[index].data() as Record<string, unknown>) : null
    return {
      contactId,
      contact: data,
      visible: data ? visibleToHost(data['visibleTo'] as string[] | undefined, input.hostId) : false,
      name: data ? contactDisplayName(data, input.contactGroupId).trim() : '',
      email: data ? normalizeContactEmail(data['email']) : null,
      companyId: data ? String(readContactFacet(data, input.contactGroupId).companyId ?? '') : '',
    }
  })
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

/** What stands in the way before the gates are asked anything. */
export function outreachCandidateBlocks(
  candidate: OutreachEnrollCandidate,
  facts: { siteName: string; alreadyInSequence: boolean },
): OutreachEnrollBlock[] {
  if (!candidate.contact) {
    return [{ code: 'contact_missing', reason: 'This contact no longer exists in the CRM.' }]
  }
  const blocks: OutreachEnrollBlock[] = []
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
    contactId: candidate.contactId,
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
