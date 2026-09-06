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
  type CrmActionStep,
  type CrmActivity,
  type CrmActivityLink,
  type CrmTask,
  crmEmailDeliveryTags,
  crmScopeTokens,
  normalizeContactEmail,
  readContactFacet,
  visibleToHost,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  countCrmActivitiesForRecord,
  firebaseAdmin,
  newCrmActivityRef,
  orgDataQueryForHost,
  writeCrmEmailActivity,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { HostEventPayload } from './run-event-workflows'

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
 * The contact an event payload names, as this site may see it.
 *
 * Id first, because a CRM event carries the document the door just wrote
 * and a lookup by id is a read, not a query. The address second, through
 * the SCOPED query, for every event that predates the CRM and knows only
 * who filled in the form.
 */
async function resolveEventContact(
  hostId: string,
  payload: HostEventPayload,
): Promise<ResolvedContact | null> {
  const { ref: contactsRef, query } = await orgDataQueryForHost(
    hostId,
    'contacts',
  )
  const contactId = String(payload['contactId'] ?? '').trim()
  if (contactId) {
    const doc = await contactsRef.doc(contactId).get()
    if (doc.exists && visibleToHost(doc.get('visibleTo'), hostId)) {
      return { id: doc.id, ref: doc.ref, data: doc.data() ?? {} }
    }
  }
  const email = normalizeContactEmail(payload['email'])
  if (!email) return null
  const hit = (await query.where('email', '==', email).limit(1).get()).docs[0]
  return hit ? { id: hit.id, ref: hit.ref, data: hit.data() ?? {} } : null
}

/**
 * The uid a step names for somebody on the team — an owner, an assignee —
 * resolved against the org's roster when the step names an address.
 *
 * `orgs/{orgId}/members/{uid}` is keyed by the uid, so a step authored with
 * one skips the read. An address is tried two ways, because two production
 * paths create a member document WITHOUT its `email` (a host-access re-grant,
 * and an add whose auth record carried none): the roster's own `email` field
 * first, then the project's Auth record for the address — accepted only when
 * the uid it names has a member document, so an address that belongs to some
 * account but not to this team resolves to nobody. An address that resolves
 * neither way is an error, not a stored string: `ownerUid` and `assigneeUid`
 * are fields every reader resolves as a member, and a stranger's uid in one
 * is a task nobody on the team can find.
 */
async function resolveMemberUid(
  orgId: string | null,
  named: { uid?: string; email?: string },
  role: 'owner' | 'assignee',
): Promise<{ uid: string; detail: string } | { error: string }> {
  const uid = named.uid?.trim() ?? ''
  if (uid) return { uid, detail: uid }
  const email = normalizeContactEmail(named.email)
  if (!email) return { error: `no ${role} named on the step` }
  if (!orgId) return { error: 'this site has no organization' }
  const members = firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
  const byField = (await members.where('email', '==', email).limit(1).get())
    .docs[0]
  if (byField) return { uid: byField.id, detail: email }
  // The roster is the only directory consulted. A project-level Auth lookup
  // by address would resolve people who are not on this organization at all
  // (AGL-1122), so a member document that carries no `email` cannot be named
  // by address here; the step reports the miss and the author names the uid.
  return { error: `no team member with the address ${email}` }
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
  const contact = await resolveEventContact(hostId, payload)
  if (!contact) {
    const named = String(payload['contactId'] ?? payload['email'] ?? '').trim()
    return {
      error: named
        ? `no contact this site can see for ${named}`
        : 'the event names no contact — no contactId or email in its payload',
    }
  }
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
    return { detail: tag }
  }

  if (step.type === 'assignContactOwner') {
    const owner = await resolveMemberUid(
      env.orgId,
      { uid: step.ownerUid, email: step.ownerEmail },
      'owner',
    )
    if ('error' in owner) return { error: owner.error }
    await contact.ref.update({
      [contactFacetPath(group.groupId, 'ownerUid')]: owner.uid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { detail: owner.detail }
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
    const task: CrmTask = {
      title,
      kind: step.kind,
      priority: 'normal',
      status: 'open',
      dueAtMs: nowMs + dueInDays * DAY_MS,
      ...(assignee ? { assigneeUid: assignee } : {}),
      createdByUid: '',
      sourceActionId: actionId,
      ...links,
      hostId,
      visibleTo,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    await orgRef.collection(CRM_COLLECTIONS.tasks).add(task)
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
    const contact = await resolveEventContact(env.hostId, payload)
    if (!contact || normalizeContactEmail(contact.data['email']) !== address) {
      return null
    }
    const group = await consentGroupForSite(env.hostId)
    const facet = readContactFacet(contact.data, group.groupId)
    const link: CrmActivityLink = {
      contactId: contact.id,
      ...(facet.companyId ? { companyId: facet.companyId } : {}),
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
