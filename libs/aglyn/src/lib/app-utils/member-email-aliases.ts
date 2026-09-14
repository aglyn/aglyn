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

import { ACCOUNT_EMAIL_MAX_LENGTH, ACCOUNT_EMAIL_PATTERN } from './account-emails'
import { normalizeContactEmail } from './contacts'

/**
 * A MEMBER'S OWN ADDRESSES (AGL-2975): the pure half.
 *
 * A member signs in with one address and may write from others — a Gmail
 * send-as alias on an outbound domain, a role mailbox their client lets them
 * send as. Anything that asks "did one of our own people write this?" by the
 * sign-in address alone answers no for every one of those messages. This
 * module is what such a reader needs instead: the addresses a member has
 * added in a workspace, which of them the member has CONFIRMED, and which
 * member an address belongs to.
 *
 * ## Confirmed, or nothing
 *
 * An address a member merely typed is a claim. Treating it as theirs would
 * let a typo — or a prospect's address pasted into the wrong field — decide
 * whose timeline a stranger's mail lands on. So an address counts only once
 * a confirmation link sent TO it was opened by the member who added it, and
 * every reader here that answers "whose is this" reads confirmed addresses
 * and nothing else. `verifiedAtMs` is written by the server alone; the
 * rules deny the whole collection to every client.
 *
 * ## Org-scoped, beside the roster
 *
 * `orgs/{orgId}/memberEmailAliases/{uid}` — one document per member who has
 * added an address, keyed like the roster row it belongs to. Kept OFF the
 * roster row on purpose: `orgs/{orgId}/members/{uid}` is the permissions
 * document every rules evaluation reads, it is readable by every org-wide
 * member, and a write that lands on it while the member is being removed
 * can conjure a membership back into existence (AGL-1766). An address
 * somebody has not yet confirmed is not the team's business, and a stray
 * write here grants nothing: every reader intersects it with the roster.
 *
 * ## Normalized the way member addresses are
 *
 * Trimmed and lower-cased by `normalizeContactEmail`, the function every
 * member address and every message address is compared through, so an
 * alias typed `Zach@Aglyn.IO ` matches a From of `zach@aglyn.io`. Plus
 * addressing is NOT folded, for the reason `account-emails.ts` gives:
 * `a+b@x.com` is another mailbox almost everywhere but Gmail, so
 * `zach+news@aglyn.io` is a different address from a confirmed
 * `zach@aglyn.io`, exactly as it is from a sign-in address of that name.
 */

/** The collection under an org that holds each member's added addresses. */
export const MEMBER_EMAIL_ALIASES_COLLECTION = 'memberEmailAliases'

/**
 * How many addresses one member may add in one workspace, unconfirmed
 * ones included. Each costs a confirmation email, and the point is "the
 * address my outreach leaves from", not address collecting — the same
 * ceiling `MAX_ACCOUNT_EMAILS` puts on an account.
 */
export const MEMBER_EMAIL_ALIASES_MAX = 5

/** How long a confirmation link works: a day, as an account address's does. */
export const MEMBER_EMAIL_ALIAS_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000

/** The query parameter a confirmation link carries its token in. */
export const MEMBER_EMAIL_ALIAS_CONFIRM_PARAM = 'confirmEmailAlias'

/**
 * The console route a member manages their addresses through. One spelling
 * for the route file's readers and every card that calls it.
 */
export const MEMBER_EMAIL_ALIASES_ROUTE = '/api/orgs/members/email-aliases'

/** One address a member added. */
export interface MemberEmailAlias {
  /** Normalized — see the module comment. */
  address: string
  /**
   * When the member added it. A confirmation link names this instant, so
   * removing the address and adding it again retires every link sent for
   * the earlier one.
   */
  addedAtMs: number
  /**
   * When the member who added it opened a confirmation link. Absent until
   * then, and an address without it is never treated as theirs.
   */
  verifiedAtMs?: number
}

/** `orgs/{orgId}/memberEmailAliases/{uid}`. */
export interface MemberEmailAliasesDocument {
  uid: string
  aliases: MemberEmailAlias[]
  updatedAtMs: number
}

/** A stored or typed address, normalized, or `null` when it is not one. */
export function normalizeMemberEmailAlias(input: unknown): string | null {
  return normalizeContactEmail(input)
}

const positiveMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

/**
 * The addresses a stored document holds, read defensively: an entry that is
 * not an address is skipped, a repeated address keeps its first entry, and
 * the list is bounded by {@link MEMBER_EMAIL_ALIASES_MAX}, so no reader walks
 * more than the writer could ever have stored.
 */
export function readMemberEmailAliases(document: unknown): MemberEmailAlias[] {
  const raw = (document as { aliases?: unknown } | null | undefined)?.aliases
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const aliases: MemberEmailAlias[] = []
  for (const entry of raw) {
    if (aliases.length >= MEMBER_EMAIL_ALIASES_MAX) break
    const record = (entry ?? {}) as Record<string, unknown>
    const address = normalizeMemberEmailAlias(record['address'])
    const addedAtMs = positiveMs(record['addedAtMs'])
    if (!address || addedAtMs === null || seen.has(address)) continue
    seen.add(address)
    const verifiedAtMs = positiveMs(record['verifiedAtMs'])
    aliases.push({ address, addedAtMs, ...(verifiedAtMs !== null ? { verifiedAtMs } : {}) })
  }
  return aliases
}

/** Whether the member who added the address has confirmed it. */
export function isVerifiedMemberEmailAlias(
  alias: Pick<MemberEmailAlias, 'verifiedAtMs'> | null | undefined,
): boolean {
  return positiveMs(alias?.verifiedAtMs) !== null
}

