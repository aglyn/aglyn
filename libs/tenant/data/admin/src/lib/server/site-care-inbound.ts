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

import { inboundMailDomain } from '@aglyn/aglyn/app-utils/inbound-mail-domain'
import {
  emailAddressOf,
  htmlToPlainText,
  stripQuotedHistory,
  threadSubject,
} from '@aglyn/aglyn/app-utils/email-text'
import { SITE_CARE_INBOUND_LOCAL_PART, siteCareSupportAddress } from '@aglyn/aglyn/app-utils/site-care'
import { getEmailConfig, type ReceivedEmail } from '@aglyn/shared-util-email'
import {
  appendSiteCareReply,
  openSiteCareRequest,
  orgHasSiteCare,
  readSiteCareOrg,
  type SiteCareDeps,
} from './site-care-requests'
import { findUserByEmailAcrossPools } from './auth-pools'

/**
 * SITE CARE MAIL ARRIVES AT THE SUPPORT ADDRESS (AGL-3959, AGL-3997).
 *
 * Site Care has no address of its own. An owner emails the support address
 * they already know, and the support mailbox delivers a copy of each message
 * to `support@<inbound mail domain>`, where the mail provider announces it.
 * A message to either address from a member of a workspace with Site Care
 * becomes a Site Care request on that workspace, matched by the sender's
 * address against the members of workspaces that have Site Care. A reply to
 * any Site Care email goes to `support+<requestId>@…` and joins that
 * request's thread, when the sender is a member of its workspace.
 *
 * Everything else is acknowledged and left alone: nothing is filed and
 * nothing is sent back, and a message to the support address stays in the
 * support inbox as ordinary support mail. That includes the platform's own
 * mail and anything a machine sent: an out-of-office answering a Site Care
 * email would otherwise join the request, and one answering anything that
 * replies to support would open one.
 */

/** What a received message was addressed to: a new request, or a reply on one. */
export type SiteCareInboundTarget = { kind: 'new' } | { kind: 'reply'; requestId: string }

/** The addresses the intake reads as the platform's own. */
export interface SiteCareInboundAddresses {
  /** The inbound mail domain: `support@` and `support+<requestId>@` it. */
  domain: string
  /** The operator's support address, or null when the deployment publishes none. */
  supportEmail: string | null
  /** The address the platform sends from, `USAGE_EMAIL_FROM`'s, or null. */
  platformSender: string | null
}

/** This deployment's {@link SiteCareInboundAddresses}, read per call. */
export function siteCareInboundAddresses(): SiteCareInboundAddresses {
  return {
    domain: inboundMailDomain(),
    supportEmail: emailAddressOf(siteCareSupportAddress()),
    platformSender: emailAddressOf(getEmailConfig().from),
  }
}

/** The Site Care target among a message's recipients, or null. */
export function siteCareInboundTarget(
  recipients: readonly string[],
  addresses: Pick<SiteCareInboundAddresses, 'domain' | 'supportEmail'>,
): SiteCareInboundTarget | null {
  const domain = addresses.domain.toLowerCase()
  const support = emailAddressOf(addresses.supportEmail)
  let found: SiteCareInboundTarget | null = null
  for (const value of recipients) {
    // Validated (and lowercased) for the comparison, but the local part is
    // read as written: a request id is a case-sensitive Firestore id, and
    // lowercasing `support+AbC…` would look up a ticket that does not exist.
    const address = emailAddressOf(value)
    if (!address) continue
    if (support && address === support) {
      found = found ?? { kind: 'new' }
      continue
    }
    const raw = String(value ?? '').trim()
    const written = (/<([^<>]+)>\s*$/.exec(raw)?.[1] ?? raw).trim()
    const at = written.lastIndexOf('@')
    if (at <= 0 || address.slice(address.lastIndexOf('@') + 1) !== domain) continue
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

/** Why a message is ignored without a lookup: the platform wrote it, or a machine did. */
export type SiteCareMachineMail = 'ours' | 'automatic'

/**
 * Whether a message is not a person writing in: from the support address,
 * the platform's sender or any address on the inbound mail domain, or one
 * its headers say a machine sent. Null when it may be a person.
 */
export function siteCareMachineMail(
  message: Pick<ReceivedEmail, 'from' | 'autoSubmitted'>,
  addresses: SiteCareInboundAddresses,
): SiteCareMachineMail | null {
  const sender = emailAddressOf(message.from)
  if (sender) {
    const own = [addresses.supportEmail, addresses.platformSender].map((value) => emailAddressOf(value))
    if (own.includes(sender)) return 'ours'
    if (sender.slice(sender.lastIndexOf('@') + 1) === addresses.domain.toLowerCase()) return 'ours'
  }
  return message.autoSubmitted ? 'automatic' : null
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
 * would be read as a stranger's.
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

/** Why a message was acknowledged and left alone. */
export type SiteCareIgnoredReason =
  /** No workspace with Site Care has the sender as a member: ordinary support mail. */
  | 'not-a-member'
  /** The platform's own address wrote it. */
  | 'ours'
  /** Its headers say a machine sent it. */
  | 'automatic'
  /** A member wrote, but said nothing. */
  | 'empty'

export type SiteCareInboundOutcome =
  | { outcome: 'opened'; requestId: string }
  | { outcome: 'replied'; requestId: string }
  | { outcome: 'ignored'; reason: SiteCareIgnoredReason }

/**
 * Files one received message addressed to the support address or to a
 * request's reply address. Nothing is ever sent back to a sender it does
 * not file for: a message to the support address is still in the support
 * inbox, answered there like any other.
 */
export async function fileSiteCareInboundEmail(
  firestore: FirebaseFirestore.Firestore,
  input: {
    target: SiteCareInboundTarget
    message: ReceivedEmail
    /** The platform's own addresses; this deployment's by default. */
    addresses?: SiteCareInboundAddresses
    /** The seam a spec replaces; every auth pool by default. */
    findAccount?: SiteCareAccountLookup
  },
  deps: SiteCareDeps = {},
): Promise<SiteCareInboundOutcome> {
  const { message } = input
  const machine = siteCareMachineMail(message, input.addresses ?? siteCareInboundAddresses())
  if (machine) return { outcome: 'ignored', reason: machine }
  const body = siteCareMessageBody(message)
  const sender = emailAddressOf(message.from)
  const findAccount = input.findAccount ?? findSiteCareAccount
  const match = sender ? await findSiteCareWorkspaceForSender(firestore, findAccount, sender) : null
  if (input.target.kind === 'reply' && match) {
    const ticket = await firestore.collection('supportTickets').doc(input.target.requestId).get()
    const orgId = String(ticket.get('orgId') ?? '')
    // Only a member of the request's own workspace may add to it.
    const member = orgId
      ? (await firestore.collection('orgs').doc(orgId).collection('members').doc(match.uid).get()).exists
      : false
    if (ticket.exists && member) {
      if (!body) return { outcome: 'ignored', reason: 'empty' }
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
  if (!match) return { outcome: 'ignored', reason: 'not-a-member' }
  if (!body && !threadSubject(message.subject)) return { outcome: 'ignored', reason: 'empty' }
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
