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
import {
  MEMBER_EMAIL_ALIASES_COLLECTION,
  memberAddressRoster,
  type RosterMember,
  type RosterRow,
} from '@aglyn/aglyn/app-utils/member-email-aliases'
import { SITE_CARE_INBOUND_LOCAL_PART, siteCareSupportAddress } from '@aglyn/aglyn/app-utils/site-care'
import { getEmailConfig, type ReceivedEmail } from '@aglyn/shared-util-email'
import {
  appendSiteCareReply,
  openSiteCareRequest,
  orgHasSiteCare,
  readSiteCareOrg,
  type SiteCareDeps,
} from './site-care-requests'
import { findAccountByVerifiedAlias } from './account-emails'
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
 * The sender is matched as a mailbox, not as a string (AGL-4031): case does
 * not matter, a `+tag` is dropped, Gmail's dots and its two domains are one
 * mailbox, and an address a member confirmed (on their account, or in the
 * workspace) counts as theirs. This is looser than the account and alias
 * stores, which keep `a+b@x.com` and `a@x.com` apart on purpose, and it can
 * afford to be: it only places mail from somebody already on a workspace's
 * roster, grants nothing, and never crosses from one domain to another except
 * between Gmail's two.
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
 * would be read as a stranger's. Then the account addresses people add to
 * their account and CONFIRM (AGL-2486): a confirmed address is one of that
 * account's sign-in identifiers, held by no other account, so mail from it is
 * that person's (AGL-4031). An address only typed, never confirmed, is not in
 * that index and is never read as anyone's.
 */
export const findSiteCareAccount: SiteCareAccountLookup = async (email) => {
  const found = await findUserByEmailAcrossPools(email).catch(() => null)
  if (found) return { uid: found.record.uid }
  const alias = await findAccountByVerifiedAlias(email).catch(() => null)
  return alias ? { uid: alias.uid } : null
}

// ── Which addresses are the same mailbox ────────────────────────────────────

/** The two spellings of Google's consumer mail domain: one mailbox under either. */
const GMAIL_DOMAINS: readonly string[] = ['gmail.com', 'googlemail.com']

function splitAddress(address: string): { local: string; domain: string } {
  const at = address.lastIndexOf('@')
  return { local: address.slice(0, at), domain: address.slice(at + 1) }
}

/** The local part before any `+tag`; the whole of it when that would leave nothing. */
function untagged(local: string): string {
  const plus = local.indexOf('+')
  return plus > 0 ? local.slice(0, plus) : local
}

/** A Gmail mailbox as Gmail delivers it: no tag, no dots, one domain. */
function gmailMailbox(local: string): string {
  return `${untagged(local).replace(/\./g, '')}@gmail.com`
}

/**
 * The addresses a sender may be signed in under, in the order they are tried
 * (AGL-4031). Each tier is tried only when every earlier one named nobody, so
 * an address that is itself somebody's sign-in is never read as somebody
 * else's that merely looks like it:
 *
 * 1. the address as written (compared lower-cased, as every member address is);
 * 2. without its `+tag`: `avery+site@example.com` is `avery@example.com`'s
 *    mailbox wherever plus-addressing is offered, and the tag is how people
 *    sort mail, not a second identity;
 * 3. for Gmail only, the same mailbox's other spellings: Gmail ignores the
 *    dots in a local part and delivers `gmail.com` and `googlemail.com` to one
 *    inbox. No other domain's dots are folded, and no tier ever leaves the
 *    sender's own domain except between those two.
 */
export function siteCareSenderCandidates(sender: unknown): string[][] {
  const address = emailAddressOf(sender)
  if (!address) return []
  const { local, domain } = splitAddress(address)
  const seen = new Set<string>([address])
  const tiers: string[][] = [[address]]
  const tier = (values: string[]) => {
    const fresh = values.filter((value) => !seen.has(value))
    fresh.forEach((value) => seen.add(value))
    if (fresh.length) tiers.push(fresh)
  }
  tier([`${untagged(local)}@${domain}`])
  if (GMAIL_DOMAINS.includes(domain)) {
    const dotless = untagged(local).replace(/\./g, '')
    const written = untagged(local)
    tier(GMAIL_DOMAINS.flatMap((gmail) => [`${written}@${gmail}`, `${dotless}@${gmail}`]))
  }
  return tiers
}

