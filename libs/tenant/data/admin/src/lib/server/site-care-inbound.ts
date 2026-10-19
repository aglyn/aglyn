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
  emailAddressOf,
  htmlToPlainText,
  stripQuotedHistory,
  threadSubject,
} from '@aglyn/aglyn/app-utils/email-text'
import { SITE_CARE_INBOUND_LOCAL_PART } from '@aglyn/aglyn/app-utils/site-care'
import {
  SITE_CARE_UNKNOWN_SENDER_EMAIL_KEY,
  type ReceivedEmail,
} from '@aglyn/shared-util-email'
import {
  appendSiteCareReply,
  openSiteCareRequest,
  orgHasSiteCare,
  readSiteCareOrg,
  type SiteCareDeps,
} from './site-care-requests'
import { findUserByEmailAcrossPools } from './auth-pools'
import { sendSiteCareEmail } from './site-care-emails'

/**
 * THE SITE CARE ADDRESS (AGL-3959): `care@<inbound mail domain>`.
 *
 * An owner emails or forwards a change to the address and it becomes a Site
 * Care request on their workspace, matched by the sender's address against
 * the members of workspaces that have Site Care. A reply to any Site Care
 * email goes to `care+<requestId>@…` and joins that request's thread, when
 * the sender is a member of its workspace. A sender who matches nobody gets
 * a reply asking them to write from the address on the account; the message
 * itself is not kept.
 */

/** What a received message was addressed to, of the Site Care address. */
export type SiteCareInboundTarget = { kind: 'new' } | { kind: 'reply'; requestId: string }

/** The Site Care target among a message's recipients, or null. */
export function siteCareInboundTarget(
  recipients: readonly string[],
  domain: string,
): SiteCareInboundTarget | null {
  let found: SiteCareInboundTarget | null = null
  for (const value of recipients) {
    // Validated (and lowercased) for the domain, but the local part is read
    // as written: a request id is a case-sensitive Firestore id, and
    // lowercasing `care+AbC…` would look up a ticket that does not exist.
    const address = emailAddressOf(value)
    if (!address) continue
    const raw = String(value ?? '').trim()
    const written = (/<([^<>]+)>\s*$/.exec(raw)?.[1] ?? raw).trim()
    const at = written.lastIndexOf('@')
    if (at <= 0 || address.slice(address.lastIndexOf('@') + 1) !== domain.toLowerCase()) continue
    const local = written.slice(0, at)
    if (local.toLowerCase() === SITE_CARE_INBOUND_LOCAL_PART) {
      found = found ?? { kind: 'new' }
      continue
    }
    const prefix = `${SITE_CARE_INBOUND_LOCAL_PART}+`
    if (local.toLowerCase().startsWith(prefix)) {
      const requestId = local.slice(prefix.length)
      // Firestore ids: 20 characters of [A-Za-z0-9]; anything else by shape
      // is refused rather than looked up.
      if (/^[A-Za-z0-9]{10,40}$/.test(requestId)) return { kind: 'reply', requestId }
    }
  }
  return found
}

export interface SiteCareSenderMatch {
  orgId: string
  org: Record<string, unknown>
  uid: string
  email: string
}

/** The account an address signs in with: its uid, or null when it has none. */
export type SiteCareAccountLookup = (email: string) => Promise<{ uid: string } | null>

/**
 * Every pool, not only the project's: an owner who signs in through SSO is a
 * GCIP tenant user the project pool never returns (AGL-1122), and their mail
 * would be answered as a stranger's.
 */
export const findSiteCareAccount: SiteCareAccountLookup = async (email) => {
  const found = await findUserByEmailAcrossPools(email).catch(() => null)
  return found ? { uid: found.record.uid } : null
}

/**
 * The Site Care workspace a sender belongs to: the account their address
 * signs in with (in any pool), then the workspaces it is a member of, the
 * first with Site Care in force (by id, so the choice is stable).
 */
