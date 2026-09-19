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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  CRM_COLLECTIONS,
  crmViewIsListed,
  normalizeCrmViewFilters,
} from '@aglyn/aglyn/app-utils/crm'
import { dynamicListDimensionsForCrmView } from '@aglyn/aglyn/app-utils/dynamic-list-rule'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { buildOutreachEnrollment, planOutreachFirstDue } from '../engine/enrollment-state'
import type { OutreachGateLookups } from '../engine/gates'
import {
  decideOutreachEnrollment,
  previewOutreachPerson,
  readOutreachEnrollCandidates,
  type OutreachEnrollCandidate,
  type OutreachGateQuestion,
} from '../enrollment/enroll-people'
import { readOutreachGateLookups } from '../enrollment/gate-lookups'
import { effectiveOutreachAllowedCountries } from '../model/compliance-settings'
import {
  OUTREACH_ENROLL_BATCH_MAX,
  type OutreachEnrollOutcome,
  type OutreachEnrollPreviewResponse,
  type OutreachEnrollResponse,
} from '../model/outreach-api'
import type { OutreachSequence } from '../model/outreach.types'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import {
  outreachEnrollmentId,
  outreachOrgCollection,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate, type OutreachRouteCaller, type OutreachRouteExtraPermission } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * ENROLLING PEOPLE IN A SEQUENCE (AGL-2980): `outreach/enroll/preview` and
 * `outreach/enroll`.
 *
 * The preview reads the people a saved Contacts view or a search named —
 * at most {@link OUTREACH_ENROLL_BATCH_MAX} — and says where each stands:
 * eligible, blocked with the gate's own sentence, or waiting on the rep for
 * a personal line and the attestations only they can make. Confirm reads
 * everything again and asks the gates again with what the rep supplied,
 * because a preview is a picture of a moment: someone can unsubscribe
 * between the two, and a request can claim anything. Nothing the preview
 * answered is trusted by the enroll.
 *
 * Both read the CRM's people, so both ask for `data.manage` beside
 * `outreach.use` — the permission the contacts' own rules read with, so
 * Outreach is no side door into the address book.
 *
 * Only an ACTIVE sequence takes people: enrolling schedules the first step
 * in the mailbox's hours, and a draft's steps and a paused sequence's timing
 * are not yet what will be sent.
 */

/** The permission enrolling reads the CRM with. */
export const OUTREACH_READS_PEOPLE: OutreachRouteExtraPermission = {
  key: 'data.manage',
  refusal: "Enrolling reads your CRM's contacts, and your role does not include Manage data.",
}

/** Everything enrolling reaches beyond the routes' own dependencies. */
export interface OutreachEnrollRouteDeps extends OutreachRouteDeps {
  /**
   * The addresses a saved Contacts view selects among one site's contacts,
   * read the way the dynamic-list sweep reads one, and whether the read
   * reached the whole view before its budget.
   */
  crmViewEmails(input: { hostId: string; viewId: string }): Promise<{ emails: string[]; complete: boolean }>
}

export interface OutreachEnrollRoutes {
  preview: PluginWebApiHandler
  confirm: PluginWebApiHandler
}

/** The activity line an enroll writes. */
export function outreachEnrolledActivity(count: number): string {
  return count === 1
    ? 'Enrolled 1 person in an Outreach sequence'
    : `Enrolled ${count} people in an Outreach sequence`
}

/** Lookups for a person the gates will never be asked about: every one unchecked. */
const UNCHECKED: OutreachGateLookups = {
  platformSuppressed: null,
  hostSuppressed: null,
  salesTopicState: null,
  doNotContact: null,
  workspaceMembers: null,
  openEnrollments: null,
  hasInboundEmail: null,
}

type Firestore = FirebaseFirestore.Firestore