/**
 * Whether mail from `sender` came from the mailbox `memberAddress` names, by
 * the same rules as {@link siteCareSenderCandidates}: the address itself,
 * the sender's `+tag` dropped onto the member's untagged address, and, for
 * Gmail alone, dots and the domain's two spellings ignored. A member's own
 * tagged address is matched only as written: `avery+site@` signing in does
 * not make every `avery+…@` theirs.
 */
export function siteCareAddressMatches(sender: unknown, memberAddress: unknown): boolean {
  const from = emailAddressOf(sender)
  const member = emailAddressOf(memberAddress)
  if (!from || !member) return false
  if (from === member) return true
  const a = splitAddress(from)
  const b = splitAddress(member)
  if (GMAIL_DOMAINS.includes(a.domain) && GMAIL_DOMAINS.includes(b.domain)) {
    return gmailMailbox(a.local) === gmailMailbox(b.local)
  }
  return a.domain === b.domain && untagged(a.local) === b.local
}

/**
 * The one member of a roster a sender is, or null: a member who signs in
 * with the sender's mailbox first, then the one member who confirmed it as
 * an alias in that workspace (AGL-2975). Two members who both match are a
 * guess, and a guess files nothing — the message stays ordinary support mail.
 */
export function siteCareRosterMember(
  roster: readonly RosterMember[],
  sender: unknown,
  options: { exactOnly?: boolean } = {},
): RosterMember | null {
  const exact = emailAddressOf(sender)
  const matches = (address: unknown) =>
    options.exactOnly ? Boolean(exact) && emailAddressOf(address) === exact : siteCareAddressMatches(sender, address)
  const bySignIn = roster.filter((member) => matches(member.email))
  if (bySignIn.length === 1) return bySignIn[0]
  if (bySignIn.length > 1) return bySignIn.find((member) => member.email === exact) ?? null
  const byAlias = roster.filter((member) => (member.verifiedAliases ?? []).some((alias) => matches(alias)))
  return byAlias.length === 1 ? byAlias[0] : null
}

/**
 * How many Site Care workspaces the roster pass reads at most. It runs only
 * for mail the account lookups could not place, and each workspace costs two
 * reads, so the bound is what keeps a busy support inbox from costing more
 * than a lookup should.
 */
export const SITE_CARE_ROSTER_SCAN_MAX = 200

/**
 * The second pass, for what no account lookup can answer: a Gmail owner
 * whose sign-in is `first.last@gmail.com` writing as `firstlast@gmail.com`
 * (an account is found by its exact address only), and an address a member
 * confirmed as theirs in the workspace itself rather than on the account.
 * Reads the roster and the confirmed aliases of each workspace that bought
 * Site Care, and keeps the ones where exactly one member is the sender.
 * `exactOnly` when the address as written is somebody's sign-in: that
 * person is who wrote, and a look-alike on a roster is not.
 */
async function siteCareRosterMatches(
  firestore: FirebaseFirestore.Firestore,
  sender: string,
  exactOnly: boolean,
): Promise<SiteCareSenderMatch[]> {
  const bought = await firestore
    .collection('orgs')
    .where('seatAddons.siteCare', '>=', 1)
    .limit(SITE_CARE_ROSTER_SCAN_MAX)
    .get()
  const matches: SiteCareSenderMatch[] = []
  for (const orgId of bought.docs.map((doc) => doc.id).sort()) {
    const orgRef = firestore.collection('orgs').doc(orgId)
    const [members, aliases] = await Promise.all([
      orgRef.collection('members').get(),
      orgRef.collection(MEMBER_EMAIL_ALIASES_COLLECTION).get(),
    ])
    const rows: RosterRow[] = members.docs.map((doc) => ({
      ...((doc.data() ?? {}) as Omit<RosterRow, '$id'>),
      $id: doc.id,
    }))
    const roster = memberAddressRoster(rows, new Map(aliases.docs.map((doc) => [String(doc.id), doc.data()])))
    const member = siteCareRosterMember(roster, sender, { exactOnly })
    if (!member) continue
    const org = await readSiteCareOrg(firestore, orgId)
    if (org && orgHasSiteCare(org)) matches.push({ orgId, org, uid: member.uid, email: sender })
  }
  return matches
}

