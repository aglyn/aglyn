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
  type CrmMergeContext,
  normalizeContactEmail,
  parseCrmMemberRef,
  personKey,
  readContactFacet,
  visibleToHost,
} from '@aglyn/aglyn/server'
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
// The leaf, not the barrel: this library's specs substitute the barrel
// wholesale, and the lookup must reach the real index logic under them.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { FieldValue } from 'firebase-admin/firestore'
// The leaves, not the runtime barrel, for the reason `run-event-actions.ts`
// gives: the specs substitute each one.
import {
  OWNER_ASSIGNMENT_REFUSALS,
  reassignContactOwner,
  reassignLeadOwner,
} from '@aglyn/tenant-runtime/assign-contact-owner'
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import type { HostActionStep, HostActionStepType } from '@aglyn/aglyn/app-utils/actions'

/**
 * The steps that act on the CRM (AGL-2605) — named as a set because the
 * executor dispatches all five to one module and the docs list them as one
 * group, and a step added to the union but not here would be a server step
 * the executor silently skipped.
 */
export const CRM_ACTION_STEP_TYPES: ReadonlySet<HostActionStepType> = new Set([
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
] as const)

/** The CRM steps, as the type the executor narrows to. */
export type CrmActionStep = Extract<
  HostActionStep,
  {
    type:
      | 'setContactStage'
      | 'addContactTag'
      | 'assignContactOwner'
      | 'createCrmTask'
      | 'logCrmActivity'
  }
>

export function isCrmActionStep(step: HostActionStep): step is CrmActionStep {
  return CRM_ACTION_STEP_TYPES.has(step.type)
}

/**
 * The CRM steps of an action run (AGL-2605): what `setContactStage`,
 * `addContactTag`, `assignContactOwner`, `createCrmTask` and
 * `logCrmActivity` actually write.
 *
 * Split out of `run-event-actions.ts` because the five share one shape the
 * other server steps do not: each begins by finding THE PERSON the event is
 * about, and each writes either inside the site's facet on that person or a
 * record stamped with the site's scope. One resolver and one scope
 * expression, used five times, rather than five copies drifting apart.
 *
 * ## The person is the event's, never the step's
 *
 * A step carries no contact reference. The contact is whoever the event
 * names — by `contactId` when the emitting door knew the document, and by
 * `email` otherwise, which is what every pre-CRM event carries. Both
 * lookups are scoped to what THIS site may see: a document the id names
 * but the site cannot read is treated as absent, exactly as the scoped
 * query would have treated it, so an event replayed against the wrong site
 * reaches nobody.
 *
 * ## A missing person is a reported no-op
 *
 * Nothing is written and the step's error names the reason, which lands in
 * the run summary beside the trigger — the same place "why didn't it
 * fire?" is answered for every other step. Silence here would make a
 * mis-wired trigger (a form with no email field) indistinguishable from a
 * working one.
 */

export interface CrmStepEnv {
  hostId: string
  /** The owning org's billing doc, already read by the run's gate. */
  org: unknown
  orgId: string | null
}

export interface CrmStepOutcome {
  /** The reason nothing was written, when nothing was. */
  error?: string
  /** The one fact worth carrying into the run summary. */
  detail?: string
  /**
   * An event this step's write earned, for the CALLER to fan out under its
   * own depth guard. Not emitted from here: a stage set by an automation is
   * itself a stage change, and the action listening for it must run — but
   * through the same nesting cap a `customEvent` chain has, or an action
   * that sets the stage it listens for would run until the meter ran dry.
   */
  emit?: { event: 'contactStageChanged'; payload: HostEventPayload }
}

const DAY_MS = 24 * 60 * 60 * 1000

interface ResolvedContact {
  id: string
  ref: FirebaseFirestore.DocumentReference
  data: Record<string, unknown>
}

/**
 * The person a CRM step acts on: a contact, or — when the workspace holds
 * none for them — the LEAD the site filed (AGL-3458).
 *
 * A lead-routed form files a lead and no contact (AGL-3232), and announces it
 * with the `lead` event. An automation welcoming that person — assign an
 * owner, book a call, tag them — has only the lead to act on, so each step
 * that has a lead's equivalent writes it there: the lead's own `ownerUid`,
 * its own `tags`, a task or an activity filed under `leadId`. A stage is a
 * contact's alone, and a step setting one on a lead says so.
 */
