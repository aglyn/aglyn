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
  assignmentRuleMatches,
  consentGroupForHost,
  contactFacetPath,
  type ContactSource,
  CRM_ROUND_ROBIN_LAST_ASSIGNED_PATH,
  type CrmAssignmentTarget,
  personKey,
  readContactFacet,
  readCrmAssignmentSettings,
  roundRobinOrder,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  notifyUsers,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * WHO A NEW RECORD BELONGS TO — the one place an owner is decided on the
 * server (AGL-2618).
 *
 * Two entry points over one transaction. `assignOwnerForCapture` is the
 * capture door's pass: it runs the org's assignment rules in order, falls
 * back to the capturing site's default owner, and touches only a record
 * that has NO owner — a door that named one (the console's drawer, an
 * import column, a conversion with a picked owner) has expressed a person's
 * choice. `reassignContactOwner` is the automation's: an author who put
 * "assign an owner" on a stage change means to reassign, and the step hands
 * this either a member or the rotation.
 *
 * ## One transaction, because the pointer is shared
 *
 * The round-robin pool's pointer lives on the org document, and two
 * captures landing together must take two different members. Firestore
 * transactions serialize on what they read, so the org document, the
 * contact and the roster documents are all read inside the transaction and
 * the pointer is advanced in the same commit that writes the owner: a
 * concurrent capture that read the same pointer retries and reads the moved
 * one. The alternative — read the pointer, decide, then write — is exactly
 * the read-then-write shape that lets two captures pick the same person.
 *
 * ## The roster is checked, once per member per attempt
 *
 * A rule may name a member who has since left, and a pool may hold one. A
 * rule naming nobody on the roster is passed over rather than stopping the
 * pass — the next rule may well assign — and a pool member who is gone is
 * skipped for the next in the order. `orgs/{orgId}/members/{uid}` is keyed
 * by uid, so the check is one document read per candidate, and only the
 * roster is consulted: a project-level Auth lookup would admit people who
 * are not on this organization at all (AGL-1122).
 *
 * ## The lead follows the contact
 *
 * The capture doors that file a lead (`addHostLead`: a form routed to leads,
 * a sign-up, a booking) key it by `personKey(email)`, so the lead's document
 * is addressable from the capture alone. When it exists it is given the same
 * owner in the same transaction; two doors write the lead AFTER the contact
 * they `void`ed, so for those sources the mirror is retried a few times over
 * the next seconds, detached, and the person's Leads list shows the owner
 * as soon as the lead is there.
 *
 * ## The owner is told, unless they chose themselves
 *
 * One console notification per assignment, for the record the recipient
 * will open: the lead when the site holds one for this person, the contact
 * otherwise. Not when the actor IS the new owner — a rep who converts a
 * lead into their own contact has not been handed anything.
 *
 * ## Never rejects
 *
 * The capture has already succeeded and a form submission must not fail
 * because the CRM could not decide who follows up; a failure is logged and
 * answered as `none`, and the record is exactly as assignable by hand as it
 * was before this existed. The automation executor turns a `none` into the
 * step's recorded error.
 */

export interface OwnerAssignmentInput {
  hostId: string
  /** `orgs/{orgId}/contacts/{contactId}` — the record the owner is written on. */
  contactId: string
  /** The contact's address, which keys the lead and names the person in the notification. */
  email: string
  /**
   * The signed-in person making the assignment, when there is one. Never
   * notified about their own choice; absent for a capture and an automation.
   */
  actorUid?: string | null
}

export interface CaptureAssignmentInput extends OwnerAssignmentInput {
  source: ContactSource
  /** The form the capture came through, for a rule conditioned on it. */
  formId?: string | null
  /** The tags the capture carried; the contact's own are read from the facet. */
  tags?: readonly string[]
}

export interface ReassignmentInput extends OwnerAssignmentInput {
  assign: CrmAssignmentTarget
}

/** Why an assignment assigned nobody — the automation reports these verbatim. */
export type OwnerAssignmentRefusal =
  | 'no-org'
  | 'no-contact'
  | 'no-rule'
  | 'empty-pool'
  | 'not-a-member'
  | 'failed'

/** What decided an assignment: a rule, the site default, the step's member, or the rotation. */
export type OwnerAssignedBy = 'rule' | 'default' | 'member' | 'roundRobin'

export type OwnerAssignment =
  | {
      outcome: 'assigned'
      ownerUid: string
      by: OwnerAssignedBy
      /** The rule that decided it, when one did. */
      ruleId?: string
      /** The lead document existed and now carries the owner too. */
      leadMirrored: boolean
      /** A notification was fanned out to the new owner. */
      notified: boolean
    }
  /** The record already had this owner (a capture), or the same one was named again (a reassignment). */
  | { outcome: 'unchanged'; ownerUid: string }
  | { outcome: 'none'; reason: OwnerAssignmentRefusal }

