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

import {
  buildCrmEmailActivity,
  checkEntitlement,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_TAG_MAX_LENGTH,
  contactFacetPath,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_COLLECTIONS,
  crmActivityLogHasRoom,
  type CrmActivity,
  type CrmActivityLink,
  type CrmTask,
  crmEmailDeliveryTags,
  crmScopeTokens,
  crmTaskListFields,
  crmTaskReminderAfterEdit,
  normalizeContactEmail,
  parseCrmMemberRef,
  planLabelGrantingFeature,
  readContactFacet,
  visibleToHost,
} from '@aglyn/aglyn/server'
import type {
  PluginRecordEmailPrepareRequest,
  PluginRecordPreparedEmail,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import type {
  ServerStepAnswer,
  ServerStepRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import {
  consentGroupForSite,
  countCrmActivitiesForRecord,
  firebaseAdmin,
  newCrmActivityRef,
  orgDataQueryForHost,
  recomputeCrmNextTaskAt,
  restampCrmListFieldsAt,
  writeCrmEmailActivity,
} from '@aglyn/tenant-data-admin'
// The leaf, not the barrel: the specs substitute the barrel wholesale, and
// the lookup must reach the real index logic under them.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { FieldValue } from 'firebase-admin/firestore'
// The leaf, not the runtime barrel: the specs substitute it.
import {
  OWNER_ASSIGNMENT_REFUSALS,
  reassignContactOwner,
} from './assign-contact-owner'
import type { HostActionStep } from '@aglyn/aglyn/app-utils/actions'
import type { CRM_STEP_TYPES } from '../constants/bundle-common'
import { CRM_SUITE_FEATURE } from './suite-gate'

/**
 * THE AUTOMATION STEPS THAT WRITE THE CRM (AGL-2605), run for the automation
 * engine through the platform's server-step seam (`plugin-server-steps`,
 * AGL-3080): `setContactStage`, `addContactTag`, `assignContactOwner`,
 * `createCrmTask` and `logCrmActivity`.
 *
 * The engine keeps the step's guard, the run's order, its history and the
 * nesting cap; this answers what the step did. A refusal is ANSWERED as
 * `error`, never thrown, and its words are the line the run history carries —
 * the same words the engine wrote when these steps were its own.
 *
 * The five share one shape no other step has: each begins by finding THE
 * PERSON the event is about, and each writes either inside the site's facet on
 * that person or a record stamped with the site's scope. One resolver and one
 * scope expression, used five times, rather than five copies drifting apart.
 *
 * ## The person is the event's, never the step's
 *
 * A step carries no contact reference. The contact is whoever the event
 * names — by `contactId` when the emitting door knew the document, and by
 * `email` otherwise, which is what every pre-CRM event carries. Both lookups
 * are scoped to what THIS site may see: a document the id names but the site
 * cannot read is treated as absent, exactly as the scoped query would have
 * treated it, so an event replayed against the wrong site reaches nobody.
 *
 * ## A missing person is a reported no-op
 *
 * Nothing is written and the step's error names the reason, which lands in
 * the run summary beside the trigger — the same place "why didn't it fire?"
 * is answered for every other step. Silence here would make a mis-wired
 * trigger (a form with no email field) indistinguishable from a working one.
 *
 * ## The plan gate is the CRM's
 *
 * Every step is refused on a workspace whose plan does not carry the CRM,
 * into the run history with the tier that carries it, so a Free workspace
 * whose flow names a CRM step reads why the step did nothing rather than a
 * log that says it ran. The org document is the one the run's gate already
 * read, handed over with the step, so the check costs no read.
 *
 * The same module answers the record timeline's `prepareEmail` (AGL-2615): an
 * automation's email addressed to the contact the event is about is filed on
 * that contact's timeline — see {@link prepareCrmRecordEmail}.
 */

/** One of the steps this module runs. */
export type CrmStepType = (typeof CRM_STEP_TYPES)[number]

/** A CRM step, as it is stored. */
export type CrmAutomationStep = Extract<HostActionStep, { type: CrmStepType }>

/** The site, the plan and the org a step or an email is answered for. */
interface CrmStepEnv {
  hostId: string
  /** The owning org's billing doc, already read by the run's gate. */
  org: unknown
  orgId: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

interface ResolvedContact {
  id: string
  ref: FirebaseFirestore.DocumentReference
  data: Record<string, unknown>
}

/**
 * The contact an event names, as this site may see it.
 *
 * Id first, because a CRM event carries the document the door just wrote and
 * a lookup by id is a read, not a query. The address second, through the
 * org's address index narrowed to this site (AGL-2633), for every event that
 * predates the CRM and knows only who filled in the form — so an address a
 * merge folded into another record still reaches the person who now holds it.
 */
async function resolveEventContact(
  hostId: string,
  named: { contactId?: unknown; email?: unknown },
): Promise<ResolvedContact | null> {
  const { ref: contactsRef } = await orgDataQueryForHost(hostId, 'contacts')
  const contactId = String(named.contactId ?? '').trim()
  if (contactId) {
    const doc = await contactsRef.doc(contactId).get()
    if (doc.exists && visibleToHost(doc.get('visibleTo'), hostId)) {
      return { id: doc.id, ref: doc.ref, data: doc.data() ?? {} }
    }
  }
  const hit = await findContactByEmail(contactsRef, named.email, { hostId })
  return hit ? { id: hit.id, ref: hit.ref, data: hit.data() ?? {} } : null
}

/**
 * The uid a step names for somebody on the team — an owner, an assignee —
 * resolved against the org's roster, whichever way the step named them.
 *
 * A step names a member by uid when a picker wrote it and by address when a
 * person typed it, and the editor's one text field accepts either — so both
 * fields are read through `parseCrmMemberRef`, and an address typed into the
 * uid slot or a uid typed into the address slot still names the person.
 *
 * Both are RESOLVED, not trusted. `orgs/{orgId}/members/{uid}` is keyed by the
 * uid, so a uid costs one document read and must exist: `ownerUid` and
 * `assigneeUid` are fields every reader resolves as a member, and a stranger's
 * uid in one is a task nobody on the team can find. An address is matched on
 * the roster's own `email` field, and two production paths create a member
 * document WITHOUT one (a host-access re-grant, and an add whose auth record
 * carried none) — such a member is named by uid, which is the reason the
 * editor takes one.
 *
 * The roster is the only directory consulted. A project-level Auth lookup by
 * address would resolve people who are not on this organization at all
 * (AGL-1122). A reference that resolves neither way is an error, not a stored
 * string.
 */
async function resolveMemberUid(
  orgId: string | null,
  named: { uid?: string; email?: string },
  role: 'owner' | 'assignee',
): Promise<{ uid: string; detail: string } | { error: string }> {
  const ref = parseCrmMemberRef(named.uid) ?? parseCrmMemberRef(named.email)
  if (!ref) return { error: `no ${role} named on the step` }
  if (!orgId) return { error: 'this site has no organization' }
  const members = firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
  if (ref.kind === 'uid') {
    const member = await members.doc(ref.uid).get()
    if (member.exists) return { uid: ref.uid, detail: ref.uid }
    return { error: `no team member with the id ${ref.uid}` }
  }
  const byField = (await members.where('email', '==', ref.email).limit(1).get()).docs[0]
  if (byField) return { uid: byField.id, detail: ref.email }
  return { error: `no team member with the address ${ref.email}` }
}

/**
 * Runs one CRM step for the person the event names: the executor the CRM
 * registers on the server-step seam for every type in `CRM_STEP_TYPES`.
 *
 * Never throws for a plan without the CRM, a missing person, an unknown owner
 * or a site with no org — those are answered as `error` so the run records
 * them; a Firestore failure propagates, and the engine records it the same
 * way.
 */
export async function runCrmAutomationStep(
  request: ServerStepRequest,
  nowMs = Date.now(),
): Promise<ServerStepAnswer> {
  if (!checkEntitlement(request.org as Parameters<typeof checkEntitlement>[0], CRM_SUITE_FEATURE)) {
    return { error: `CRM steps require the ${planLabelGrantingFeature(CRM_SUITE_FEATURE)} plan` }
  }
  const env: CrmStepEnv = { hostId: request.hostId, org: request.org, orgId: request.orgId }
  const step = request.step as unknown as CrmAutomationStep
  const actionId = request.run.id
  const { hostId } = env
  const contact = await resolveEventContact(hostId, request.payload)
  if (!contact) {
    const named = String(request.payload['contactId'] ?? request.payload['email'] ?? '').trim()
    return {
      error: named
        ? `no contact this site can see for ${named}`
        : 'the event names no contact — no contactId or email in its payload',
    }
  }
  /*
   * THE HOLDER whose facet the write addresses — the site's consent group,
   * which is the site alone unless the org declared the site one of a set
   * that presents as one sender. Same resolution the capture doors use, so a
   * stage set here lands in the facet the console reads.
   */
  const group = await consentGroupForSite(hostId)
  const facet = readContactFacet(contact.data, group.groupId)
  const email = String(contact.data['email'] ?? '')

  if (step.type === 'setContactStage') {
    const previous = facet.lifecycleStage ?? ''
    const label = CONTACT_LIFECYCLE_STAGE_LABELS[step.lifecycleStage]
    /*
     * A stage set to what it already is changes nothing and ANNOUNCES
     * nothing. The write is skipped so the row's `updatedAt` does not move for
     * a non-event, and the absent emit is what stops an action that sets the
     * stage it listens for from re-running on its own write — the engine's
     * nesting cap bounds that chain, this ends it at once.
     */
    if (previous === step.lifecycleStage) {
      return { detail: `${label} (already)` }
    }
    await contact.ref.update({
      [contactFacetPath(group.groupId, 'lifecycleStage')]: step.lifecycleStage,
      updatedAt: FieldValue.serverTimestamp(),
    })
    // The stage is what the Contacts list filters by (AGL-3321).
    await restampCrmListFieldsAt(contact.ref, 'contacts')
    /*
     * A stage set by an automation IS a stage change, and the action
     * listening for it must run — but through the engine's nesting cap, so
     * the event is answered back for the engine to raise, never raised here.
     */
    return {
      detail: label,
      emit: {
        event: 'contactStageChanged',
        payload: {
          contactId: contact.id,
          email,
          lifecycleStage: step.lifecycleStage,
          previousStage: previous,
        },
      },
    }
  }

  if (step.type === 'addContactTag') {
    const tag = String(step.tag ?? '')
      .trim()
      .slice(0, CONTACT_TAG_MAX_LENGTH)
    if (!tag) return { error: 'the step has no tag' }
    // `arrayUnion`, so the tag a merchant already applied by hand is not
    // duplicated and the tags beside it are kept.
    await contact.ref.update({
      [contactFacetPath(group.groupId, 'tags')]: FieldValue.arrayUnion(tag),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // The tags are what the Contacts list filters by (AGL-3321).
    await restampCrmListFieldsAt(contact.ref, 'contacts')
    return { detail: tag }
  }

  if (step.type === 'assignContactOwner') {
    /*
     * Through the one server assignment (AGL-2618), in both of the step's
     * modes, rather than a facet write of its own: the helper is what moves
     * the round-robin pointer inside the transaction that writes the owner,
     * mirrors the owner onto the site's lead, and tells the new owner. A
     * member named on the step is still resolved here — by address against
     * the roster, as before — and handed over by uid; the helper checks the
     * roster document again, which is one read and the same answer.
     */
    let assign: { memberUid: string } | { roundRobin: true }
    let named = 'round robin'
    if (step.roundRobin === true) {
      assign = { roundRobin: true }
    } else {
      const owner = await resolveMemberUid(
        env.orgId,
        { uid: step.ownerUid, email: step.ownerEmail },
        'owner',
      )
      if ('error' in owner) return { error: owner.error }
      assign = { memberUid: owner.uid }
      named = owner.detail
    }
    const verdict = await reassignContactOwner({
      hostId,
      contactId: contact.id,
      email,
      assign,
    })
    if (verdict.outcome === 'none') {
      return { error: OWNER_ASSIGNMENT_REFUSALS[verdict.reason] }
    }
    if (verdict.outcome === 'unchanged') {
      return { detail: `${named} (already)` }
    }
    return {
      detail: step.roundRobin === true ? `round robin → ${verdict.ownerUid}` : named,
    }
  }

  // The two record creators: a task and an activity are documents of their
  // own beside the contact, stamped with the scope a contact captured on this
  // site would carry — `crmScopeTokens` is the create path's own expression,
  // so a record an automation made is visible to exactly the sites a record a
  // person made would be.
  if (!env.orgId) return { error: 'this site has no organization' }
  const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(env.orgId)
  const visibleTo = crmScopeTokens((env.org ?? null) as Record<string, unknown> | null, group)
  const links = {
    contactId: contact.id,
    ...(facet.companyId ? { companyId: facet.companyId } : {}),
  }

  if (step.type === 'createCrmTask') {
    const title = String(step.title ?? '')
      .trim()
      .slice(0, 200)
    if (!title) return { error: 'the task has no title' }
    const dueInDays = Math.max(0, Math.round(Number(step.dueInDays) || 0))
    /*
     * The assignee the step names, else the person who OWNS the contact, else
     * nobody. A follow-up task belongs to whoever holds the relationship, and
     * an automation that had to name one person for every contact it touches
     * would assign the whole list to one rep. A named assignee who cannot be
     * resolved is an error rather than a fallback to the owner: the author
     * named somebody on purpose.
     */
    let assignee = facet.ownerUid ?? ''
    if (step.assigneeUid?.trim() || step.assigneeEmail?.trim()) {
      const named = await resolveMemberUid(
        env.orgId,
        { uid: step.assigneeUid, email: step.assigneeEmail },
        'assignee',
      )
      if ('error' in named) return { error: named.error }
      assignee = named.uid
    }
    const dueAtMs = nowMs + dueInDays * DAY_MS
    const task: CrmTask = {
      title,
      kind: step.kind,
      priority: 'normal',
      status: 'open',
      dueAtMs,
      // The reminder a person's task gets (AGL-2659): the due time.
      remindAtMs: crmTaskReminderAfterEdit({ dueAtMs, previous: null }),
      ...(assignee ? { assigneeUid: assignee } : {}),
      createdByUid: '',
      sourceActionId: actionId,
      ...links,
      hostId,
      visibleTo,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    // What the Tasks list searches by (AGL-3321), beside the task.
    await orgRef.collection(CRM_COLLECTIONS.tasks).add({ ...task, ...crmTaskListFields(task) })
    // The contact and company the task names carry `nextTaskAtMs` (AGL-2661);
    // a figure that could not move is the Fields section's recompute's.
    await recomputeCrmNextTaskAt(firebaseAdmin.app().firestore(), env.orgId, [links]).catch(
      (error: unknown) => {
        console.error('[crm] next activity could not be recomputed', env.orgId, error)
      },
    )
    return { detail: title.slice(0, 60) }
  }

  if (step.type === 'logCrmActivity') {
    const body = String(step.body ?? '')
      .trim()
      .slice(0, 2000)
    if (!body) return { error: 'the activity has no body' }
    /*
     * The per-record ceiling (AGL-2611), and this step is the writer it exists
     * for: a flow that logs on every page view fills one person's log in an
     * afternoon. Refused into the run history as an error, the way an
     * unresolvable assignee is, so the merchant reads why the flow stopped
     * writing rather than finding a log that silently stopped.
     */
    const logged = await countCrmActivitiesForRecord(orgRef, links)
    if (!crmActivityLogHasRoom(logged)) {
      return { error: CRM_ACTIVITY_LOG_FULL_MESSAGE }
    }
    const activity: CrmActivity = {
      kind: step.kind,
      body,
      atMs: nowMs,
      byUid: '',
      sourceActionId: actionId,
      ...links,
      hostId,
      visibleTo,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    await orgRef.collection(CRM_COLLECTIONS.activities).add(activity)
    return { detail: step.kind }
  }

  return { error: `unknown CRM step "${(step as { type: string }).type}"` }
}

/**
 * Whether — and where — an email a plugin is about to send lands on a
 * timeline: the CRM's answer to the record timeline's `prepareEmail`.
 *
 * An automation's `sendEmail` step is not a CRM step: it mails whatever
 * address the event carries, to a person who may be nobody the CRM knows. It
 * earns a row on exactly one condition, that the message is ADDRESSED TO THE
 * CONTACT the sender means — the person the request's link finds, at the
 * address the row holds. A welcome sequence to a new contact is that; an
 * internal alert routed to a merchant's own address through `toField` is not,
 * and a row for it would put the merchant's inbox on a customer's history.
 *
 * Prepared ahead of the send, for the reason the console route mints its id
 * first: the delivery webhook has nothing but the tags on the message to find
 * the row with. Nothing is written until `file` is called, once the provider
 * accepted the message. A workspace whose plan does not carry the CRM, a
 * record at the activity ceiling and a site with no org earn no row — the
 * message still goes, because the ceiling bounds the log and not the mail.
 *
 * **Never throws**, and neither does `file`. The row is bookkeeping beside a
 * send, and a lookup that fails must not become a message that never left —
 * the posture every meter beside a send takes. A failure is logged and the
 * message goes out untagged.
 */
export async function prepareCrmRecordEmail(
  request: PluginRecordEmailPrepareRequest,
): Promise<PluginRecordPreparedEmail | null> {
  const orgId = String(request.orgId ?? '').trim()
  const hostId = String(request.hostId ?? '').trim()
  if (!orgId || !hostId) return null
  const address = normalizeContactEmail(request.to)
  if (!address) return null
  try {
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    // The org the caller already read, or the one read here once.
    const org =
      request.org !== undefined ? request.org : ((await orgRef.get()).data() ?? null)
    if (!checkEntitlement(org as Parameters<typeof checkEntitlement>[0], CRM_SUITE_FEATURE)) {
      return null
    }
    const contact = await resolveEventContact(hostId, request.link)
    if (!contact || normalizeContactEmail(contact.data['email']) !== address) {
      return null
    }
    const group = await consentGroupForSite(hostId)
    const facet = readContactFacet(contact.data, group.groupId)
    const link: CrmActivityLink = {
      contactId: contact.id,
      ...(facet.companyId ? { companyId: facet.companyId } : {}),
    }
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, link))) {
      return null
    }
    const ref = newCrmActivityRef(firestore, orgId)
    const visibleTo = crmScopeTokens((org ?? null) as Record<string, unknown> | null, group)
    return {
      tags: crmEmailDeliveryTags({ orgId, hostId, activityId: ref.id }),
      /*
       * The same shape the console route logs — `buildCrmEmailActivity` is the
       * one builder — with the sender's id as its source and nobody as its
       * author. Never throws: the message has left, and a row that could not
       * be written is a gap on the timeline rather than a failed send.
       */
      async file(sent) {
        try {
          await writeCrmEmailActivity(
            ref,
            buildCrmEmailActivity({
              subject: sent.subject,
              body: sent.body,
              to: normalizeContactEmail(sent.to) ?? sent.to,
              atMs: sent.atMs ?? Date.now(),
              byUid: '',
              sourceActionId: sent.sourceRef,
              link,
              hostId,
              visibleTo,
            }),
          )
        } catch (error) {
          console.error('[crm] automation email activity write failed', ref.id, error)
        }
      },
    }
  } catch (error) {
    console.error('[crm] automation email activity could not be prepared', hostId, error)
    return null
  }
}