type ResolvedPerson =
  | ({ kind: 'contact' } & ResolvedContact)
  | ({ kind: 'lead' } & ResolvedContact)

/**
 * The contact an event payload names, as this site may see it.
 *
 * Id first, because a CRM event carries the document the door just wrote
 * and a lookup by id is a read, not a query. The address second, through
 * the org's address index narrowed to this site (AGL-2633), for every
 * event that predates the CRM and knows only who filled in the form — so
 * an address a merge folded into another record still reaches the person
 * who now holds it.
 */
async function resolveEventContact(
  hostId: string,
  payload: HostEventPayload,
): Promise<ResolvedContact | null> {
  const { ref: contactsRef } = await orgDataQueryForHost(hostId, 'contacts')
  const contactId = String(payload['contactId'] ?? '').trim()
  if (contactId) {
    const doc = await contactsRef.doc(contactId).get()
    if (doc.exists && visibleToHost(doc.get('visibleTo'), hostId)) {
      return { id: doc.id, ref: doc.ref, data: doc.data() ?? {} }
    }
  }
  const hit = await findContactByEmail(contactsRef, payload['email'], { hostId })
  return hit ? { id: hit.id, ref: hit.ref, data: hit.data() ?? {} } : null
}

/**
 * The lead an event names, as this site may see it: by `leadId` — the `lead`
 * event carries it, and it is the person's key — else by the key of the
 * `email`. A row this site cannot see is absent, exactly as a contact's is.
 */
async function resolveEventLead(
  hostId: string,
  payload: HostEventPayload,
): Promise<ResolvedContact | null> {
  const key = String(payload['leadId'] ?? '').trim() || personKey(payload['email']) || ''
  if (!key) return null
  const { ref: leadsRef } = await orgDataQueryForHost(hostId, 'leads')
  const doc = await leadsRef.doc(key).get()
  if (!doc.exists || !visibleToHost(doc.get('visibleTo'), hostId)) return null
  return { id: doc.id, ref: doc.ref, data: doc.data() ?? {} }
}

/** The contact the event names, else its lead — see {@link ResolvedPerson}. */
async function resolveEventPerson(
  hostId: string,
  payload: HostEventPayload,
): Promise<ResolvedPerson | null> {
  const contact = await resolveEventContact(hostId, payload)
  if (contact) return { kind: 'contact', ...contact }
  const lead = await resolveEventLead(hostId, payload)
  return lead ? { kind: 'lead', ...lead } : null
}

/**
 * The uid a step names for somebody on the team — an owner, an assignee —
 * resolved against the org's roster, whichever way the step named them.
 *
 * A step names a member by uid when a picker wrote it and by address when a
 * person typed it, and the editor's one text field accepts either — so both
 * fields are read through `parseCrmMemberRef`, and an address typed into
 * the uid slot or a uid typed into the address slot still names the person.
 *
 * Both are RESOLVED, not trusted. `orgs/{orgId}/members/{uid}` is keyed by
 * the uid, so a uid costs one document read and must exist: `ownerUid` and
 * `assigneeUid` are fields every reader resolves as a member, and a
 * stranger's uid in one is a task nobody on the team can find. An address
 * is matched on the roster's own `email` field, and two production paths
 * create a member document WITHOUT one (a host-access re-grant, and an add
 * whose auth record carried none) — such a member is named by uid, which
 * is the reason the editor takes one.
 *
 * The roster is the only directory consulted. A project-level Auth lookup
 * by address would resolve people who are not on this organization at all
 * (AGL-1122). A reference that resolves neither way is an error, not a
 * stored string.
 */
async function resolveMemberUid(
  orgId: string | null,
  named: { uid?: string; email?: string },
  role: 'owner' | 'assignee',
): Promise<{ uid: string; detail: string } | { error: string }> {
  const ref =
    parseCrmMemberRef(named.uid) ?? parseCrmMemberRef(named.email)
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
  const byField = (await members.where('email', '==', ref.email).limit(1).get())
    .docs[0]
  if (byField) return { uid: byField.id, detail: ref.email }
  return { error: `no team member with the address ${ref.email}` }
}

