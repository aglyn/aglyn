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

/**
 * THE LOOKUPS THE ENROLLMENT GATES DECIDE ON (AGL-2980).
 *
 * `evaluateOutreachGates` is pure: it reads a contact as stored and the
 * RESULTS of the reads the runtime makes. This is those reads, for many
 * people at once — the enroll preview asks about everyone a view names in
 * one pass, and the sending runtime asks about one person before each send
 * with the same function, so the two can never consult different lists.
 *
 * Server only. Every list keyed by address is read with one `getAll` over
 * `personKey` ids — the suppression lists, the sales topic opt-outs, the
 * do-not-contact list — so a lookup costs one round trip however many
 * people it covers, and needs no index that could go missing. The roster
 * is read once. The two per-person facts that are queries — the person's
 * other enrollments and whether they ever wrote in — are equality filters
 * on single fields.
 *
 * ## A read that failed is `null`, and `null` refuses
 *
 * Each lookup is caught on its own and answers `null` for everyone it
 * covered, which the gates read as "we couldn't check" and refuse: a
 * person who asked not to be emailed must not be emailed because a read
 * timed out. One failed list does not blank the others.
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import {
  EMAIL_TOPIC_SALES,
  readTopicSubscriptionState,
  TOPIC_OPT_OUTS_SUBCOLLECTION,
  type TopicSubscriptionState,
} from '@aglyn/aglyn/app-utils/email-topics'
import type { MemberAddresses } from '@aglyn/aglyn/app-utils/member-email-aliases'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { loadCrmInboundRoster } from '@aglyn/tenant-data-admin/server/crm-inbound-email'
import {
  EMAIL_SUPPRESSIONS_COLLECTION,
  HOST_SUPPRESSIONS_SUBCOLLECTION,
} from '@aglyn/tenant-data-admin/server/email-suppression'
import type { OutreachGateLookups } from '../engine/gates'
import type { OutreachEnrollmentStatus } from '../model/outreach.types'
import { lookupOutreachDoNotContact } from '../storage/do-not-contact-store'
import { outreachOrgCollection } from '../storage/outreach-records'

/** One person to look up: the contact, and the address the steps go to. */
export interface OutreachGateLookupPerson {
  contactId: string
  email: string
}

export interface ReadOutreachGateLookupsInput {
  orgId: string
  /** The sequence's site: whose suppression list and topic opt-outs apply. */
  hostId: string
  people: readonly OutreachGateLookupPerson[]
}

type Firestore = FirebaseFirestore.Firestore

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
 * One keyed list, read for every person at once: `answer` turns each
 * person's document into their answer. An address that cannot be keyed has
 * no document anywhere and is answered as unchecked, and so is everyone
 * when the read fails.
 */
async function keyedLookup<T>(
  firestore: Firestore,
  people: readonly OutreachGateLookupPerson[],
  collection: (key: string) => FirebaseFirestore.DocumentReference,
  answer: (snapshot: FirebaseFirestore.DocumentSnapshot) => T,
  label: string,
): Promise<Map<string, T | null>> {
  const answers = new Map<string, T | null>()
  const keyed: Array<{ contactId: string; key: string }> = []
  for (const person of people) {
    const key = personKey(person.email)
    if (key) keyed.push({ contactId: person.contactId, key })
    else answers.set(person.contactId, null)
  }
  if (!keyed.length) return answers
  try {
    const snapshots = await getAllChunked(
      firestore,
      keyed.map((entry) => collection(entry.key)),
    )
    keyed.forEach((entry, index) => answers.set(entry.contactId, answer(snapshots[index])))
  } catch (error) {
    console.error(`[outreach] ${label} lookup failed; reading as unchecked`, error)
    for (const entry of keyed) answers.set(entry.contactId, null)
  }
  return answers
}

/** Every lookup the gates take, for each person, keyed by contact id. */
export async function readOutreachGateLookups(
  firestore: Firestore,
  input: ReadOutreachGateLookupsInput,
): Promise<Map<string, OutreachGateLookups>> {
  const { orgId, hostId, people } = input
  const host = firestore.collection('hosts').doc(hostId)
  const enrollments = outreachOrgCollection(firestore, orgId, 'enrollments')
  const activities = firestore.collection('orgs').doc(orgId).collection(CRM_COLLECTIONS.activities)

  const [platform, site, sales, doNotContact, roster, perPerson] = await Promise.all([
    keyedLookup(
      firestore,
      people,
      (key) => firestore.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(key),
      // A released record no longer suppresses.
      (snapshot) => snapshot.exists && !snapshot.get('releasedAt'),
      'platform suppression',
    ),
    keyedLookup(
      firestore,
      people,
      (key) => host.collection(HOST_SUPPRESSIONS_SUBCOLLECTION).doc(key),
      (snapshot) => snapshot.exists,
      'site suppression',
    ),
    keyedLookup<TopicSubscriptionState>(
      firestore,
      people,
      (key) => host.collection(TOPIC_OPT_OUTS_SUBCOLLECTION).doc(key),
      (snapshot) =>
        readTopicSubscriptionState(
          ((snapshot.exists ? snapshot.get('topics') : null) ?? {})[EMAIL_TOPIC_SALES],
        ),
      'sales topic',
    ),
    lookupOutreachDoNotContact(
      firestore,
      orgId,
      people.map((person) => person.email),
    ),
    loadCrmInboundRoster(firestore, orgId).catch((error: unknown): MemberAddresses[] | null => {
      console.error('[outreach] roster lookup failed; reading as unchecked', error)
      return null
    }),
    Promise.all(
      people.map(async (person) => {
        const open = await Promise.all([
          enrollments.where('contactId', '==', person.contactId).get(),
          enrollments.where('email', '==', person.email).get(),
        ])
          .then(([byContact, byEmail]) => {
            const found = new Map<string, { id: string; sequenceId: string; status: OutreachEnrollmentStatus }>()
            for (const doc of [...byContact.docs, ...byEmail.docs]) {
              found.set(doc.id, {
                id: doc.id,
                sequenceId: String(doc.get('sequenceId') ?? ''),
                status: doc.get('status') as OutreachEnrollmentStatus,
              })
            }
            return [...found.values()]
          })
          .catch((error: unknown) => {
            console.error('[outreach] enrollment lookup failed; reading as unchecked', error)
            return null
          })
        const inbound = await activities
          .where('contactId', '==', person.contactId)
          .where('direction', '==', 'inbound')
          .limit(1)
          .get()
          .then((snapshot) => !snapshot.empty)
          .catch((error: unknown) => {
            console.error('[outreach] inbound email lookup failed; reading as cold', error)
            return null
          })
        return { contactId: person.contactId, open, inbound }
      }),
    ),
  ])

  const byPerson = new Map(perPerson.map((entry) => [entry.contactId, entry]))
  const lookups = new Map<string, OutreachGateLookups>()
  for (const person of people) {
    const own = byPerson.get(person.contactId)
    lookups.set(person.contactId, {
      platformSuppressed: platform.get(person.contactId) ?? null,
      hostSuppressed: site.get(person.contactId) ?? null,
      salesTopicState: sales.get(person.contactId) ?? null,
      doNotContact: doNotContact.get(person.email) ?? null,
      workspaceMembers: roster,
      openEnrollments: own?.open ?? null,
      hasInboundEmail: own?.inbound ?? null,
    })
  }
  return lookups
}
