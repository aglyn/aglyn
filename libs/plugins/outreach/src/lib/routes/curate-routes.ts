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

import { readCampaignIds, readContactCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { normalizeCrmEmailTemplate } from '@aglyn/aglyn/app-utils/crm-email-templates'
import type { PluginTextGenerator } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import {
  OUTREACH_CURATION_SYSTEM,
  outreachCurationPrompt,
  parseOutreachCurationAnswer,
  type OutreachCurationFacts,
  type OutreachCurationStep,
} from '../engine/curation-prompt'
import { outreachCuratedEntry } from '../engine/enrollment-activity'
import { OUTREACH_OPEN_ENROLLMENT_STATUSES } from '../engine/gates'
import {
  hasOutreachValidationErrors,
  isInThreadEmailStep,
  validateOutreachCuratedStep,
} from '../engine/sequence-validation'
import { readOutreachEnrollCandidates, type OutreachEnrollCandidate } from '../enrollment/enroll-people'
import { readOutreachStepOverrideRequest } from '../enrollment/step-overrides'
import type {
  OutreachCurateDraft,
  OutreachCurateDraftResponse,
  OutreachCurateSaveResponse,
  OutreachPersonRef,
} from '../model/outreach-api'
import {
  OUTREACH_MAX_EMAIL_STEPS,
  type OutreachEnrollment,
  type OutreachSequence,
  type OutreachStepOverride,
} from '../model/outreach.types'
import { fileOutreachNote } from '../runtime/timeline'
import {
  outreachEnrollmentLink,
  outreachEnrollmentPerson,
  outreachOrgCollection,
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import { OUTREACH_READS_PEOPLE, type OutreachEnrollRouteDeps } from './enroll-routes'
import { OUTREACH_SEQUENCE_ACTIVITY_TARGET } from './route-deps'
import { outreachRouteGate, type OutreachRouteCaller } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * CURATING ONE PERSON'S EMAILS (AGL-3324): `outreach/curate/draft` and
 * `outreach/curate/save`.
 *
 * A sequence's step is one template for everyone plus the personal line;
 * what an agent-run outbound tool does instead is write each send for each
 * prospect from what it knows about them, and let the seller approve or
 * edit. These two routes are that, with the member's confirmation kept as
 * the one thing that stores anything.
 *
 * DRAFT reads the person the way enrolling reads them — the contact, or the
 * lead as the contact it would be, with the company filed beside them — and
 * asks the workspace's text generator, on the core's seam, for this
 * person's copy of the email steps named: every email step for a person
 * about to be enrolled, the next one for an enrollment. The answer is
 * validated against the playbook's rules and returned with each draft's
 * issues, the prompt and the model. NOTHING IS STORED: the member reads it
 * in the dialog, edits it, ticks the confirmation, and then either enrolls
 * (the enroll route stores the copies with the enrollment) or saves.
 *
 * SAVE stores one confirmed copy on an open enrollment, for a step that
 * has not gone out, validated again — the request is not trusted to have
 * shown the member what it sends — and files "Curated step N" on the
 * person's record with who wrote the words. `override: null` clears a copy,
 * so the step goes back to the sequence's own words.
 *
 * Both read the CRM, so both ask for `data.manage` beside `outreach.use`;
 * the generator applies its own rules — the generation permission, the
 * plan, the switches, the allotments — to the member named, and meters the
 * draft on the member's month and the org's. Outreach never reaches the AI
 * plugin: the seam is the platform's, and a workspace where no plugin
 * generates text is told so in the route's words.
 */

/** The purpose the generator's ledger files a draft under. */
export const OUTREACH_CURATION_PURPOSE = 'outreach-curate'

/** The most tokens one drafting answer may run to: four short emails, with room. */
const CURATION_MAX_TOKENS = 2_400

/** The org activity line a saved copy writes. */
export function outreachCuratedActivity(stepIndex: number, cleared: boolean): string {
  return cleared
    ? `Cleared the curated copy of step ${stepIndex + 1} of a sequence`
    : `Curated step ${stepIndex + 1} of a sequence for one person`
}

type Firestore = FirebaseFirestore.Firestore

/** The person's copies of steps a draft covers, and the enrollment they belong to when one exists. */
interface DraftSubject {
  sequence: OutreachSequence
  person: OutreachPersonRef
  personalLine: string
  enrollment: OutreachEnrollment | null
  /** The steps to draft, email steps only, unique, in order. */
  stepIndexes: number[]
}

/** Every email step's index, in order. */
function emailStepIndexes(sequence: Pick<OutreachSequence, 'steps'>): number[] {
  return sequence.steps.map((step, index) => (step.kind === 'email' ? index : -1)).filter((index) => index >= 0)
}

/** The step indexes a request names, or the default for its subject; a refusal for anything else. */
function readStepIndexes(
  raw: unknown,
  sequence: OutreachSequence,
  fallback: number[],
): number[] | Response {
  if (raw === undefined) return fallback
  if (!Array.isArray(raw) || !raw.length) {
    return outreachRefusal(400, 'invalid-request', 'Name the email steps to draft.')
  }
  const wanted = [...new Set(raw.map((value) => Number(value)))]
  const emails = emailStepIndexes(sequence)
  if (wanted.some((index) => !emails.includes(index))) {
    return outreachRefusal(400, 'invalid-request', 'A curated step is one of the sequence’s email steps.')
  }
  if (wanted.length > OUTREACH_MAX_EMAIL_STEPS) {
    return outreachRefusal(400, 'invalid-request', `Draft at most ${OUTREACH_MAX_EMAIL_STEPS} emails at a time.`)
  }
  return wanted.sort((a, b) => a - b)
}

/** What the request is about: a person to enroll, or an enrollment's next step. */
async function draftSubject(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  body: Record<string, unknown>,
): Promise<DraftSubject | Response> {
  const enrollmentId = body['enrollmentId'] === undefined ? null : readOutreachDocumentId(body['enrollmentId'])
  if (body['enrollmentId'] !== undefined && !enrollmentId) {
    return outreachRefusal(400, 'invalid-request', 'Name the enrollment to curate.')
  }
  if (enrollmentId) {
    const snapshot = await outreachOrgCollection(firestore, caller.orgId, 'enrollments').doc(enrollmentId).get()
    const enrollment = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
    if (!enrollment) return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    if (!OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(enrollment.status)) {
      return outreachRefusal(409, 'transition-refused', 'This enrollment has ended, so nothing more is sent to them.')
    }
    const sequenceSnapshot = await outreachOrgCollection(firestore, caller.orgId, 'sequences')
      .doc(enrollment.sequenceId)
      .get()
    const sequence = readStoredOutreachSequence(
      enrollment.sequenceId,
      sequenceSnapshot.exists ? sequenceSnapshot.data() : undefined,
    )
    if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
    // The next email step that has not gone out: the one the enrollment is
    // on when it is an email, else the first email after it.
    const next = emailStepIndexes(sequence).find((index) => index >= enrollment.stepIndex)
    const stepIndexes = readStepIndexes(body['stepIndexes'], sequence, next === undefined ? [] : [next])
    if (stepIndexes instanceof Response) return stepIndexes
    if (stepIndexes.some((index) => index < enrollment.stepIndex)) {
      return outreachRefusal(409, 'transition-refused', 'That step already went out to this person.')
    }
    if (!stepIndexes.length) {
      return outreachRefusal(409, 'transition-refused', 'Every email in this sequence has gone out to this person.')
    }
    return {
      sequence,
      person: outreachEnrollmentPerson(enrollment),
      personalLine: enrollment.personalLine,
      enrollment,
      stepIndexes,
    }
  }
  const sequenceId = readOutreachDocumentId(body['sequenceId'])
  if (!sequenceId) return outreachRefusal(400, 'invalid-request', 'Name the sequence to draft for.')
  const contactId = body['contactId'] === undefined ? null : readOutreachDocumentId(body['contactId'])
  const leadId = body['leadId'] === undefined ? null : readOutreachDocumentId(body['leadId'])
  const person: OutreachPersonRef | null = contactId
    ? { kind: 'contact', id: contactId }
    : leadId
      ? { kind: 'lead', id: leadId }
      : null
  if (!person) return outreachRefusal(400, 'invalid-request', 'Name the contact or the lead to draft for.')
  const snapshot = await outreachOrgCollection(firestore, caller.orgId, 'sequences').doc(sequenceId).get()
  const sequence = readStoredOutreachSequence(sequenceId, snapshot.exists ? snapshot.data() : undefined)
  if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
  const stepIndexes = readStepIndexes(body['stepIndexes'], sequence, emailStepIndexes(sequence))
  if (stepIndexes instanceof Response) return stepIndexes
  if (!stepIndexes.length) {
    return outreachRefusal(400, 'invalid-request', 'This sequence sends no email, so there is nothing to draft.')
  }
  return {
    sequence,
    person,
    personalLine: typeof body['personalLine'] === 'string' ? body['personalLine'] : '',
    enrollment: null,
    stepIndexes,
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : []

/**
 * The names of the campaigns the person is filed under — the org's
 * containers, `orgs/{orgId}/emailCampaigns`. A container that is gone names
 * nothing; a read that fails names none, and the draft goes without.
 */
async function campaignNames(firestore: Firestore, orgId: string, campaignIds: readonly string[]): Promise<string[]> {
  if (!campaignIds.length) return []
  try {
    const containers = firestore.collection('orgs').doc(orgId).collection('emailCampaigns')
    const found = await firestore.getAll(...campaignIds.map((id) => containers.doc(id)))
    return found.map((snapshot) => text(snapshot.get('name'))).filter(Boolean)
  } catch (error) {
    console.error('[outreach] the person’s campaigns could not be named for the draft', error)
    return []
  }
}

/** What the CRM holds about the person, for the prompt. */
async function curationFacts(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  subject: DraftSubject,
  candidate: OutreachEnrollCandidate,
  contactGroupId: string,
): Promise<OutreachCurationFacts> {
  const contact = candidate.contact ?? {}
  const facet = readContactFacet(contact, contactGroupId) as unknown as Record<string, unknown>
  const lead = candidate.lead ?? {}
  const company = candidate.company ?? {}
  const campaignIds =
    candidate.target === 'lead' ? readCampaignIds(lead) : readContactCampaignIds(contact, contactGroupId)
  const [mailboxSnapshot, host, campaigns] = await Promise.all([
    subject.sequence.mailboxId
      ? outreachOrgCollection(firestore, caller.orgId, 'mailboxes').doc(subject.sequence.mailboxId).get()
      : null,
    subject.sequence.hostId ? firestore.collection('hosts').doc(subject.sequence.hostId).get() : null,
    campaignNames(firestore, caller.orgId, campaignIds),
  ])
  const mailbox = readStoredOutreachMailbox(
    subject.sequence.mailboxId,
    mailboxSnapshot?.exists ? mailboxSnapshot.data() : undefined,
  )
  return {
    name: candidate.name || text(contact['name']),
    email: candidate.email ?? '',
    company: text(facet['companyName']) || text(lead['company']) || text(company['name']),
    title: text(facet['jobTitle']) || text(lead['jobTitle']),
    website: text(company['website']) || text(company['domain']) || text(lead['website']) || text(lead['domain']),
    tags: [...new Set([...texts(facet['tags']), ...texts(company['tags'])])],
    sources: Object.entries((facet['sources'] ?? {}) as Record<string, unknown>)
      .filter(([, on]) => on === true)
      .map(([source]) => source)
      .sort(),
    campaigns,
    notes: candidate.target === 'lead' ? text(lead['notes']) : '',
    record: candidate.target,
    siteName: host?.exists ? text(host.get('name')) : '',
    senderName: mailbox?.displayName || '',
    personalLine: subject.personalLine,
  }
}

/** The email steps to draft, as the prompt states them: the step's words, or its template's. */
async function curationSteps(
  firestore: Firestore,
  orgId: string,
  sequence: OutreachSequence,
  stepIndexes: readonly number[],
): Promise<OutreachCurationStep[]> {
  const emails = emailStepIndexes(sequence)
  const templates = firestore.collection('orgs').doc(orgId).collection(CRM_COLLECTIONS.emailTemplates)
  return Promise.all(
    stepIndexes.map(async (stepIndex) => {
      const step = sequence.steps[stepIndex]
      if (step?.kind !== 'email') throw new Error(`step ${stepIndex} is not an email`)
      let body = step.body
      if (step.templateId) {
        const template = await templates.doc(step.templateId).get()
        body = template.exists ? normalizeCrmEmailTemplate(template.data() as Record<string, unknown>).body : ''
      }
      return {
        stepIndex,
        position: emails.indexOf(stepIndex) + 1,
        count: emails.length,
        subject: step.subject,
        body,
        startsThread: !isInThreadEmailStep(sequence.steps, stepIndex),
      }
    }),
  )
}

/** The member's name for the record's entry: as the roster lists them, else their address. */
async function memberName(firestore: Firestore, caller: OutreachRouteCaller): Promise<string | null> {
  try {
    const member = await firestore.collection('orgs').doc(caller.orgId).collection('members').doc(caller.uid).get()
    return (member.exists ? text(member.get('displayName')) || text(member.get('email')) : '') || caller.email
  } catch {
    return caller.email
  }
}

export interface OutreachCurateRoutes {
  draft: PluginWebApiHandler
  save: PluginWebApiHandler
}

export function createOutreachCurateRoutes(deps: OutreachEnrollRouteDeps): OutreachCurateRoutes {
  const draft: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate, [OUTREACH_READS_PEOPLE])
    if (caller instanceof Response) return caller
    const generator = deps.textGenerator()
    if (!generator) {
      return outreachRefusal(503, 'curation-unavailable', 'AI drafting is not available in this workspace.')
    }
    const firestore = deps.firestore()
    const subject = await draftSubject(firestore, caller, body)
    if (subject instanceof Response) return subject
    const contactGroupId = consentGroupForHost(caller.org, subject.sequence.hostId).groupId
    const [candidate] = await readOutreachEnrollCandidates(firestore, {
      orgId: caller.orgId,
      hostId: subject.sequence.hostId,
      contactGroupId,
      people: [subject.person],
    })
    if (!candidate?.contact || !candidate.visible) {
      return outreachRefusal(404, 'contact-not-found', "That person isn't in this sequence's site's CRM.")
    }
    const [facts, steps] = await Promise.all([
      curationFacts(firestore, caller, subject, candidate, contactGroupId),
      curationSteps(firestore, caller.orgId, subject.sequence, subject.stepIndexes),
    ])
    const prompt = outreachCurationPrompt(facts, steps)
    const answer = await generator.generate({
      orgId: caller.orgId,
      hostId: subject.sequence.hostId || null,
      uid: caller.uid,
      staff: caller.staff,
      org: caller.org,
      purpose: OUTREACH_CURATION_PURPOSE,
      system: OUTREACH_CURATION_SYSTEM,
      prompt,
      maxTokens: CURATION_MAX_TOKENS,
      now: new Date(deps.now()),
    })
    // Compared to `false` rather than negated: the union narrows on the
    // literal, and this tree compiles without strict null checks.
    if (answer.ok === false) {
      return outreachRefusal(
        answer.status,
        answer.reason === 'unavailable' ? 'curation-unavailable' : 'curation-refused',
        answer.error,
      )
    }
    const parsed = parseOutreachCurationAnswer(answer.text, steps)
    if (!parsed) {
      return outreachRefusal(
        502,
        'curation-refused',
        'The draft came back in a shape that can’t be read. Try again.',
      )
    }
    const drafts: OutreachCurateDraft[] = parsed.map((entry) => {
      const step = steps.find((candidateStep) => candidateStep.stepIndex === entry.stepIndex)
      return {
        ...entry,
        issues: validateOutreachCuratedStep(
          { subject: entry.subject, body: entry.body, startsThread: step?.startsThread === true },
          `stepOverrides.${entry.stepIndex}`,
        ),
      }
    })
    return outreachOk({ ok: true, drafts, prompt, model: answer.model } satisfies OutreachCurateDraftResponse)
  }

  const save: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const enrollmentId = readOutreachDocumentId(body['enrollmentId'])
    const stepIndex = Number(body['stepIndex'])
    if (!enrollmentId || !Number.isInteger(stepIndex) || stepIndex < 0) {
      return outreachRefusal(400, 'invalid-request', 'Name the enrollment and the step to curate.')
    }
    const firestore = deps.firestore()
    const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
    const current = await enrollments.doc(enrollmentId).get()
    const stored = readStoredOutreachEnrollment(enrollmentId, current.exists ? current.data() : undefined)
    if (!stored) return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    const sequenceSnapshot = await outreachOrgCollection(firestore, caller.orgId, 'sequences').doc(stored.sequenceId).get()
    const sequence = readStoredOutreachSequence(stored.sequenceId, sequenceSnapshot.exists ? sequenceSnapshot.data() : undefined)
    if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
    if (sequence.steps[stepIndex]?.kind !== 'email') {
      return outreachRefusal(400, 'invalid-request', 'A curated step is one of the sequence’s email steps.')
    }

    const cleared = body['override'] === null
    let override: OutreachStepOverride | null = null
    if (!cleared) {
      const read = readOutreachStepOverrideRequest({ ...(body['override'] as object), stepIndex }, sequence.steps)
      if ('refusal' in read) return outreachRefusal(400, 'invalid-override', read.refusal)
      if (hasOutreachValidationErrors(read.issues)) {
        return outreachRefusal(400, 'invalid-override', 'This draft breaks a rule every sequence email keeps.', {
          issues: read.issues,
        })
      }
      override = { ...read.override, draftedAtMs: deps.now(), draftedByUid: caller.uid }
    }

    const nowMs = deps.now()
    const written = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(enrollments.doc(enrollmentId))
      const enrollment = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
      if (!enrollment) return { refusal: outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.') }
      if (!OUTREACH_OPEN_ENROLLMENT_STATUSES.includes(enrollment.status)) {
        return {
          refusal: outreachRefusal(409, 'transition-refused', 'This enrollment has ended, so nothing more is sent to them.'),
        }
      }
      // A step that already went out, or is going out now, is not rewritten
      // under the run: what was sent is what was sent.
      if (stepIndex < enrollment.stepIndex || (enrollment.sendClaim && enrollment.sendClaim.stepIndex === stepIndex)) {
        return { refusal: outreachRefusal(409, 'transition-refused', 'That step already went out to this person.') }
      }
      transaction.update(enrollments.doc(enrollmentId), {
        [`stepOverrides.${stepIndex}`]: override ?? FieldValue.delete(),
        updatedAtMs: nowMs,
      })
      const stepOverrides = { ...(enrollment.stepOverrides ?? {}) }
      if (override) stepOverrides[String(stepIndex)] = override
      else delete stepOverrides[String(stepIndex)]
      // Absent rather than empty once the last copy is cleared, as the
      // stored reader answers it.
      const next: OutreachEnrollment = { ...enrollment, updatedAtMs: nowMs }
      delete next.stepOverrides
      if (Object.keys(stepOverrides).length) next.stepOverrides = stepOverrides
      return { enrollment: next }
    })
    if ('refusal' in written) return written.refusal
    const { enrollment } = written

    if (override) {
      // The person's record says so (AGL-3274, AGL-3324): who wrote this
      // person's copy of the step, under the send it shapes.
      const entry = outreachCuratedEntry({
        enrollmentId,
        stepIndex,
        source: override.source,
        edited: override.edited === true,
        memberName: await memberName(firestore, caller),
        atMs: nowMs,
      })
      await fileOutreachNote(deps, {
        orgId: caller.orgId,
        hostId: enrollment.hostId,
        link: outreachEnrollmentLink(enrollment),
        dedupeKey: entry.dedupeKey,
        body: entry.body,
        atMs: nowMs,
      })
    }
    await deps.logOrgActivity(
      caller.orgId,
      { uid: caller.uid, email: caller.email },
      outreachCuratedActivity(stepIndex, cleared),
      { type: OUTREACH_SEQUENCE_ACTIVITY_TARGET, id: sequence.id, name: sequence.name },
    )
    return outreachOk({ ok: true, enrollment } satisfies OutreachCurateSaveResponse)
  }

  return { draft, save }
}

/** The text generator on the core's seam, for the default route deps; `null` when no plugin generates. */
export type OutreachTextGeneratorReader = () => PluginTextGenerator | null
