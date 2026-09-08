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
  buildCrmCapturedEmailActivity,
  consentGroupForHost,
  contactCaptureHostIds,
  crmActivityLogHasRoom,
  crmCapturedEmailKey,
  crmInboundCandidates,
  crmInboundExcerpt,
  type CrmActivityLink,
  type CrmEmailDirection,
  type CrmInboundCandidate,
  crmScopeTokens,
  emailAddressOf,
  emailDomainOf,
  forwardedSection,
  htmlToPlainText,
  isCrmInboundAddress,
  isCrmInboundToken,
  mintCrmInboundToken,
  personKey,
  readContactFacet,
} from '@aglyn/aglyn/server'
import type { OrgCrmInbound } from '@aglyn/aglyn/foundation'
import type { ReceivedEmail } from '@aglyn/shared-util-email'
import { findContactByEmail } from './contact-email-index'
import {
  createCrmEmailActivity,
  crmCapturedEmailActivityRef,
  newCrmActivityRef,
} from './crm-email-activity'
import { countCrmActivitiesForRecord } from './crm-records'

/**
 * EMAIL CAPTURE (AGL-2657): the half with Firestore.
 *
 * The org's capture token — minted once, replaced on a rotation, found
 * again from a message's recipient — and the filing of one received
 * message: which record it was with, whether it has been filed before, and
 * the row it becomes. The pure rules are `@aglyn/aglyn`'s
 * `crm-inbound.ts`; this module is the reads and the one write.
 *
 * Firestore is a parameter throughout, as in `crm-records.ts` and
 * `crm-email-activity.ts`: the routes hold one, and a module that reached
 * for the Admin app itself would drag it into every spec that only wants
 * the matching. Nothing here reads the roster or the org's feed — the
 * caller hands in the member addresses and writes the feed line — so a
 * spec of this module needs a store and nothing else.
 */

/** The most candidate addresses one message is matched by. */
export const CRM_INBOUND_CANDIDATE_MAX = 6

/** The most sites whose leads are consulted for one message. */
export const CRM_INBOUND_LEAD_HOST_MAX = 50

export interface CrmInboundTokenResult {
  token: string
  createdAtMs: number
  rotatedAtMs?: number
  /** True when this call replaced a token that existed. */
  rotated: boolean
}

/**
 * The org's capture token, minted the first time anybody asks and kept
 * thereafter; with `rotate`, replaced. A transaction, so two members
 * opening the settings page at once mint one token and not two, and a
 * rotation lands on the token the reader saw.
 */
export async function ensureCrmInboundToken(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  options: { rotate?: boolean; nowMs?: number } = {},
): Promise<CrmInboundTokenResult> {
  const rotate = options.rotate === true
  const nowMs = options.nowMs ?? Date.now()
  const orgRef = firestore.collection('orgs').doc(orgId)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) throw new Error(`[crm-inbound] unknown org ${orgId}`)
    const current = (snapshot.get('crmInbound') ?? null) as Partial<OrgCrmInbound> | null
    const held = isCrmInboundToken(current?.token)
    if (held && !rotate) {
      const createdAtMs = Number(current?.createdAtMs)
      return {
        token: String(current?.token),
        createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : nowMs,
        ...(typeof current?.rotatedAtMs === 'number' ? { rotatedAtMs: current.rotatedAtMs } : {}),
        rotated: false,
      }
    }
    const createdAtMs =
      held && Number.isFinite(Number(current?.createdAtMs)) && Number(current?.createdAtMs) > 0
        ? Number(current?.createdAtMs)
        : nowMs
    const next: OrgCrmInbound = {
      token: mintCrmInboundToken(),
      createdAtMs,
      ...(held ? { rotatedAtMs: nowMs } : {}),
    }
    tx.update(orgRef, { crmInbound: next })
    return { ...next, rotated: held }
  })
}

/**
 * The org a capture token names, or `null`. One equality on
 * `crmInbound.token`, which Firestore indexes on its own; a token that is
 * not one by shape is refused before the query, so a malformed local part
 * costs no read.
 */
