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
 * EVERY ADDRESS AN ACCOUNT HOLDS — the one answer, for every consumer.
 *
 * ## Why this exists
 *
 * Two stores in this product are keyed by ADDRESS rather than by uid:
 * `emailDeliveries/{sha256(address)}` (the per-recipient delivery log) and
 * `emailSuppressions/{sha256(address)}`. Everything that reached them passed
 * ONE address — the Firebase Auth record's current `email` — and an account
 * is not one address:
 *
 *  - A changed primary leaves the old address holding the mail. The new hash
 *    names an empty document, so the staff card renders a blank table for a
 *    person we demonstrably emailed. That card's own copy warns that reading
 *    a blank table as "we never emailed them" is how staff mislead a
 *    customer; before this module, an email change made the card do exactly
 *    that.
 *  - A federated provider carries its own address. `providerData[].email` can
 *    differ from the primary and is a real mailbox that has received real
 *    mail.
 *  - `users/{uid}/emails/{address}` (AGL-2486) holds confirmed aliases and
 *    every address this account has been moved OFF of.
 *
 * Erasure inherited the same single-address assumption, which is the sharp
 * version of the bug: a prior or secondary address kept its full delivery
 * history — recipient address, subjects, open and click times — after an
 * erasure request had been honoured and reported complete.
 *
 * ## One resolver, not four call sites
 *
 * The delivery-history card, erasure, the audit subject resolution and the
 * suppression lookups all need the same rule, and four copies of it would
 * drift apart the way the dead-status set did. So the rule lives here and
 * every consumer calls in. A caller that wants "the addresses" must not
 * re-derive them from a record it happens to be holding.
 *
 * ## Why `verifiedAccountEmails` is not this function
 *
 * `account-emails.ts` already answers a question that reads like this one,
 * and reusing it here would be a correctness bug in both directions. It is
 * built for matching an INVITATION, and its three defining choices are all
 * right for that and wrong for this:
 *
 *  - **It returns VERIFIED addresses only.** Correct for an invitation: an
 *    unverified address must not match one, or adding an address becomes a
 *    way into somebody else's organization. Wrong here, because unverified
 *    addresses are precisely where the mail is — a verification message is by
 *    definition sent to an address that is not yet verified, and it is the
 *    single most common row in the delivery log. Filtering it out would make
 *    the card miss the mail a staffer is most often asked about, and would
 *    make erasure leave it behind.
 *  - **It reads the subcollection alone.** The primary lives in the Firebase
 *    Auth record and is mirrored into `users/{uid}/emails` only LAZILY, on
 *    the account's first read of its own settings. An account that has never
 *    opened that page has an empty subcollection and a real primary, so this
 *    would return nothing at all for it.
 *  - **It `slice`s to `MAX_ACCOUNT_EMAILS`.** A silent truncation is
 *    tolerable when the cost is an invitation not matching. It is the worst
 *    available outcome for erasure, which would report success over addresses
 *    it never swept.
 *
 * So this module composes over that one's STORAGE — same subcollection, same
 * index, and the reverse lookup is delegated to `findAccountByVerifiedAlias`
 * rather than re-read — and adds the two sources it does not have.
 *
 * ⛔ Do not "simplify" this into `verifiedAccountEmails`. The three
 * differences above are each a defect if collapsed.
 *
 * ## THE UNIQUENESS INDEX ONCE HAD A HOLE, AND IT STILL HAS A TAIL
 *
 * `emailIdentityIndex` is what stops two accounts holding one address, and it
 * was claimed in exactly two places: the primary backfill in
 * `listAccountEmails`, and `confirmAccountEmail`. Neither read `providerData`
 * — so an address supplied by a federated provider never reached the index,
 * and two accounts could hold one address without the guard ever seeing them.
 * The live shape of it is ordinary: an account whose Google provider address
 * is another account's primary.
 *
 * `registerProviderAddresses` now claims for provider-asserted addresses at
 * the session mint, so this closes going forward and backfills each account
 * on its next sign-in. Two things follow that this module must keep saying:
 *
 *  - **The tail is still open.** An account that has not signed in since is
 *    still unregistered, and a collision that already exists is not repaired
 *    by a claim that correctly refuses. `tools/scripts/audit-provider-address-claims.mjs`
 *    reports both, read-only — resolving a collision means deciding about two
 *    real accounts, which is not a decision code makes.
 *  - **A refused claim leaves an address held and unindexed.** That is the
 *    intended outcome, not a failure, so the reverse direction below is no
 *    more complete than it was: it still cannot enumerate provider holders.
 *
 * The registration writes an account-email row and nothing else. It cannot
 * reach SSO provisioning — `sso-jit` reads the address the IdP asserted at
 * sign-in and never consults this store, and
 * `apps/console/specs/account-emails-never-reach-sso.spec.ts` fails if that
 * stops being true. That guard is what makes the write safe.
 *
 * ## The direction that works, and the one that cannot
 *
 * FORWARD (uid → addresses) is complete: all three sources are readable from
 * the uid. {@link resolveAccountAddresses} is that direction.
 *
 * REVERSE (address → uid) is STRUCTURALLY INCOMPLETE and no amount of care
 * here fixes it. Firebase Auth can look an address up as a primary
 * (`getUserByEmail`) and `emailIdentityIndex` answers for confirmed aliases,
 * but there is no query for "which accounts carry this as a provider
 * address" — that field is only readable once you already have the record.
 * So {@link findAccountsHoldingAddress} can prove an address is AMBIGUOUS and
 * can never prove it is unique, and its callers are written to treat a single
 * answer as "no reason to think otherwise" rather than as a fact.
 *
 * That distinction is the whole reason `subjectUid` is omitted rather than
 * guessed: naming one customer on another customer's data access is worse
 * than naming nobody.
 */