export async function findSiteCareWorkspaceForSender(
  firestore: FirebaseFirestore.Firestore,
  findAccount: SiteCareAccountLookup,
  sender: string,
): Promise<SiteCareSenderMatch | null> {
  const email = emailAddressOf(sender)
  if (!email) return null
  const user = await findAccount(email).catch(() => null)
  if (!user) return null
  const memberships = await firestore.collection('users').doc(user.uid).collection('orgs').limit(25).get()
  const orgIds = memberships.docs.map((doc) => doc.id).sort()
  for (const orgId of orgIds) {
    const member = await firestore.collection('orgs').doc(orgId).collection('members').doc(user.uid).get()
    if (!member.exists) continue
    const org = await readSiteCareOrg(firestore, orgId)
    if (org && orgHasSiteCare(org)) return { orgId, org, uid: user.uid, email }
  }
  return null
}

/** The words of a message, above any quoted history. */
export function siteCareMessageBody(message: Pick<ReceivedEmail, 'text' | 'html'>): string {
  const plain = (message.text?.trim() ? message.text : htmlToPlainText(message.html)).replace(/\r\n?/g, '\n')
  return stripQuotedHistory(plain).trim()
}

export type SiteCareInboundOutcome =
  | { outcome: 'opened'; requestId: string }
  | { outcome: 'replied'; requestId: string }
  | { outcome: 'unknown-sender' }
  | { outcome: 'empty' }

/** Files one received message addressed to the Site Care address. */
export async function fileSiteCareInboundEmail(
  firestore: FirebaseFirestore.Firestore,
  input: {
    target: SiteCareInboundTarget
    message: ReceivedEmail
    /** The seam a spec replaces; every auth pool by default. */
    findAccount?: SiteCareAccountLookup
  },
  deps: SiteCareDeps = {},
): Promise<SiteCareInboundOutcome> {
  const { message } = input
  const body = siteCareMessageBody(message)
  const sender = emailAddressOf(message.from)
  if (input.target.kind === 'reply') {
    const ticket = await firestore.collection('supportTickets').doc(input.target.requestId).get()
    const orgId = String(ticket.get('orgId') ?? '')
    const match = sender ? await findSiteCareWorkspaceForSender(firestore, input.findAccount ?? findSiteCareAccount, sender) : null
    // Only a member of the request's own workspace may add to it.
    const member =
      match && orgId
        ? (await firestore.collection('orgs').doc(orgId).collection('members').doc(match.uid).get()).exists
        : false
    if (ticket.exists && member && match) {
      if (!body) return { outcome: 'empty' }
      await appendSiteCareReply(
        firestore,
        {
          ticketId: ticket.id,
          from: { uid: match.uid, email: match.email },
          body,
          dedupeKey: message.messageId || message.id,
        },
        deps,
      )
      return { outcome: 'replied', requestId: ticket.id }
    }
    // A reply that cannot join its request is read as a new one below.
  }
  const match = sender ? await findSiteCareWorkspaceForSender(firestore, input.findAccount ?? findSiteCareAccount, sender) : null
  if (!match) {
    if (sender) {
      await (deps.email ?? sendSiteCareEmail)({
        key: SITE_CARE_UNKNOWN_SENDER_EMAIL_KEY,
        to: sender,
        org: null,
        requestId: null,
        merge: { 'sender.email': sender },
        fallback: {
          subject: 'We could not match your email to an account',
          text:
            `We got your message from ${sender}, but no workspace with Site Care has that address as a member. ` +
            'Please send it again from the email address you sign in with.',
        },
      })
    }
    return { outcome: 'unknown-sender' }
  }
  if (!body && !threadSubject(message.subject)) return { outcome: 'empty' }
  const opened = await openSiteCareRequest(
    firestore,
    {
      orgId: match.orgId,
      org: match.org,
      hostId: null,
      subject: threadSubject(message.subject) || body.split('\n')[0].slice(0, 150) || 'A change by email',
      body: body || threadSubject(message.subject),
      requester: { uid: match.uid, email: match.email },
      source: 'email',
      dedupeKey: message.messageId || message.id,
    },
    deps,
  )
  return { outcome: 'opened', requestId: opened.ticketId }
}