/** gRPC `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6

async function loadActiveSequence(
  firestore: Firestore,
  orgId: string,
  rawSequenceId: unknown,
): Promise<Response | OutreachSequence> {
  const sequenceId = readOutreachDocumentId(rawSequenceId)
  if (!sequenceId) return outreachRefusal(400, 'invalid-request', 'Name the sequence to enroll people in.')
  const snapshot = await outreachOrgCollection(firestore, orgId, 'sequences').doc(sequenceId).get()
  const sequence = readStoredOutreachSequence(sequenceId, snapshot.exists ? snapshot.data() : undefined)
  if (!sequence) return outreachRefusal(404, 'sequence-not-found', 'That sequence no longer exists.')
  if (sequence.status === 'archived') {
    return outreachRefusal(409, 'sequence-archived', 'This sequence is archived and takes no one new.')
  }
  if (sequence.status !== 'active') {
    return outreachRefusal(409, 'sequence-not-active', 'Activate this sequence before enrolling people.')
  }
  return sequence
}

/** What every person in one request is judged against. */
interface EnrollContext {
  settings: OutreachGateQuestion['settings']
  contactGroupId: string
  siteName: string
}

async function enrollContext(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  sequence: OutreachSequence,
): Promise<EnrollContext> {
  const [orgSettings, host] = await Promise.all([
    readOutreachComplianceSettingsDoc(firestore, caller.orgId),
    firestore.collection('hosts').doc(sequence.hostId).get(),
  ])
  return {
    // The organization's countries are a ceiling over the sequence's.
    settings: {
      ...sequence.settings,
      allowedCountries: effectiveOutreachAllowedCountries(
        sequence.settings.allowedCountries,
        orgSettings.allowedCountries,
      ),
    },
    contactGroupId: consentGroupForHost(caller.org, sequence.hostId).groupId,
    siteName: host.exists ? String(host.get('name') ?? '') : '',
  }
}

/** The candidates, the enrollments they already have here, and the gates' lookups. */
async function readPeople(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  sequence: OutreachSequence,
  context: EnrollContext,
  contactIds: readonly string[],
): Promise<{
  candidates: OutreachEnrollCandidate[]
  enrolledHere: Set<string>
  lookups: Map<string, OutreachGateLookups>
}> {
  const candidates = await readOutreachEnrollCandidates(firestore, {
    orgId: caller.orgId,
    hostId: sequence.hostId,
    contactGroupId: context.contactGroupId,
    contactIds,
  })
  const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
  const existing = candidates.length
    ? await firestore.getAll(
        ...candidates.map((candidate) => enrollments.doc(outreachEnrollmentId(sequence.id, candidate.contactId))),
      )
    : []
  const enrolledHere = new Set(
    candidates.filter((_candidate, index) => existing[index]?.exists).map((candidate) => candidate.contactId),
  )
  const askable = candidates.filter((candidate) => candidate.contact && candidate.visible && candidate.email)
  const lookups = askable.length
    ? await readOutreachGateLookups(firestore, {
        orgId: caller.orgId,
        hostId: sequence.hostId,
        people: askable.map((candidate) => ({ contactId: candidate.contactId, email: String(candidate.email) })),
      })
    : new Map<string, OutreachGateLookups>()
  return { candidates, enrolledHere, lookups }
}

const uniqueIds = (values: unknown): string[] =>
  Array.isArray(values)
    ? [...new Set(values.map(readOutreachDocumentId).filter((id): id is string => id !== null))]
    : []