/**
 * The CONFIRMED addresses a stored document holds — the only answer any
 * reader deciding "whose address is this" may use.
 */
export function verifiedMemberEmailAliases(document: unknown): string[] {
  return readMemberEmailAliases(document)
    .filter(isVerifiedMemberEmailAlias)
    .map((alias) => alias.address)
}

/** One member, as a reader of their addresses needs them. */
export interface MemberAddresses {
  /** The address they sign in with, as their roster row carries it. */
  email?: string | null
  /**
   * The addresses they have confirmed — {@link verifiedMemberEmailAliases}.
   * An unconfirmed address never belongs here.
   */
  verifiedAliases?: readonly string[]
}

/**
 * Every address that is this member's — the sign-in address first, then
 * each confirmed alias — normalized, each once.
 */
export function memberEmailAddresses(member: MemberAddresses | null | undefined): string[] {
  const addresses: string[] = []
  const add = (value: unknown) => {
    const address = normalizeMemberEmailAlias(value)
    if (address && !addresses.includes(address)) addresses.push(address)
  }
  add(member?.email)
  for (const alias of member?.verifiedAliases ?? []) add(alias)
  return addresses
}

/**
 * The member an address belongs to, or `null`.
 *
 * A sign-in address decides first: one account signs in with it, so it
 * names one person. Otherwise the member who confirmed it as an alias —
 * when exactly one did. Two members who each confirmed a shared mailbox
 * both own it, and naming either as the author of its mail would be a
 * guess, so the answer is nobody in particular. Whether the address is
 * the TEAM's is a different question, which {@link memberEmailAddresses}
 * over the whole roster answers yes to either way.
 */
export function findMemberByEmailAddress<T extends MemberAddresses>(
  members: readonly T[],
  address: unknown,
): T | null {
  const wanted = normalizeMemberEmailAlias(address)
  if (!wanted) return null
  const bySignIn = members.find((member) => normalizeMemberEmailAlias(member.email) === wanted)
  if (bySignIn) return bySignIn
  const holders = members.filter((member) =>
    (member.verifiedAliases ?? []).some((alias) => normalizeMemberEmailAlias(alias) === wanted),
  )
  return holders.length === 1 ? holders[0] : null
}

/** Why an address could not be added. */
export type MemberEmailAliasAddRefusal =
  | 'invalid-address'
  | 'sign-in-address'
  | 'reserved-domain'
  | 'already-confirmed'
  | 'limit-reached'

export type MemberEmailAliasAddVerdict =
  | {
      ok: true
      address: string
      /**
       * The unconfirmed entry already holding the address, or `null` when it
       * is new. Adding an address again is how a member asks for another
       * link, so an unconfirmed duplicate is not a refusal.
       */
      existing: MemberEmailAlias | null
    }
  | { ok: false; refusal: MemberEmailAliasAddRefusal; message: string }

/**
 * May this member add this address? Pure, so the card that greys out the
 * field and the route that refuses the write give one answer.
 *
 * `reservedDomains` are domains the deployment itself receives mail at —
 * the capture domain — whose addresses are the platform's, and a
 * confirmation email sent to one would only be read back by the platform.
 */
export function evaluateMemberEmailAliasAdd(input: {
  address: unknown
  signInEmail?: string | null
  aliases: readonly MemberEmailAlias[]
  reservedDomains?: readonly string[]
}): MemberEmailAliasAddVerdict {
  // Stored only when it is a mailbox address in the narrower shape an
  // account address must have: the address is mailed a link and printed in
  // the console, so a string the loose comparison pattern admits — quotes,
  // angle brackets, commas — is refused here rather than carried around.
  const address = normalizeMemberEmailAlias(input.address)
  if (!address || address.length > ACCOUNT_EMAIL_MAX_LENGTH || !ACCOUNT_EMAIL_PATTERN.test(address)) {
    return { ok: false, refusal: 'invalid-address', message: 'Enter a valid email address.' }
  }
  if (address === normalizeMemberEmailAlias(input.signInEmail)) {
    return {
      ok: false,
      refusal: 'sign-in-address',
      message: 'That is the address you sign in with, which already counts as yours.',
    }
  }
  const domain = address.slice(address.lastIndexOf('@') + 1)
  const reserved = (input.reservedDomains ?? []).map((value) => String(value).trim().toLowerCase())
  if (reserved.includes(domain)) {
    return {
      ok: false,
      refusal: 'reserved-domain',
      message: 'Addresses at that domain belong to the platform and cannot be added.',
    }
  }
  const existing = input.aliases.find((alias) => alias.address === address) ?? null
  if (existing && isVerifiedMemberEmailAlias(existing)) {
    return { ok: false, refusal: 'already-confirmed', message: 'That address is already confirmed.' }
  }
  if (!existing && input.aliases.length >= MEMBER_EMAIL_ALIASES_MAX) {
    return {
      ok: false,
      refusal: 'limit-reached',
      message: `You can add up to ${MEMBER_EMAIL_ALIASES_MAX} addresses. Remove one before adding another.`,
    }
  }
  return { ok: true, address, existing }
}

/** One address as the management route answers it. */
export interface MemberEmailAliasRow {
  address: string
  addedAtMs: number
  verified: boolean
  verifiedAtMs: number | null
}

/** The rows the management route answers with, in the order they were added. */
export function memberEmailAliasRows(aliases: readonly MemberEmailAlias[]): MemberEmailAliasRow[] {
  return [...aliases]
    .sort((a, b) => a.addedAtMs - b.addedAtMs)
    .map((alias) => ({
      address: alias.address,
      addedAtMs: alias.addedAtMs,
      verified: isVerifiedMemberEmailAlias(alias),
      verifiedAtMs: positiveMs(alias.verifiedAtMs),
    }))
}