/**
 * EVERY Site Care workspace a sender belongs to, by workspace id (AGL-4031).
 *
 * First the account the sender's address signs in with, in any pool or as a
 * confirmed account address, trying the address's tiers in order
 * ({@link siteCareSenderCandidates}); then the workspaces that account is a
 * member of with Site Care in force. When that places the sender nowhere,
 * the rosters of the workspaces that bought Site Care are read for the
 * sender's mailbox ({@link siteCareRosterMatches}).
 *
 * All of them, not the first: which one a message is filed on, when there
 * are several, is the caller's choice.
 */
export async function findSiteCareWorkspacesForSender(
  firestore: FirebaseFirestore.Firestore,
  findAccount: SiteCareAccountLookup,
  sender: string,
): Promise<SiteCareSenderMatch[]> {
  const email = emailAddressOf(sender)
  if (!email) return []
  let uids: string[] = []
  let foundAtTier = -1
  for (const [index, tier] of siteCareSenderCandidates(email).entries()) {
    const found = await Promise.all(tier.map((address) => findAccount(address).catch(() => null)))
    uids = [...new Set(found.filter((user): user is { uid: string } => Boolean(user)).map((user) => user.uid))]
    if (uids.length) {
      foundAtTier = index
      break
    }
  }
  const matches: SiteCareSenderMatch[] = []
  for (const uid of uids) {
    const memberships = await firestore.collection('users').doc(uid).collection('orgs').limit(25).get()
    for (const orgId of memberships.docs.map((doc) => doc.id).sort()) {
      if (matches.some((match) => match.orgId === orgId)) continue
      const member = await firestore.collection('orgs').doc(orgId).collection('members').doc(uid).get()
      if (!member.exists) continue
      const org = await readSiteCareOrg(firestore, orgId)
      if (org && orgHasSiteCare(org)) matches.push({ orgId, org, uid, email })
    }
  }
  if (matches.length) return matches.sort((a, b) => (a.orgId < b.orgId ? -1 : a.orgId > b.orgId ? 1 : 0))
  return siteCareRosterMatches(firestore, email, foundAtTier === 0)
}

/**
 * The Site Care workspace a sender's new request is filed on: the first of
 * {@link findSiteCareWorkspacesForSender}'s, by workspace id, so the choice
 * is stable. A sender in several Site Care workspaces files on the lowest
 * id, with every candidate recorded for staff, who move the request when it
 * belongs to another (AGL-4031, `moveSiteCareRequest`).
 */
export async function findSiteCareWorkspaceForSender(
  firestore: FirebaseFirestore.Firestore,
  findAccount: SiteCareAccountLookup,
  sender: string,
): Promise<SiteCareSenderMatch | null> {
  return (await findSiteCareWorkspacesForSender(firestore, findAccount, sender))[0] ?? null
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
  const matches = sender ? await findSiteCareWorkspacesForSender(firestore, findAccount, sender) : []
  // A new request files on the first workspace by id (see
  // findSiteCareWorkspaceForSender); every candidate is recorded with it.
  const match = matches[0] ?? null
  if (input.target.kind === 'reply' && match) {
    const ticket = await firestore.collection('supportTickets').doc(input.target.requestId).get()
    const orgId = String(ticket.get('orgId') ?? '')
    // Only a member of the request's own workspace may add to it.
    let author: string | null = null
    for (const uid of orgId ? [...new Set(matches.map((each) => each.uid))] : []) {
      if ((await firestore.collection('orgs').doc(orgId).collection('members').doc(uid).get()).exists) {
        author = uid
        break
      }
    }
    if (ticket.exists && author) {
      if (!body) return { outcome: 'ignored', reason: 'empty' }
      await appendSiteCareReply(
        firestore,
        {
          ticketId: ticket.id,
          from: { uid: author, email: match.email },
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
      candidates: matches.map((each) => ({
        orgId: each.orgId,
        name: String(each.org['name'] ?? '') || each.orgId,
        uid: each.uid,
      })),
    },
    deps,
  )
  return { outcome: 'opened', requestId: opened.ticketId }
}