export function createOutreachEnrollRoutes(deps: OutreachEnrollRouteDeps): OutreachEnrollRoutes {
  /**
   * The contacts a source names, the batch limit applied: every contact a
   * search picked, or the people a saved Contacts view selects at the
   * sequence's site, found by address.
   */
  async function sourceContactIds(
    firestore: Firestore,
    caller: OutreachRouteCaller,
    sequence: OutreachSequence,
    source: Record<string, unknown>,
  ): Promise<Response | { contactIds: string[]; total: number; truncated: boolean }> {
    if (source['kind'] === 'contacts') {
      const ids = uniqueIds(source['contactIds'])
      if (!ids.length) return outreachRefusal(400, 'invalid-request', 'Pick the people to enroll.')
      return {
        contactIds: ids.slice(0, OUTREACH_ENROLL_BATCH_MAX),
        total: ids.length,
        truncated: ids.length > OUTREACH_ENROLL_BATCH_MAX,
      }
    }
    if (source['kind'] !== 'view') {
      return outreachRefusal(400, 'invalid-request', 'Enroll people from a saved view or a search.')
    }
    const viewId = readOutreachDocumentId(source['viewId'])
    const view = viewId
      ? await firestore.collection('orgs').doc(caller.orgId).collection(CRM_COLLECTIONS.views).doc(viewId).get()
      : null
    const data = view?.exists ? (view.data() as Record<string, unknown>) : null
    // A colleague's private view is theirs: it is not listed for this
    // reader, so it does not exist for them here either.
    if (
      !viewId ||
      !data ||
      !crmViewIsListed({ shared: data['shared'] === true, ownerUid: String(data['ownerUid'] ?? '') }, caller.uid)
    ) {
      return outreachRefusal(404, 'view-not-found', 'That saved view no longer exists.')
    }
    if (data['section'] !== 'contacts') {
      return outreachRefusal(400, 'view-unsupported', 'Enroll from a saved view of Contacts.')
    }
    const { unsupported } = dynamicListDimensionsForCrmView(normalizeCrmViewFilters(data['filters']))
    if (unsupported.length) {
      // Dropping the filter enrolling cannot read would enroll more people
      // than the view shows, so the view is refused whole.
      return outreachRefusal(
        400,
        'view-unsupported',
        `This view filters on ${unsupported.map((clause) => clause.label || clause.field).join(', ')}, which enrolling can't apply. Pick another view, or search.`,
      )
    }
    const { emails, complete } = await deps.crmViewEmails({ hostId: sequence.hostId, viewId })
    const ordered = [...new Set(emails)].sort()
    const contacts = firestore.collection('orgs').doc(caller.orgId).collection('contacts')
    const found = await Promise.all(
      ordered
        .slice(0, OUTREACH_ENROLL_BATCH_MAX)
        .map((email) => findContactByEmail(contacts, email, { hostId: sequence.hostId })),
    )
    return {
      contactIds: [...new Set(found.filter((snapshot) => snapshot).map((snapshot) => String(snapshot?.id)))],
      total: ordered.length,
      truncated: ordered.length > OUTREACH_ENROLL_BATCH_MAX || !complete,
    }
  }

  const preview: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate, [OUTREACH_READS_PEOPLE])
    if (caller instanceof Response) return caller
    const firestore = deps.firestore()
    const sequence = await loadActiveSequence(firestore, caller.orgId, body['sequenceId'])
    if (sequence instanceof Response) return sequence
    const source = body['source'] && typeof body['source'] === 'object' ? (body['source'] as Record<string, unknown>) : {}
    const named = await sourceContactIds(firestore, caller, sequence, source)
    if (named instanceof Response) return named
    const context = await enrollContext(firestore, caller, sequence)
    const { candidates, enrolledHere, lookups } = await readPeople(
      firestore,
      caller,
      sequence,
      context,
      named.contactIds,
    )
    const people = candidates.map((candidate) =>
      previewOutreachPerson(
        {
          candidate,
          lookups: lookups.get(candidate.contactId) ?? UNCHECKED,
          settings: context.settings,
          contactGroupId: context.contactGroupId,
        },
        { siteName: context.siteName, alreadyInSequence: enrolledHere.has(candidate.contactId) },
      ),
    )
    return outreachOk({
      ok: true,
      people,
      total: named.total,
      truncated: named.truncated,
    } satisfies OutreachEnrollPreviewResponse)
  }

  const confirm: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate, [OUTREACH_READS_PEOPLE])
    if (caller instanceof Response) return caller
    const firestore = deps.firestore()
    const sequence = await loadActiveSequence(firestore, caller.orgId, body['sequenceId'])
    if (sequence instanceof Response) return sequence

    const requested = new Map<string, { personalLine: string; attestations: unknown[] }>()
    for (const entry of Array.isArray(body['people']) ? body['people'] : []) {
      const person = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const contactId = readOutreachDocumentId(person['contactId'])
      if (!contactId || requested.has(contactId)) continue
      requested.set(contactId, {
        personalLine: typeof person['personalLine'] === 'string' ? person['personalLine'] : '',
        attestations: Array.isArray(person['attestations']) ? person['attestations'] : [],
      })
    }
    if (!requested.size) return outreachRefusal(400, 'invalid-request', 'Pick the people to enroll.')
    if (requested.size > OUTREACH_ENROLL_BATCH_MAX) {
      return outreachRefusal(
        400,
        'invalid-request',
        `Enroll at most ${OUTREACH_ENROLL_BATCH_MAX} people at a time.`,
      )
    }

    const mailboxSnapshot = sequence.mailboxId
      ? await outreachOrgCollection(firestore, caller.orgId, 'mailboxes').doc(sequence.mailboxId).get()
      : null
    const mailbox = readStoredOutreachMailbox(
      sequence.mailboxId,
      mailboxSnapshot?.exists ? mailboxSnapshot.data() : undefined,
    )
    if (!mailbox || mailbox.status === 'disconnected') {
      return outreachRefusal(
        409,
        'mailbox-unavailable',
        "This sequence's mailbox is no longer connected. Choose another mailbox for it before enrolling people.",
      )
    }
    const nowMs = deps.now()
    if (planOutreachFirstDue({ sequence, mailbox, enrolledAtMs: nowMs, random: deps.random }) === null) {
      return outreachRefusal(
        409,
        'mailbox-unavailable',
        "This sequence's sending hours never open in its mailbox's timezone. Fix the hours before enrolling people.",
      )
    }

    const context = await enrollContext(firestore, caller, sequence)
    const { candidates, enrolledHere, lookups } = await readPeople(
      firestore,
      caller,
      sequence,
      context,
      [...requested.keys()],
    )
    const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
    const results: OutreachEnrollOutcome[] = await Promise.all(
      candidates.map(async (candidate): Promise<OutreachEnrollOutcome> => {
        const supplied = requested.get(candidate.contactId) ?? { personalLine: '', attestations: [] }
        const decision = decideOutreachEnrollment(
          {
            candidate,
            lookups: lookups.get(candidate.contactId) ?? UNCHECKED,
            settings: context.settings,
            contactGroupId: context.contactGroupId,
          },
          { siteName: context.siteName, alreadyInSequence: enrolledHere.has(candidate.contactId) },
          { ...supplied, uid: caller.uid, nowMs },
        )
        if (!decision.allowed || !decision.email) {
          return { contactId: candidate.contactId, email: candidate.email, outcome: 'blocked', blocks: decision.blocks }
        }
        const id = outreachEnrollmentId(sequence.id, candidate.contactId)
        const enrollment = buildOutreachEnrollment({
          id,
          sequence,
          mailbox,
          contactId: candidate.contactId,
          contactName: candidate.name,
          email: decision.email,
          cold: decision.cold,
          personalLine: supplied.personalLine,
          attestations: decision.attestations,
          enrolledByUid: caller.uid,
          nowMs,
          random: deps.random,
        })
        try {
          await enrollments.doc(id).create(enrollment)
        } catch (error) {
          if ((error as { code?: unknown })?.code !== ALREADY_EXISTS) throw error
          return {
            contactId: candidate.contactId,
            email: candidate.email,
            outcome: 'blocked',
            blocks: [
              {
                code: 'already_in_sequence',
                reason: "This person has already been in this sequence, so they won't be sent its emails again.",
              },
            ],
          }
        }
        return { contactId: candidate.contactId, email: decision.email, outcome: 'enrolled', enrollmentId: id }
      }),
    )
    const enrolled = results.filter((result) => result.outcome === 'enrolled').length
    if (enrolled) {
      await deps.logOrgActivity(
        caller.orgId,
        { uid: caller.uid, email: caller.email },
        outreachEnrolledActivity(enrolled),
        { type: 'sequence', id: sequence.id, name: sequence.name },
      )
    }
    return outreachOk({ ok: true, results, enrolled } satisfies OutreachEnrollResponse)
  }

  return { preview, confirm }
}