import { createHash } from 'crypto'
import { normalizeAccountEmail } from '@aglyn/aglyn/app-utils/account-emails'
import {
  ACCOUNT_EMAILS_SUBCOLLECTION,
  findAccountByVerifiedAlias,
} from './account-emails'
import { findUserByEmailAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/** Where an address came from. An address can have more than one. */
export type AccountAddressSource =
  /** The Firebase Auth record's `email` — what a token carries today. */
  | 'primary'
  /** A federated provider's own address, from `providerData[].email`. */
  | 'provider'
  /** A row in `users/{uid}/emails` — a confirmed alias, or a former primary. */
  | 'stored'

/** One address, with everything a consumer needs to decide what to do. */
export interface AccountAddress {
  /** Lowercased and trimmed. The form both hashed stores key on. */
  address: string
  /** Every source that named it, so a card can say WHY it is listed. */
  sources: AccountAddressSource[]
  /**
   * `sha256(address)` — the SAME derivation `emailSuppressionKey` uses, so a
   * consumer never has to re-derive it and the two can never disagree about
   * which document describes which person.
   */
  key: string
  /**
   * Another account holds this address too.
   *
   * ⚠️ `false` means "nothing found", NOT "nobody else holds it" — see the
   * reverse-direction note in this module's header.
   */
  shared: boolean
  /**
   * A provider asserted this address for this account and the uniqueness
   * claim was REFUSED, because another account already held it.
   *
   * Carried onto the staff surface rather than left in a log line. The
   * refusal is the whole mechanism: silently skipping the claim is what let
   * the live collision exist unrecorded, so an account carrying a provider
   * address it does not own has to be visible on its own page.
   */
  indexConflict: boolean
}

/**
 * ## How big this can get, and why nothing here slices
 *
 * `MAX_ACCOUNT_EMAILS` is 5 and caps the SUBCOLLECTION only; the primary and
 * the provider addresses are additional, so the set can exceed 5. It stays
 * far under Firestore's 30-element `in` limit in every realistic shape, but
 * "far under" is not a guarantee and a truncated erasure is the worst outcome
 * available in this whole area — it reports success over addresses it never
 * swept.
 *
 * So the rule is: consumers ITERATE this list, they do not slice it, and any
 * consumer feeding it to an `in` query CHUNKS. No function in this module
 * truncates its result.
 */
export interface AccountAddressSet {
  uid: string
  /** The Auth record's current address, or null for an addressless account. */
  primary: string | null
  /** Primary first, then the rest in a stable order. */
  addresses: AccountAddress[]
  /**
   * A source threw and the set may be SHORT.
   *
   * Load-bearing for erasure: erasing "every address" from an incomplete set
   * is not erasing every address, and the caller has to be able to say so
   * rather than report a complete erasure it did not perform.
   */
  incomplete: boolean
}

/** `sha256` of the normalized address. */
export function accountAddressKey(address: string): string {
  return createHash('sha256').update(address).digest('hex')
}

/**
 * Every address `uid` holds, from all three sources.
 *
 * `record` is passed in rather than fetched: every caller already has the
 * Auth record in hand, and re-fetching it would add a pooled lookup to a page
 * that has already paid for one.
 *
 * Best-effort per source. A Firestore outage must not make the delivery card
 * fall back to the single-address behaviour SILENTLY — it reports
 * `incomplete` instead, and the callers that destroy data refuse on it.
 *
 * @param detectShared consult the reverse direction for each non-primary
 *        address. One extra lookup per address; skip it where the answer is
 *        not used.
 */
export async function resolveAccountAddresses(options: {
  uid: string
  /** The Auth record — `email` and `providerData` are read from it. */
  record?: {
    email?: string | null
    providerData?: readonly { email?: string | null }[]
  } | null
  detectShared?: boolean
  firestore?: any
}): Promise<AccountAddressSet> {
  const { uid, record } = options
  const db = options.firestore ?? defaultFirestore()
  const found = new Map<string, Set<AccountAddressSource>>()
  /** Addresses whose provider-asserted claim was refused. */
  const conflicted = new Set<string>()
  let incomplete = false

  const add = (input: unknown, source: AccountAddressSource) => {
    const address = normalizeAccountEmail(input)
    if (address === null) return
    const sources = found.get(address) ?? new Set<AccountAddressSource>()
    sources.add(source)
    found.set(address, sources)
  }

  const primary = normalizeAccountEmail(record?.email ?? null)
  add(record?.email ?? null, 'primary')
  for (const provider of record?.providerData ?? []) {
    add(provider?.email ?? null, 'provider')
  }

  try {
    const stored = await db
      .collection('users')
      .doc(uid)
      .collection(ACCOUNT_EMAILS_SUBCOLLECTION)
      .get()
    for (const doc of stored.docs) {
      const address = normalizeAccountEmail(doc.get('address') ?? doc.id)
      add(address, 'stored')
      if (address !== null && doc.get('indexConflict') === true) {
        conflicted.add(address)
      }
    }
  } catch (error) {
    // The subcollection is where a FORMER primary lives, so losing it is
    // precisely how the orphaned-history bug comes back. Never silent.
    console.error('[account-addresses] stored addresses unreadable', uid, error)
    incomplete = true
  }

  // Primary first: it is the address staff recognise, and a card that led
  // with an alias would read as the wrong account.
  const ordered = [...found.keys()].sort((a, b) => {
    if (a === primary) return -1
    if (b === primary) return 1
    return a.localeCompare(b)
  })

  const addresses: AccountAddress[] = []
  for (const address of ordered) {
    let shared = false
    if (options.detectShared === true) {
      try {
        const holders = await findAccountsHoldingAddress(address, {
          firestore: db,
        })
        shared = holders.uids.some((holder) => holder !== uid)
      } catch {
        // Not `incomplete`: a failed sharing probe under-reports a note on a
        // card. It does not shorten the address list, which is the thing
        // erasure depends on.
        shared = false
      }
    }
    addresses.push({
      address,
      sources: [...(found.get(address) ?? [])],
      key: accountAddressKey(address),
      shared,
      indexConflict: conflicted.has(address),
    })
  }

  return { uid, primary, addresses, incomplete }
}

/** Just the addresses, for a caller that needs nothing else. */
export function addressList(set: AccountAddressSet): string[] {
  return set.addresses.map((entry) => entry.address)
}

/** Just the hashed keys, for a query against a store keyed by them. */
export function addressKeys(set: AccountAddressSet): string[] {
  return set.addresses.map((entry) => entry.key)
}

export interface AddressHolders {
  address: string
  /** Every uid found to hold it. May be SHORT — see below. */
  uids: string[]
  /** More than one distinct account was found. */
  ambiguous: boolean
}

/**
 * Which accounts hold `address`, as far as can be determined.
 *
 * ## What it can and cannot see
 *
 * It consults the two sources an address can be looked up IN:
 *
 *  - Firebase Auth, across pools — the account holding it as its PRIMARY.
 *  - `emailIdentityIndex/{address}` — the account holding it as a CONFIRMED
 *    alias.
 *
 * It cannot see a `providerData` holder, because Firebase Auth offers no
 * lookup by provider address; that field is readable only from a record you
 * already have. This is not a gap that can be closed by trying harder, and
 * the live shape of it is ordinary: an account whose Google provider address
 * is another account's primary.
 *
 * So the result is sound in ONE direction only. `ambiguous: true` is proof
 * that more than one account holds the address. `ambiguous: false` is the
 * absence of evidence, never evidence of absence — a caller must not treat a
 * single uid as "this address belongs to this person".
 */
export async function findAccountsHoldingAddress(
  input: unknown,
  options?: { firestore?: any },
): Promise<AddressHolders> {
  const address = normalizeAccountEmail(input)
  if (address === null) return { address: '', uids: [], ambiguous: false }
  const db = options?.firestore ?? defaultFirestore()
  const uids = new Set<string>()

  try {
    const pooled = await findUserByEmailAcrossPools(address)
    if (pooled?.record?.uid) uids.add(pooled.record.uid)
  } catch {
    // A pool that would not answer leaves the set smaller, which under-reports
    // sharing rather than inventing it.
  }

  try {
    // `account-emails.ts`'s own reverse lookup, not a second read of its
    // index. That function owns what the index means — including that an
    // unverified row is absent from it by construction — and a private copy
    // of the read here would be a second place to keep that in step.
    const alias = await findAccountByVerifiedAlias(address)
    if (alias?.uid) uids.add(alias.uid)
  } catch {
    // Same reasoning.
  }

  return { address, uids: [...uids], ambiguous: uids.size > 1 }
}

/**
 * The single account an address can be attributed to, or null.
 *
 * Null for BOTH "nobody" and "more than one", deliberately. The caller writes
 * an audit subject with it, and a row naming the wrong customer is worse than
 * a row naming none: the collection exists to answer "who at Aglyn read my
 * data", and an answer that points at an innocent account is not a weaker
 * answer, it is a false one.
 */
export async function attributableAccountForAddress(
  input: unknown,
  options?: { firestore?: any },
): Promise<string | null> {
  const holders = await findAccountsHoldingAddress(input, options)
  if (holders.ambiguous) return null
  return holders.uids[0] ?? null
}