export async function findOrgByCrmInboundToken(
  firestore: FirebaseFirestore.Firestore,
  token: unknown,
): Promise<{ orgId: string; org: Record<string, unknown> } | null> {
  if (!isCrmInboundToken(token)) return null
  const page = await firestore
    .collection('orgs')
    .where('crmInbound.token', '==', token)
    .limit(1)
    .get()
  const doc = page.docs[0]
  if (!doc) return null
  return { orgId: doc.id, org: { $id: doc.id, ...(doc.data() ?? {}) } }
}

/**
 * Every site of the organization, by id, up to the ceiling — the set a
 * message's lead lookup sweeps. One equality on `hosts.orgId`.
 */
export async function crmInboundHostIds(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<string[]> {
  const page = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .limit(CRM_INBOUND_LEAD_HOST_MAX)
    .get()
  return page.docs.map((doc) => String(doc.id))
}

/** The record one of a message's addresses resolved to. */
export interface CrmInboundMatch {
  email: string
  direction: CrmEmailDirection
  kind: 'contact' | 'lead'
  /** Where the row is filed. */
  link: CrmActivityLink
  /** The site the row is stamped with — the record's own. */
  hostId: string
  /** Who may list the row — the record's own tokens. */
  visibleTo: string[]
}

/**
 * The first candidate that is a contact of the org — through the address
 * index, so a merged record's alternate address answers — or a lead on any
 * of its sites. Candidates are tried in the order the rule gave them and
 * the first hit wins; a contact is looked for before a lead at each
 * address, because a converted lead's address is its contact's.
 */
export async function matchCrmInboundCorrespondent(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    org: Record<string, unknown>
    candidates: readonly CrmInboundCandidate[]
    hostIds: readonly string[]
  },
): Promise<CrmInboundMatch | null> {
  const { orgId, org } = input
  const orgRef = firestore.collection('orgs').doc(orgId)
  const contacts = orgRef.collection('contacts')
  const tokensOf = (record: Record<string, unknown>): string[] => {
    const raw = record['visibleTo']
    return Array.isArray(raw) ? raw.map((token) => String(token)) : []
  }
  for (const candidate of input.candidates.slice(0, CRM_INBOUND_CANDIDATE_MAX)) {
    const contact = await findContactByEmail(contacts, candidate.email)
    if (contact) {
      const record = (contact.data() ?? {}) as Record<string, unknown>
      const hostId =
        String(record['hostId'] ?? '').trim() || contactCaptureHostIds(record)[0] || ''
      const link: CrmActivityLink = { contactId: contact.id }
      if (hostId) {
        // The company the capturing site files this person under, so the
        // row shows on the company's log as a sent email's does.
        const group = consentGroupForHost(org, hostId)
        const facet = readContactFacet(record, group.groupId)
        if (facet.companyId) link.companyId = facet.companyId
      }
      return {
        email: candidate.email,
        direction: candidate.direction,
        kind: 'contact',
        link,
        hostId,
        visibleTo: tokensOf(record),
      }
    }
    const key = personKey(candidate.email)
    if (!key) continue
    for (const hostId of input.hostIds.slice(0, CRM_INBOUND_LEAD_HOST_MAX)) {
      const lead = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('leads')
        .doc(key)
        .get()
      if (!lead.exists) continue
      const link: CrmActivityLink = { leadId: lead.id }
      // A converted lead's mail belongs on the contact it became as well.
      const converted = String(lead.get('convertedContactId') ?? '').trim()
      if (converted) link.contactId = converted
      return {
        email: candidate.email,
        direction: candidate.direction,
        kind: 'lead',
        link,
        hostId,
        // A lead carries no tokens of its own: the site's scope, as every
        // record created from that site is stamped.
        visibleTo: crmScopeTokens(org, consentGroupForHost(org, hostId)),
      }
    }
  }
  return null
}

