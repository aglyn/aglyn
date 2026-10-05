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

import { stampRecordOrigin } from '@aglyn/aglyn/plugin-manager/plugin-record-origin'
import { normalizeContainerIds } from '@aglyn/aglyn/app-utils/container-membership'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  filePluginPersonUnder,
  pluginPeopleInView,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import type { PluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import type { PluginTextGenerator } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { readOrgContainers } from '@aglyn/tenant-data-admin/server/org-containers'
import { outreachCuratedEntry, outreachEnrolledEntry } from '../engine/enrollment-activity'
import {
  buildOutreachEnrollment,
  planOutreachFirstDue,
  readOutreachStartStepIndex,
} from '../engine/enrollment-state'
import { outreachEnrollmentSearchTokens } from '../enrollment/enrollment-search'
import type { OutreachGateLookups } from '../engine/gates'
import {
  decideOutreachEnrollment,
  previewOutreachPerson,
  readOutreachEnrollCandidates,
  type OutreachEnrollCandidate,
  type OutreachGateQuestion,
} from '../enrollment/enroll-people'
import { readOutreachGateLookups } from '../enrollment/gate-lookups'
import {
  outreachStepOverridesRefused,
  readOutreachStepOverrideRequests,
  type OutreachStepOverrideRead,
} from '../enrollment/step-overrides'
import { effectiveOutreachAllowedCountries } from '../model/compliance-settings'
import {
  OUTREACH_ENROLL_BATCH_MAX,
  type OutreachEnrollOutcome,
  type OutreachEnrollPreviewResponse,
  type OutreachEnrollResponse,
  type OutreachPersonRef,
} from '../model/outreach-api'
import type { OutreachSequence, OutreachStepOverrides } from '../model/outreach.types'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import { type OutreachDomainIntelReadInput, outreachMailboxSendingDomain } from '../storage/domain-intel-store'
import { fileOutreachNote } from '../runtime/timeline'
import {
  outreachEnrollmentId,
  outreachEnrollmentLink,
  outreachOrgCollection,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import { OUTREACH_SEQUENCE_ACTIVITY_TARGET, type OutreachRouteDeps } from './route-deps'
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
 *
 * Confirm may name `startStepIndex` (AGL-3228) for people who already had
 * the earlier steps by hand: everyone in the request begins at that step,
 * scheduled by its own delay from now, and the steps before it are marked
 * skipped on their enrollments. Absent, it is the first step; a step the
 * sequence does not have refuses the whole request.
 */

/** The permission enrolling reads the CRM with. */
export const OUTREACH_READS_PEOPLE: OutreachRouteExtraPermission = {
  key: 'data.manage',
  refusal: "Enrolling reads your CRM's contacts, and your role does not include Manage data.",
}

/** Everything enrolling reaches beyond the routes' own dependencies. */
export interface OutreachEnrollRouteDeps extends OutreachRouteDeps {
  /**
   * The workspace's record system on the timeline seam (AGL-3274), when a
   * plugin keeps one: the enroll files "Enrolled in" on the person's record
   * — the runtime's `timeline`, reached the same way.
   */
  timeline(): PluginRecordTimelineWriter | null
  /**
   * The workspace's text generator on the core's text-generation seam
   * (AGL-3324), which drafts one person's copies of the steps; `null` when
   * no plugin generates text, and the curate route says so.
   */
  textGenerator(): PluginTextGenerator | null
}

export interface OutreachEnrollRoutes {
  preview: PluginWebApiHandler
  confirm: PluginWebApiHandler
}

/** The activity line an enroll writes. */
export function outreachEnrolledActivity(count: number): string {
  return count === 1
    ? 'Enrolled 1 person in a sequence'
    : `Enrolled ${count} people in a sequence`
}

/** Lookups for a person the gates will never be asked about: every one unchecked. */
const UNCHECKED: OutreachGateLookups = {
  platformSuppressed: null,
  hostSuppressed: null,
  salesTopicState: null,
  doNotContact: null,
  doNotContactDomain: null,
  workspaceMembers: null,
  openEnrollments: null,
  hasInboundEmail: null,
  gateway: null,
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
  /** The sequence site's consent group, whose opt-outs all apply. */
  consentHostIds: readonly string[]
  /** Whether that group's sites wait for each other's confirmation click. */
  consentAwaitsConfirmation: boolean
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
  const consentGroup = consentGroupForHost(caller.org, sequence.hostId)
  return {
    // The organization's countries are a ceiling over the sequence's.
    settings: {
      ...sequence.settings,
      allowedCountries: effectiveOutreachAllowedCountries(
        sequence.settings.allowedCountries,
        orgSettings.allowedCountries,
      ),
    },
    contactGroupId: consentGroup.groupId,
    consentHostIds: consentGroup.hostIds,
    consentAwaitsConfirmation: consentGroup.awaitsConfirmation,
    siteName: host.exists ? String(host.get('name') ?? '') : '',
  }
}

/**
 * The candidates, the enrollments they already have here, and the gates'
 * lookups — every map keyed by the person's own id.
 *
 * "Already in this sequence" is answered two ways (AGL-3234): by the id the
 * person's enrollment would have, and by any enrollment in this sequence
 * that carries the person's ADDRESS. The second is what keeps a contact
 * from being enrolled beside the lead they were converted from: the lead's
 * enrollment followed them, under the lead's key, and still names them.
 */
/**
 * The domain the sequence's mailbox sends from (AGL-3328), whose gateway
 * ledger the Check-people chips read — or `null` when the mailbox cannot
 * be read, which shows the gateways without a history.
 */
async function sequenceSendingDomain(
  firestore: Firestore,
  orgId: string,
  sequence: OutreachSequence,
): Promise<string | null> {
  if (!sequence.mailboxId) return null
  try {
    const snapshot = await outreachOrgCollection(firestore, orgId, 'mailboxes').doc(sequence.mailboxId).get()
    const mailbox = readStoredOutreachMailbox(sequence.mailboxId, snapshot?.exists ? snapshot.data() : undefined)
    return outreachMailboxSendingDomain(mailbox)
  } catch (error) {
    console.error('[outreach] the sequence mailbox could not be read for its sending domain', error)
    return null
  }
}

async function readPeople(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  sequence: OutreachSequence,
  context: EnrollContext,
  people: readonly OutreachPersonRef[],
  gateway: OutreachDomainIntelReadInput,
): Promise<{
  candidates: OutreachEnrollCandidate[]
  enrolledHere: Set<string>
  lookups: Map<string, OutreachGateLookups>
}> {
  const candidates = await readOutreachEnrollCandidates({
    orgId: caller.orgId,
    hostId: sequence.hostId,
    contactGroupId: context.contactGroupId,
    people,
  })
  const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
  const existing = candidates.length
    ? await firestore.getAll(
        ...candidates.map((candidate) => enrollments.doc(outreachEnrollmentId(sequence.id, candidate.personId))),
      )
    : []
  const enrolledHere = new Set(
    candidates.filter((_candidate, index) => existing[index]?.exists).map((candidate) => candidate.personId),
  )
  const askable = candidates.filter((candidate) => candidate.contact && candidate.visible && candidate.email)
  const lookups = askable.length
    ? await readOutreachGateLookups(firestore, {
        orgId: caller.orgId,
        hostId: sequence.hostId,
        consentHostIds: context.consentHostIds,
        consentAwaitsConfirmation: context.consentAwaitsConfirmation,
        gateway,
        people: askable.map((candidate) => ({
          personId: candidate.personId,
          contactId: candidate.contactId || null,
          leadId: candidate.leadId,
          email: String(candidate.email),
        })),
      })
    : new Map<string, OutreachGateLookups>()
  for (const candidate of askable) {
    const open = lookups.get(candidate.personId)?.openEnrollments ?? []
    if (open.some((entry) => entry.sequenceId === sequence.id)) enrolledHere.add(candidate.personId)
  }
  return { candidates, enrolledHere, lookups }
}

const uniqueIds = (values: unknown): string[] =>
  Array.isArray(values)
    ? [...new Set(values.map(readOutreachDocumentId).filter((id): id is string => id !== null))]
    : []

export function createOutreachEnrollRoutes(deps: OutreachEnrollRouteDeps): OutreachEnrollRoutes {
  /**
   * The person joins the sequence's campaigns (AGL-3254), the moment they
   * are enrolled: `arrayUnion` on the lead's own `campaignIds`, or on the
   * contact's facet for the sequence's site — the same field, the same
   * shape, every other campaign member carries — and `enrolled` credited
   * to each campaign. After the enrollment is created and never before:
   * a person the create refused joins nothing. Neither write may fail the
   * enrollment, which already exists; a membership that could not be
   * stamped is one the list's bulk bar can add by hand.
   */
  async function joinSequenceCampaigns(
    orgId: string,
    sequence: OutreachSequence,
    candidate: OutreachEnrollCandidate,
    nowMs: number,
  ): Promise<void> {
    const campaignIds = normalizeContainerIds(sequence.campaignIds)
    if (!campaignIds.length) return
    try {
      const id = candidate.target === 'lead' ? candidate.leadId : candidate.contactId
      if (id) {
        // Filed by the plugin that keeps people (AGL-3080), as the sequence's
        // site holds the person: on a lead its own field, on a contact the
        // site's facet — the field every other campaign member carries.
        await filePluginPersonUnder({
          hostId: sequence.hostId,
          orgId,
          record: { kind: candidate.target, id },
          containerKind: 'campaign',
          ids: campaignIds,
        })
      }
    } catch (error) {
      console.error('[outreach] the enrolled person could not join the sequence’s campaigns', error)
    }
    try {
      await deps.creditCampaign({ hostId: sequence.hostId, orgId, campaignIds, outcome: 'enrolled', atMs: nowMs })
    } catch (error) {
      console.error('[outreach] the enrollment could not be credited to the sequence’s campaigns', error)
    }
  }

  /**
   * The names of the sequence's campaigns as they stand, for the entry the
   * enroll files on the person's record (AGL-3274) — the org's containers of
   * the `campaign` kind. Read once per request, not per person; a container
   * that is gone answers nothing and the entry names the rest.
   */
  async function sequenceCampaignNames(
    firestore: Firestore,
    orgId: string,
    sequence: OutreachSequence,
  ): Promise<string[]> {
    const campaignIds = normalizeContainerIds(sequence.campaignIds)
    if (!campaignIds.length || !orgId) return []
    try {
      const found = await readOrgContainers(firestore, 'campaign', orgId, campaignIds)
      return found.map((container) => container.name).filter(Boolean)
    } catch (error) {
      console.error('[outreach] the sequence’s campaigns could not be named for the record', error)
      return []
    }
  }

  /**
   * The people a source names, the batch limit applied: every contact a
   * search picked, every lead picked from the sequence's site, or the
   * people a saved Contacts or Leads view selects there — contacts found by
   * address, leads by their own key.
   */
  async function sourcePeople(
    caller: OutreachRouteCaller,
    sequence: OutreachSequence,
    source: Record<string, unknown>,
  ): Promise<Response | { people: OutreachPersonRef[]; total: number; truncated: boolean }> {
    if (source['kind'] === 'contacts' || source['kind'] === 'leads') {
      const kind = source['kind'] === 'leads' ? 'lead' : 'contact'
      const ids = uniqueIds(kind === 'lead' ? source['leadIds'] : source['contactIds'])
      if (!ids.length) return outreachRefusal(400, 'invalid-request', 'Pick the people to enroll.')
      return {
        people: ids.slice(0, OUTREACH_ENROLL_BATCH_MAX).map((id) => ({ kind, id })),
        total: ids.length,
        truncated: ids.length > OUTREACH_ENROLL_BATCH_MAX,
      }
    }
    if (source['kind'] !== 'view') {
      return outreachRefusal(400, 'invalid-request', 'Enroll people from a saved view or a search.')
    }
    const viewId = readOutreachDocumentId(source['viewId'])
    // The record system takes the view for the sequence's site (AGL-3080):
    // a colleague's private view is theirs, so it does not exist for this
    // member; a Leads view takes the site's leads by the view's status, a
    // Contacts view the contacts it selects there.
    const taken = viewId
      ? await pluginPeopleInView({
          orgId: caller.orgId,
          hostId: sequence.hostId,
          viewId,
          viewerUid: caller.uid,
          limit: OUTREACH_ENROLL_BATCH_MAX,
        })
      : null
    if (!taken || (taken.ok === false && taken.reason === 'not-found')) {
      return outreachRefusal(404, 'view-not-found', 'That saved view no longer exists.')
    }
    if (taken.ok === false && taken.reason === 'not-people') {
      return outreachRefusal(400, 'view-unsupported', 'Enroll from a saved view of Contacts or Leads.')
    }
    if (taken.ok === false) {
      // Dropping the filter enrolling cannot read would enroll more people
      // than the view shows, so the view is refused whole.
      return outreachRefusal(
        400,
        'view-unsupported',
        `This view filters on ${(taken.unsupported ?? []).join(', ') || 'something'}, which enrolling can't apply. Pick another view, or search.`,
      )
    }
    return {
      people: taken.people.map((person) => ({ kind: person.kind === 'lead' ? 'lead' : 'contact', id: person.id })),
      total: taken.total,
      truncated: taken.truncated,
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
    const named = await sourcePeople(caller, sequence, source)
    if (named instanceof Response) return named
    const context = await enrollContext(firestore, caller, sequence)
    const { candidates, enrolledHere, lookups } = await readPeople(
      firestore,
      caller,
      sequence,
      context,
      named.people,
      {
        resolveMx: deps.resolveMx,
        resolveAddress: deps.resolveAddress,
        nowMs: deps.now(),
        sendingDomain: await sequenceSendingDomain(firestore, caller.orgId, sequence),
      },
    )
    const people = candidates.map((candidate) =>
      previewOutreachPerson(
        {
          candidate,
          lookups: lookups.get(candidate.personId) ?? UNCHECKED,
          settings: context.settings,
          contactGroupId: context.contactGroupId,
        },
        { siteName: context.siteName, alreadyInSequence: enrolledHere.has(candidate.personId) },
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

    const nowMs = deps.now()
    const start = readOutreachStartStepIndex(body['startStepIndex'], sequence.steps)
    if (start.refusal !== null) return outreachRefusal(400, 'invalid-start-step', start.refusal)
    const startStepIndex = start.startStepIndex
    // Each person once, by whichever record they are: a contact by id, or a
    // lead by its key (AGL-3234). A person named both ways is a contact.
    const requested = new Map<
      string,
      { ref: OutreachPersonRef; personalLine: string; attestations: unknown[]; overrides: OutreachStepOverrideRead }
    >()
    for (const entry of Array.isArray(body['people']) ? body['people'] : []) {
      const person = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
      const contactId = readOutreachDocumentId(person['contactId'])
      const leadId = readOutreachDocumentId(person['leadId'])
      const ref: OutreachPersonRef | null = contactId
        ? { kind: 'contact', id: contactId }
        : leadId
          ? { kind: 'lead', id: leadId }
          : null
      if (!ref || requested.has(ref.id)) continue
      // The steps the member curated for this person (AGL-3324), validated
      // here rather than trusted: a copy that breaks a rule refuses the
      // whole request, so nobody is enrolled with a copy the route dropped.
      const overrides = readOutreachStepOverrideRequests(
        person['stepOverrides'],
        sequence.steps,
        { uid: caller.uid, nowMs },
        startStepIndex,
      )
      if (outreachStepOverridesRefused(overrides)) {
        return outreachRefusal(
          400,
          'invalid-override',
          overrides.refusal ?? 'A curated step breaks a rule every sequence email keeps.',
          { issues: overrides.issues },
        )
      }
      requested.set(ref.id, {
        ref,
        personalLine: typeof person['personalLine'] === 'string' ? person['personalLine'] : '',
        attestations: Array.isArray(person['attestations']) ? person['attestations'] : [],
        overrides,
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
    if (planOutreachFirstDue({ sequence, mailbox, enrolledAtMs: nowMs, random: deps.random, startStepIndex }) === null) {
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
      [...requested.values()].map((entry) => entry.ref),
      {
        resolveMx: deps.resolveMx,
        resolveAddress: deps.resolveAddress,
        nowMs,
        sendingDomain: outreachMailboxSendingDomain(mailbox),
      },
    )
    const enrollments = outreachOrgCollection(firestore, caller.orgId, 'enrollments')
    const campaignNames = await sequenceCampaignNames(firestore, caller.orgId, sequence)
    // The member's name for the curated entries (AGL-3324), read once per
    // request and only when a person carries a curated step.
    let memberNameRead: Promise<string | null> | null = null
    const memberName = () => {
      memberNameRead ??= firestore
        .collection('orgs')
        .doc(caller.orgId)
        .collection('members')
        .doc(caller.uid)
        .get()
        .then(
          (member) =>
            (member.exists
              ? String(member.get('displayName') ?? '').trim() || String(member.get('email') ?? '').trim()
              : '') || caller.email,
        )
        .catch(() => caller.email)
      return memberNameRead
    }
    const results: OutreachEnrollOutcome[] = await Promise.all(
      candidates.map(async (candidate): Promise<OutreachEnrollOutcome> => {
        const named = {
          personId: candidate.personId,
          target: candidate.target,
          contactId: candidate.contactId,
          leadId: candidate.leadId,
        }
        const supplied = requested.get(candidate.personId) ?? {
          personalLine: '',
          attestations: [],
          overrides: { overrides: {}, issues: [], refusal: null } satisfies OutreachStepOverrideRead,
        }
        const stepOverrides: OutreachStepOverrides = supplied.overrides.overrides
        const decision = decideOutreachEnrollment(
          {
            candidate,
            lookups: lookups.get(candidate.personId) ?? UNCHECKED,
            settings: context.settings,
            contactGroupId: context.contactGroupId,
          },
          { siteName: context.siteName, alreadyInSequence: enrolledHere.has(candidate.personId) },
          { personalLine: supplied.personalLine, attestations: supplied.attestations, uid: caller.uid, nowMs },
        )
        if (!decision.allowed || !decision.email) {
          return { ...named, email: candidate.email, outcome: 'blocked', blocks: decision.blocks }
        }
        const id = outreachEnrollmentId(sequence.id, candidate.personId)
        const enrollment = buildOutreachEnrollment({
          id,
          sequence,
          mailbox,
          target: candidate.target,
          contactId: candidate.contactId,
          leadId: candidate.leadId,
          contactName: candidate.name,
          email: decision.email,
          cold: decision.cold,
          personalLine: supplied.personalLine,
          attestations: decision.attestations,
          enrolledByUid: caller.uid,
          nowMs,
          random: deps.random,
          startStepIndex,
        })
        // The member ticked this person past the red gateway chip
        // (AGL-3326): that is their say-so, stamped as the hold's release,
        // so the engine does not hold the send they were just shown.
        if (decision.hold) {
          enrollment.gatewayHold = {
            gateway: decision.hold.gateway,
            heldAtMs: null,
            releasedByUid: caller.uid,
            releasedAtMs: nowMs,
          }
        }
        // The person's own copies of steps (AGL-3324) ride with the
        // enrollment from its first write: nothing sends between.
        if (Object.keys(stepOverrides).length) enrollment.stepOverrides = stepOverrides
        // What the enrollments table searches the person by (AGL-3321),
        // from the name and address this document captures for good.
        enrollment.searchTokens = outreachEnrollmentSearchTokens(enrollment)
        // Nobody has clicked yet (AGL-3332): stored, because the "Clicked: No"
        // filter is a query, and a query cannot find a field's absence.
        enrollment.clicked = false
        try {
          await enrollments.doc(id).create(enrollment)
        } catch (error) {
          if ((error as { code?: unknown })?.code !== ALREADY_EXISTS) throw error
          return {
            ...named,
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
        await joinSequenceCampaigns(caller.orgId, sequence, candidate, nowMs)
        // A person reached first by this sequence came from it (AGL-3519):
        // the record system stamps its Sequence lead source on a record
        // naming none, and leaves any other alone.
        await stampRecordOrigin({
          orgId: caller.orgId,
          hostId: sequence.hostId,
          email: decision.email,
          origin: 'sequence',
        })
        // The person's record says so (AGL-3274): "Enrolled in <sequence>",
        // with the campaigns it carried them into, once per enrollment.
        const entry = outreachEnrolledEntry({
          enrollmentId: id,
          sequenceName: sequence.name,
          campaignNames,
          startStepIndex,
        })
        await fileOutreachNote(deps, {
          orgId: caller.orgId,
          hostId: sequence.hostId,
          link: outreachEnrollmentLink(enrollment),
          dedupeKey: entry.dedupeKey,
          body: entry.body,
          atMs: nowMs,
        })
        // And one line per step the member curated for them (AGL-3324),
        // after the enrollment's own, so the record reads in order.
        for (const [key, override] of Object.entries(stepOverrides)) {
          const curated = outreachCuratedEntry({
            enrollmentId: id,
            stepIndex: Number(key),
            source: override.source,
            edited: override.edited === true,
            memberName: await memberName(),
            atMs: nowMs,
          })
          await fileOutreachNote(deps, {
            orgId: caller.orgId,
            hostId: sequence.hostId,
            link: outreachEnrollmentLink(enrollment),
            dedupeKey: curated.dedupeKey,
            body: curated.body,
            atMs: nowMs,
          })
        }
        return { ...named, email: decision.email, outcome: 'enrolled', enrollmentId: id }
      }),
    )
    const enrolled = results.filter((result) => result.outcome === 'enrolled').length
    if (enrolled) {
      await deps.logOrgActivity(
        caller.orgId,
        { uid: caller.uid, email: caller.email },
        outreachEnrolledActivity(enrolled),
        { type: OUTREACH_SEQUENCE_ACTIVITY_TARGET, id: sequence.id, name: sequence.name },
      )
    }
    return outreachOk({ ok: true, results, enrolled } satisfies OutreachEnrollResponse)
  }

  return { preview, confirm }
}