/**
 * Runs one CRM step for the person the event names. Never throws for a
 * missing person, an unknown owner or a site with no org — those are
 * answered as `error` so the run records them; a Firestore failure
 * propagates to the executor's catch like every other step's would.
 */
export async function runCrmActionStep(
  env: CrmStepEnv,
  actionId: string,
  step: CrmActionStep,
  payload: HostEventPayload,
  nowMs = Date.now(),
): Promise<CrmStepOutcome> {
  const { hostId } = env
  const person = await resolveEventPerson(hostId, payload)
  if (!person) {
    const named = String(payload['contactId'] ?? payload['email'] ?? '').trim()
    return {
      error: named
        ? `no contact or lead this site can see for ${named}`
        : 'the event names no contact — no contactId or email in its payload',
    }
  }
  if (person.kind === 'lead') return runLeadStep(env, actionId, step, person, nowMs)
  const contact = person
  /*
   * THE HOLDER whose facet the write addresses — the site's consent group,
   * which is the site alone unless the org declared the site one of a set
   * that presents as one sender. Same resolution the capture doors use, so
   * a stage set here lands in the facet the console reads.
   */
  const group = await consentGroupForSite(hostId)
  const facet = readContactFacet(contact.data, group.groupId)
  const email = String(contact.data['email'] ?? '')

  if (step.type === 'setContactStage') {
    const previous = facet.lifecycleStage ?? ''
    const label = CONTACT_LIFECYCLE_STAGE_LABELS[step.lifecycleStage]
    /*
     * A stage set to what it already is changes nothing and ANNOUNCES
     * nothing. The write is skipped so the row's `updatedAt` does not move
     * for a non-event, and the absent emit is what stops an action that
     * sets the stage it listens for from re-running on its own write —
     * the depth guard bounds that chain, this ends it at once.
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
     * modes, rather than a facet write of its own: the helper is what
     * moves the round-robin pointer inside the transaction that writes the
     * owner, mirrors the owner onto the site's lead, and tells the new
     * owner. A member named on the step is still resolved here — by
     * address against the roster, as before — and handed over by uid; the
     * helper checks the roster document again, which is one read and the
     * same answer.
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
      detail:
        step.roundRobin === true ? `round robin → ${verdict.ownerUid}` : named,
    }
  }

  // The two record creators: a task and an activity are documents of
  // their own beside the contact, stamped with the scope a contact
  // captured on this site would carry — `crmScopeTokens` is the create
  // path's own expression, so a record an automation made is visible to
  // exactly the sites a record a person made would be.
  if (!env.orgId) return { error: 'this site has no organization' }
  const orgRef = firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(env.orgId)
  const visibleTo = crmScopeTokens(
    (env.org ?? null) as Record<string, unknown> | null,
    group,
  )
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
     * The assignee the step names, else the person who OWNS the contact,
     * else nobody. A follow-up task belongs to whoever holds the
     * relationship, and an automation that had to name one person for
     * every contact it touches would assign the whole list to one rep. A
     * named assignee who cannot be resolved is an error rather than a
     * fallback to the owner: the author named somebody on purpose.
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
    await recomputeCrmNextTaskAt(firebaseAdmin.app().firestore(), env.orgId, [links]).catch((error: unknown) => {
      console.error('[workflow] next activity could not be recomputed', env.orgId, error)
    })
    return { detail: title.slice(0, 60) }
  }

  if (step.type === 'logCrmActivity') {
    const body = String(step.body ?? '')
      .trim()
      .slice(0, 2000)
    if (!body) return { error: 'the activity has no body' }
    /*
     * The per-record ceiling (AGL-2611), and this step is the writer it
     * exists for: a flow that logs on every page view fills one person's
     * log in an afternoon. Refused into the run history as an error, the
     * way an unresolvable assignee is, so the merchant reads why the flow
     * stopped writing rather than finding a log that silently stopped.
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
 * A CRM step on a LEAD (AGL-3458) — the person is not a contact yet, so each
 * step writes the lead's equivalent of what it writes on a contact. See
 * {@link ResolvedPerson}.
 */
async function runLeadStep(
  env: CrmStepEnv,
  actionId: string,
  step: CrmActionStep,
  lead: ResolvedContact,
  nowMs: number,
): Promise<CrmStepOutcome> {
  const { hostId } = env
  if (step.type === 'setContactStage') {
    return {
      error:
        'the event names a lead, and a lead has no lifecycle stage until it is ' +
        'converted to a contact',
    }
  }
  if (step.type === 'addContactTag') {
    const tag = String(step.tag ?? '')
      .trim()
      .slice(0, CONTACT_TAG_MAX_LENGTH)
    if (!tag) return { error: 'the step has no tag' }
    await lead.ref.update({
      tags: FieldValue.arrayUnion(tag),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // A lead's tags are what the Leads list searches (AGL-3321).
    await restampCrmListFieldsAt(lead.ref, 'leads')
    return { detail: `${tag} (lead)` }
  }
  if (step.type === 'assignContactOwner') {
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
    const verdict = await reassignLeadOwner({ hostId, leadId: lead.id, assign })
    if (verdict.outcome === 'none') {
      return { error: OWNER_ASSIGNMENT_REFUSALS[verdict.reason] }
    }
    if (verdict.outcome === 'unchanged') return { detail: `${named} (already, lead)` }
    return {
      detail:
        step.roundRobin === true
          ? `round robin → ${verdict.ownerUid} (lead)`
          : `${named} (lead)`,
    }
  }
  if (!env.orgId) return { error: 'this site has no organization' }
  const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(env.orgId)
  const group = await consentGroupForSite(hostId)
  const visibleTo = crmScopeTokens(
    (env.org ?? null) as Record<string, unknown> | null,
    group,
  )
  // Filed under the lead, as a sequence's call step files one (AGL-3233); a
  // conversion stamps the contact beside it, and the task follows the person.
  const links = { leadId: lead.id }
  if (step.type === 'createCrmTask') {
    const title = String(step.title ?? '')
      .trim()
      .slice(0, 200)
    if (!title) return { error: 'the task has no title' }
    const dueInDays = Math.max(0, Math.round(Number(step.dueInDays) || 0))
    // The named assignee, else whoever owns the lead NOW — an owner step
    // earlier in this same run wrote the lead after it was resolved, so it
    // is read again — else nobody.
    let assignee: string
    if (step.assigneeUid?.trim() || step.assigneeEmail?.trim()) {
      const named = await resolveMemberUid(
        env.orgId,
        { uid: step.assigneeUid, email: step.assigneeEmail },
        'assignee',
      )
      if ('error' in named) return { error: named.error }
      assignee = named.uid
    } else {
      const fresh = await lead.ref.get()
      assignee = String((fresh.data() ?? lead.data)['ownerUid'] ?? '')
    }
    const dueAtMs = nowMs + dueInDays * DAY_MS
    const task: CrmTask = {
      title,
      kind: step.kind,
      priority: 'normal',
      status: 'open',
      dueAtMs,
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
    await orgRef
      .collection(CRM_COLLECTIONS.tasks)
      .doc(createResourceUid())
      .set({ ...task, ...crmTaskListFields(task) })
    return { detail: `${title.slice(0, 60)} (lead)` }
  }
  if (step.type === 'logCrmActivity') {
    const body = String(step.body ?? '')
      .trim()
      .slice(0, 2000)
    if (!body) return { error: 'the activity has no body' }
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, links))) {
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
    await orgRef.collection(CRM_COLLECTIONS.activities).doc(createResourceUid()).set(activity)
    return { detail: `${step.kind} (lead)` }
  }
  return { error: `unknown CRM step "${(step as { type: string }).type}"` }
}

/**
 * The records an automation's email is about, for its merge tags (AGL-3458):
 * the contact the event names, else its lead, and the site's name — what
 * `resolveStepEmailMerge` reads, in the shape the one-to-one email's
 * resolver takes. A person nobody holds yet leaves both records out, and the
 * tags fall back to the name and address the event carried.
 *
 * **Never throws.** A lookup that fails is an email with its fallbacks, never
 * an email that did not leave.
 */
export async function automationEmailMergeContext(
  hostId: string,
  payload: HostEventPayload,
  site: { name?: string | null } | null,
): Promise<CrmMergeContext> {
  const context: CrmMergeContext = { ...(site ? { site } : {}) }
  try {
    const person = await resolveEventPerson(hostId, payload)
    if (person?.kind === 'contact') {
      const group = await consentGroupForSite(hostId)
      return { ...context, contact: person.data, contactGroupId: group.groupId }
    }
    if (person?.kind === 'lead') return { ...context, lead: person.data }
  } catch (error) {
    console.error('[workflow] email merge context could not be read', hostId, error)
  }
  return context
}

/**
 * The activity row a `sendEmail` step's message will be logged as, prepared
 * BEFORE the send (AGL-2615): the minted reference whose id rides the
 * message as a tag, the links it files under, and the scope it is stamped
 * with. `null` when the message earns no row.
 */
export interface PreparedCrmEmailActivity {
  ref: FirebaseFirestore.DocumentReference
  /** The provider tags the delivery webhook finds the row by. */
  tags: { name: string; value: string }[]
  link: CrmActivityLink
  visibleTo: string[]
}

/**
 * Whether — and where — an automation's email lands on a timeline.
 *
 * A `sendEmail` step is not a CRM step: it mails whatever address the event
 * carries, to a person who may be nobody the CRM knows. It earns a row on
 * exactly one condition, that the message is ADDRESSED TO THE CONTACT the
 * event is about — the person `resolveEventContact` finds, at the address
 * the row holds. A welcome sequence to a new contact is that; an internal
 * alert routed to a merchant's own address through `toField` is not, and a
 * row for it would put the merchant's inbox on a customer's history.
 *
 * Prepared ahead of the send, for the reason the console route mints its
 * id first: the webhook has nothing but the tags on the message to find
 * the row with. Nothing is written here. A record at the activity ceiling
 * earns no row — the message still goes, because the ceiling bounds the
 * log and not the mail — and neither does a site with no org to hold one.
 *
 * **Never throws.** The row is bookkeeping beside a send, and a lookup that
 * fails must not become a message that never left — the posture every
 * meter beside `sendEmail` takes. A failure here is logged and the message
 * goes out untagged.
 */
export async function prepareCrmEmailActivity(
  env: CrmStepEnv,
  to: string,
  payload: HostEventPayload,
): Promise<PreparedCrmEmailActivity | null> {
  if (!env.orgId) return null
  const address = normalizeContactEmail(to)
  if (!address) return null
  try {
    const person = await resolveEventPerson(env.hostId, payload)
    if (!person || normalizeContactEmail(person.data['email']) !== address) {
      return null
    }
    const group = await consentGroupForSite(env.hostId)
    // A lead's email lands on the lead's timeline (AGL-3458), as a person's
    // own send to a lead does.
    const facet = person.kind === 'contact' ? readContactFacet(person.data, group.groupId) : null
    const link: CrmActivityLink =
      person.kind === 'lead'
        ? { leadId: person.id }
        : {
            contactId: person.id,
            ...(facet?.companyId ? { companyId: facet.companyId } : {}),
          }
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(env.orgId)
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, link))) {
      return null
    }
    const ref = newCrmActivityRef(firestore, env.orgId)
    return {
      ref,
      tags: crmEmailDeliveryTags({
        orgId: env.orgId,
        hostId: env.hostId,
        activityId: ref.id,
      }),
      link,
      visibleTo: crmScopeTokens(
        (env.org ?? null) as Record<string, unknown> | null,
        group,
      ),
    }
  } catch (error) {
    console.error('[crm] automation email activity could not be prepared', env.hostId, error)
    return null
  }
}

/**
 * Writes the prepared row, once the provider has accepted the message.
 *
 * The same shape the console route logs — `buildCrmEmailActivity` is the
 * one builder — with the automation as its source and nobody as its
 * author. **Never throws**: the message has left, and a row that could not
 * be written is a gap on the timeline rather than a failed step.
 */
export async function logCrmEmailActivity(
  env: CrmStepEnv,
  prepared: PreparedCrmEmailActivity,
  message: { subject: string; body: string; to: string },
  actionId: string,
  nowMs = Date.now(),
): Promise<void> {
  try {
    await writeCrmEmailActivity(
      prepared.ref,
      buildCrmEmailActivity({
        subject: message.subject,
        body: message.body,
        to: normalizeContactEmail(message.to) ?? message.to,
        atMs: nowMs,
        byUid: '',
        sourceActionId: actionId,
        link: prepared.link,
        hostId: env.hostId,
        visibleTo: prepared.visibleTo,
      }),
    )
  } catch (error) {
    console.error('[crm] automation email activity write failed', prepared.ref.id, error)
  }
}