/** The words the run history and the log give each refusal. */
export const OWNER_ASSIGNMENT_REFUSALS: Record<OwnerAssignmentRefusal, string> = {
  'no-org': 'this site has no organization',
  'no-contact': 'the contact no longer exists',
  'no-rule': 'no assignment rule matched and the site has no default owner',
  'empty-pool': 'the round-robin pool has nobody on the roster in it',
  'not-a-member': 'the owner named is not on the team',
  failed: 'the owner could not be assigned',
}

/**
 * The doors whose lead lands after the contact they `void`ed — the ones the
 * mirror is worth retrying for. An order, an import, a manual add and an
 * API call file no lead, and a retry for them would be reads for nothing.
 */
const LEAD_FILING_SOURCES: ReadonlySet<ContactSource> = new Set([
  'form',
  'member',
  'booking',
])

/** How long the detached lead mirror waits between its looks, in order. */
const LEAD_MIRROR_RETRY_MS: readonly number[] = [1_000, 2_000, 3_000]

type Policy =
  | { kind: 'capture'; input: CaptureAssignmentInput }
  | { kind: 'reassign'; input: ReassignmentInput }

interface Decision {
  ownerUid: string
  by: OwnerAssignedBy
  ruleId?: string
  /** The pointer moves only when the rotation chose. */
  advancePointer: boolean
}

/**
 * The console path the owner's notification opens, in the `/{hostDocId}/rest`
 * shape every host notification uses — the console rewrites it to
 * `/{orgSlug}/hosts/{subdomain}/rest` when the link is followed, which is
 * why `hostId` and `orgId` travel on the document. The same spelling the
 * CRM's task notification uses; the hub's own route builder lives in the
 * plugin, which this layer cannot import.
 */
function recordLink(
  hostId: string,
  record: { kind: 'contact'; id: string } | { kind: 'lead'; id: string },
): string {
  const section = record.kind === 'contact' ? 'contacts' : 'leads'
  return `/${hostId}/crm/${section}/${encodeURIComponent(record.id)}`
}