/** One member of the roster, as the filer needs them. */
export interface CrmInboundMember {
  uid: string
  email: string
  name?: string | null
}

export type CrmInboundFileOutcome =
  /** A row was written. */
  | { outcome: 'filed'; activityId: string; match: CrmInboundMatch }
  /** The message had been filed before; nothing written. */
  | { outcome: 'duplicate'; activityId: string }
  /** No address on the message is a record of the org; nothing written. */
  | { outcome: 'unmatched'; senderDomain: string | null }
  /** The record's activity log is at its ceiling; nothing written. */
  | { outcome: 'ceiling'; match: CrmInboundMatch }

/**
 * Files one received message on the record it was with (AGL-2657).
 *
 * The order is the cost: the candidate rule is arithmetic; the match is
 * the reads that decide everything after it; a message filed before is
 * answered off one read of the row it would write, before the ceiling's
 * aggregate; the ceiling comes last and refuses rather than dropping a row
 * on a full log. The write is a `create`, so two deliveries racing past
 * the read still yield one row. The BODY never leaves this function except
 * as the bounded excerpt in the row.
 */
export async function fileCrmInboundEmail(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    org: Record<string, unknown>
    message: ReceivedEmail
    /** The capture domain, so the capture address is never the correspondent. */
    domain: string
    members: readonly CrmInboundMember[]
    hostIds: readonly string[]
  },
): Promise<CrmInboundFileOutcome> {
  const { orgId, org, message, domain } = input
  const plain = (message.text.trim() ? message.text : htmlToPlainText(message.html)).replace(
    /\r\n?/g,
    '\n',
  )
  const forwarded = forwardedSection(plain)
  const { sender, senderIsMember, candidates } = crmInboundCandidates({
    from: message.from,
    to: [...message.to, ...message.receivedFor],
    cc: [...message.cc, ...message.bcc],
    forwardedFrom: forwarded?.from ?? undefined,
    domain,
    memberEmails: input.members.map((member) => member.email),
  })
  const senderDomain = emailDomainOf(message.from)
  if (!candidates.length) return { outcome: 'unmatched', senderDomain }

  const match = await matchCrmInboundCorrespondent(firestore, {
    orgId,
    org,
    candidates,
    hostIds: input.hostIds,
  })
  if (!match) return { outcome: 'unmatched', senderDomain }

  const key = crmCapturedEmailKey(message.messageId, message.id)
  const ref = key
    ? crmCapturedEmailActivityRef(firestore, orgId, key)
    : newCrmActivityRef(firestore, orgId)
  if (key) {
    const existing = await ref.get()
    if (existing.exists) return { outcome: 'duplicate', activityId: ref.id }
  }

  const orgRef = firestore.collection('orgs').doc(orgId)
  if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, match.link))) {
    return { outcome: 'ceiling', match }
  }

  const author = senderIsMember
    ? input.members.find((member) => emailAddressOf(member.email) === sender)
    : undefined
  // The address the message was written to, when it is worth showing: the
  // correspondent for a copied send, else the first recipient that is not
  // the capture address.
  const to =
    match.direction === 'outbound'
      ? match.email
      : (message.to
          .map((value) => emailAddressOf(value))
          .find((value) => value && !isCrmInboundAddress(value, domain)) ?? null)
  const activity = buildCrmCapturedEmailActivity({
    direction: match.direction,
    subject: message.subject,
    excerpt: crmInboundExcerpt(message.text, message.html),
    from: sender ?? message.from,
    to,
    messageId: message.messageId || message.id,
    inReplyTo: message.inReplyTo,
    atMs: message.receivedAtMs,
    byUid: author?.uid ?? '',
    byName: author?.name ?? null,
    link: match.link,
    hostId: match.hostId,
    visibleTo: match.visibleTo,
  })
  const created = await createCrmEmailActivity(ref, activity)
  return created === 'created'
    ? { outcome: 'filed', activityId: ref.id, match }
    : { outcome: 'duplicate', activityId: ref.id }
}