async function assignOwner(policy: Policy): Promise<OwnerAssignment> {
  const { input } = policy
  try {
    const resolved = await getOrgForHost(input.hostId)
    if (!resolved) return { outcome: 'none', reason: 'no-org' }
    const { orgId } = resolved
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const contactRef = orgRef.collection('contacts').doc(input.contactId)
    const membersRef = orgRef.collection('members')
    const leadKey = personKey(input.email)
    const leadRef = leadKey
      ? firestore
          .collection('hosts')
          .doc(input.hostId)
          .collection('leads')
          .doc(leadKey)
      : null

    let contactName = ''
    const verdict = await firestore.runTransaction(
      async (tx): Promise<OwnerAssignment> => {
        /*
         * ALL READS BEFORE THE WRITE, which Firestore requires. The org
         * document is read here rather than trusted from `getOrgForHost`,
         * because the pointer it carries is the one thing a concurrent
         * capture may have moved, and the rules and the pool are read from
         * the same snapshot so the decision and the pointer agree.
         */
        const [orgSnapshot, contactSnapshot, leadSnapshot] = await Promise.all([
          tx.get(orgRef),
          tx.get(contactRef),
          leadRef ? tx.get(leadRef) : Promise.resolve(null),
        ])
        if (!contactSnapshot.exists) {
          return { outcome: 'none', reason: 'no-contact' }
        }
        const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
        const contact = (contactSnapshot.data() ?? {}) as Record<string, unknown>
        contactName = String(contact['name'] ?? '')
        const group = consentGroupForHost(org, input.hostId)
        const facet = readContactFacet(contact, group.groupId)
        const current = typeof facet.ownerUid === 'string' ? facet.ownerUid : ''
        if (policy.kind === 'capture' && current) {
          return { outcome: 'unchanged', ownerUid: current }
        }
        const settings = readCrmAssignmentSettings(org)

        // One read per candidate per attempt; a retried transaction reads
        // afresh, as it must.
        const onRoster = new Map<string, Promise<boolean>>()
        const isMember = (uid: string): Promise<boolean> => {
          let known = onRoster.get(uid)
          if (!known) {
            known = tx.get(membersRef.doc(uid)).then((snapshot) => snapshot.exists)
            onRoster.set(uid, known)
          }
          return known
        }
        const fromPool = async (): Promise<string | null> => {
          for (const uid of roundRobinOrder(
            settings.pool.memberUids,
            settings.pool.lastAssignedUid,
          )) {
            if (await isMember(uid)) return uid
          }
          return null
        }
        const resolveTarget = async (
          target: CrmAssignmentTarget,
        ): Promise<{ uid: string; advancePointer: boolean } | null> => {
          if ('roundRobin' in target) {
            const uid = await fromPool()
            return uid ? { uid, advancePointer: true } : null
          }
          return (await isMember(target.memberUid))
            ? { uid: target.memberUid, advancePointer: false }
            : null
        }

        let decision: Decision | null = null
        let refusal: OwnerAssignmentRefusal = 'no-rule'
        if (policy.kind === 'capture') {
          const capture = {
            source: policy.input.source,
            email: input.email,
            formId: policy.input.formId ?? null,
            tags: [...(policy.input.tags ?? []), ...(facet.tags ?? [])],
          }
          for (const rule of settings.rules) {
            if (!assignmentRuleMatches(rule.when, capture)) continue
            const hit = await resolveTarget(rule.assign)
            if (hit) {
              decision = { ...hit, ownerUid: hit.uid, by: 'rule', ruleId: rule.id }
              break
            }
          }
          const fallback = settings.hostDefaultOwners[input.hostId]
          if (!decision && fallback && (await isMember(fallback))) {
            decision = { ownerUid: fallback, by: 'default', advancePointer: false }
          }
        } else {
          const { assign } = policy.input
          const hit = await resolveTarget(assign)
          if (hit) {
            decision = {
              ...hit,
              ownerUid: hit.uid,
              by: 'roundRobin' in assign ? 'roundRobin' : 'member',
            }
          } else {
            refusal = 'roundRobin' in assign ? 'empty-pool' : 'not-a-member'
          }
        }
        if (!decision) return { outcome: 'none', reason: refusal }
        if (decision.ownerUid === current) {
          return { outcome: 'unchanged', ownerUid: current }
        }

        tx.update(contactRef, {
          [contactFacetPath(group.groupId, 'ownerUid')]: decision.ownerUid,
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (decision.advancePointer) {
          tx.update(orgRef, {
            [CRM_ROUND_ROBIN_LAST_ASSIGNED_PATH]: decision.ownerUid,
          })
        }
        /*
         * A lead somebody already assigned by hand keeps its owner on a
         * capture — the contact was new, the lead may not have been — and
         * follows the contact on a deliberate reassignment.
         */
        const leadOwner = String(leadSnapshot?.get('ownerUid') ?? '')
        const leadMirrored = Boolean(
          leadSnapshot?.exists && (policy.kind === 'reassign' || !leadOwner),
        )
        if (leadMirrored && leadRef) {
          tx.update(leadRef, {
            ownerUid: decision.ownerUid,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        return {
          outcome: 'assigned',
          ownerUid: decision.ownerUid,
          by: decision.by,
          ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
          leadMirrored,
          notified: false,
        }
      },
    )
    if (verdict.outcome !== 'assigned') return verdict

    if (
      !verdict.leadMirrored &&
      leadRef &&
      policy.kind === 'capture' &&
      LEAD_FILING_SOURCES.has(policy.input.source)
    ) {
      void mirrorOwnerOntoLeadLater(leadRef, verdict.ownerUid)
    }

    const notified = verdict.ownerUid !== (input.actorUid ?? '')
    if (notified) {
      const who = contactName || input.email
      await notifyUsers([verdict.ownerUid], {
        type: verdict.leadMirrored ? 'content.leadAssigned' : 'content.contactAssigned',
        title: verdict.leadMirrored ? 'Lead assigned to you' : 'Contact assigned to you',
        body: who,
        link: recordLink(
          input.hostId,
          verdict.leadMirrored && leadKey
            ? { kind: 'lead', id: leadKey }
            : { kind: 'contact', id: input.contactId },
        ),
        orgId,
        hostId: input.hostId,
      })
    }
    return { ...verdict, notified }
  } catch (error) {
    console.error(
      'assignContactOwner failed',
      input.hostId,
      input.contactId,
      error,
    )
    return { outcome: 'none', reason: 'failed' }
  }
}

/**
 * The detached second look for a lead that lands after the contact.
 *
 * Bounded, and only ever ADDS an owner: a lead that arrived with one (a
 * person assigned it in the meantime) is left alone, and a lead that never
 * arrives costs three reads over six seconds and nothing else. Detached
 * because the capture must not hold `contactCreated` back for it — an
 * automation welcoming the contact has nothing to do with the lead's owner
 * column.
 */
async function mirrorOwnerOntoLeadLater(
  leadRef: FirebaseFirestore.DocumentReference,
  ownerUid: string,
  delaysMs: readonly number[] = LEAD_MIRROR_RETRY_MS,
): Promise<boolean> {
  for (const delay of delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      const lead = await leadRef.get()
      if (!lead.exists) continue
      if (String(lead.get('ownerUid') ?? '')) return false
      await leadRef.update({
        ownerUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    } catch (error) {
      console.error('assignContactOwner lead mirror failed', leadRef.path, error)
      return false
    }
  }
  return false
}

/**
 * The capture door's pass: the org's rules in order, then the capturing
 * site's default owner, on a record that has no owner yet. See the module
 * comment for the whole of it.
 */
export function assignOwnerForCapture(
  input: CaptureAssignmentInput,
): Promise<OwnerAssignment> {
  return assignOwner({ kind: 'capture', input })
}

/**
 * The deliberate assignment — the `assignContactOwner` step, and a person
 * handing a record to somebody: a member by uid (verified on the roster) or
 * the next in the round-robin pool, overwriting whoever held it. Naming the
 * owner the record already has changes nothing and tells nobody.
 */
export function reassignContactOwner(
  input: ReassignmentInput,
): Promise<OwnerAssignment> {
  return assignOwner({ kind: 'reassign', input })
}

export default assignOwnerForCapture
