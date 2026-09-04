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
 * The store behind several email addresses per account (AGL-2486).
 *
 * The policy — which address anything is allowed to READ — lives in
 * `@aglyn/aglyn/app-utils/account-emails`, pure and client-importable. This
 * module is the Admin-SDK half: the writes, the uniqueness guard, and the
 * verification round-trip.
 *
 * ## Storage, and why every bit of it is server-only
 *
 *  - `users/{uid}/emails/{address}` — the rows. SERVER-WRITE ONLY. This is
 *    not a style choice: `users/{uid}` itself is `allow read, write` for its
 *    owner under the rules, with no field validation whatsoever, so anything
 *    stored ON that document is a field its owner can set to whatever they
 *    like. An owner-writable `verified: true` is the entire feature defeated
 *    — claim `ceo@acme.com`, flip the bit, and you hold a sign-in identifier
 *    for an address you have never been able to receive mail at. So the rows
 *    live in a subcollection with `allow write: if false`, exactly like
 *    `passkeys` and `legalAcceptances`, and for exactly the same reason:
 *    a client-writable credential store is an auth bypass.
 *  - `emailIdentityIndex/{address}` — `{ uid }`, deny-all. THE uniqueness
 *    guard. Two accounts holding the same verified address makes the sign-in
 *    identifier ambiguous, which is an account-takeover vector, not a
 *    cosmetic clash. Modelled on `passkeyCredentialIndex`.
 *  - `emailVerifications/{tokenId}` — `{ uid, address, digest, expiresAt }`,
 *    deny-all, single-use. Only the DIGEST is stored, so a database read does
 *    not yield a working confirmation link. Modelled on
 *    `webauthnChallenges`.
 *
 * ## What is deliberately NOT here
 *
 * There is no `domainsFor(uid)`, no `emailsInDomain(domain)`, and no lookup
 * that answers "which orgs could this account belong to". Adding one would be
 * the whole hazard: `sso-jit` grants org membership from a verified email's
 * domain, and a helper that handed it this account's OTHER addresses would
 * turn "add an address" into "join an organization". The SSO paths read the
 * address the IdP asserted at sign-in and nothing else — see
 * `apps/console/specs/account-emails-never-reach-sso.spec.ts`, which fails if
 * that stops being true.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  MAX_ACCOUNT_EMAILS,
  evaluatePrimaryChange,
  canRemoveAccountEmail,
  normalizeAccountEmail,
  type AccountEmail,
  type PrimaryChangeVerdict,
} from '@aglyn/aglyn/app-utils/account-emails'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import { authForPool, findUserByEmailAcrossPools } from './auth-pools'
import { ssoDomainEnforcementEnabled, ssoRequiredDomains } from './sso-domain-policy'

const firestore = () => firebaseAdmin.app().firestore()

export const ACCOUNT_EMAILS_SUBCOLLECTION = 'emails'
export const EMAIL_IDENTITY_INDEX_COLLECTION = 'emailIdentityIndex'
export const EMAIL_VERIFICATIONS_COLLECTION = 'emailVerifications'

/**
 * Long enough that a confirmation link survives a mail client's queue and a
 * user who reads mail in the evening; short enough that a link sitting in a
 * forwarded thread stops working. Firebase's own action links use one day.
 */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000

/** Stored row shape. `address` mirrors the document id. */
interface StoredAccountEmail {
  address: string
  verified: boolean
  primary: boolean
  createdAt?: unknown
  verifiedAt?: unknown
}

export interface AccountEmailRow extends AccountEmail {
  /** Null until the round-trip completes. ISO string for the API surface. */
  verifiedAt: string | null
}

/** Every refusal this module can produce, as a stable machine-readable code. */
export type AccountEmailRefusal =
  | 'invalid-address'
  | 'cap-reached'
  | 'already-on-this-account'
  | 'claimed-by-another-account'
  | 'unknown-address'
  | 'cannot-remove-primary'
  | 'last-verified-address'
  | 'token-invalid'
  | 'token-expired'
  | PrimaryChangeVerdict

export interface AccountEmailResult {
  ok: boolean
  refusal: AccountEmailRefusal | null
  message: string | null
}

const ok = (): AccountEmailResult => ({ ok: true, refusal: null, message: null })
const refuse = (
  refusal: AccountEmailRefusal,
  message: string,
): AccountEmailResult => ({ ok: false, refusal, message })

function emailsRef(uid: string) {
  return firestore().collection('users').doc(uid).collection(ACCOUNT_EMAILS_SUBCOLLECTION)
}

function indexRef(address: string) {
  return firestore().collection(EMAIL_IDENTITY_INDEX_COLLECTION).doc(address)
}

function toRow(data: StoredAccountEmail): AccountEmailRow {
  const verifiedAt = data.verifiedAt as { toDate?: () => Date } | undefined
  return {
    address: data.address,
    verified: data.verified === true,
    primary: data.primary === true,
    verifiedAt:
      verifiedAt !== undefined &&
      verifiedAt !== null &&
      typeof verifiedAt.toDate === 'function'
        ? verifiedAt.toDate().toISOString()
        : null,
  }
}

/**
 * Read the account's addresses, seeding the primary row from Firebase Auth on
 * first read.
 *
 * THE BACKFILL IS NOT OPTIONAL. Every account that exists today predates this
 * subcollection, so without the seed an established user opens the card and
 * is told they have no addresses — while `decoded.email` says otherwise — and
 * then "you cannot remove your last verified address" would be enforced
 * against an empty set. The Firebase Auth record is the authority for the
 * primary, so the seed is a mirror rather than a new fact.
 *
 * `authEmailVerified` is carried through honestly: an account that has never
 * confirmed its own sign-up address gets an UNVERIFIED primary row, which is
 * the truth and which the card then offers to fix.
 */
export async function listAccountEmails(
  uid: string,
  authEmail: string | null | undefined,
  authEmailVerified: boolean,
): Promise<AccountEmailRow[]> {
  const snapshot = await emailsRef(uid).get()
  const rows = snapshot.docs.map((doc) => toRow(doc.data() as StoredAccountEmail))

  const primaryAddress = normalizeAccountEmail(authEmail)
  if (primaryAddress === null) return rows

  const known = rows.find((row) => row.address === primaryAddress)
  if (known !== undefined) {
    // The Auth record is the authority for WHICH address is primary. If they
    // ever disagree — a staff email change through the admin console, say —
    // Auth wins and the mirror is corrected, rather than the card showing a
    // primary the token does not carry.
    if (known.primary !== true) {
      await reconcilePrimaryFlag(uid, primaryAddress)
      return listAccountEmails(uid, authEmail, authEmailVerified)
    }
    return rows
  }

  await emailsRef(uid)
    .doc(primaryAddress)
    .set(
      {
        address: primaryAddress,
        verified: authEmailVerified === true,
        primary: true,
        createdAt: FieldValue.serverTimestamp(),
        ...(authEmailVerified === true
          ? { verifiedAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    )
  /*
   * CLEAR THE FLAG OFF WHATEVER USED TO HOLD IT.
   *
   * This branch runs when Auth's address is not among the stored rows — which
   * is exactly what a staff email change produces, since it writes the Auth
   * record directly. Setting the new row primary without clearing the old one
   * left TWO rows flagged primary, and every reader that takes the first match
   * then answers with whichever Firestore returned first.
   *
   * Only when there were pre-existing rows: a first-ever seed has nothing to
   * reconcile and must not pay for a second read and a batch commit.
   */
  if (rows.length > 0) await reconcilePrimaryFlag(uid, primaryAddress)
  // Claim the index for it too, but never steal one: an address already
  // indexed to somebody else is a real conflict that a backfill must not
  // paper over. Best-effort — a failed claim must not stop someone reading
  // their own settings page.
  if (authEmailVerified === true) {
    try {
      await claimIndexEntry(primaryAddress, uid)
    } catch (error) {
      console.error('[account-emails] primary index backfill failed', error)
    }
  }
  return [
    ...rows,
    {
      address: primaryAddress,
      verified: authEmailVerified === true,
      primary: true,
      verifiedAt: null,
    },
  ]
}

async function reconcilePrimaryFlag(uid: string, primaryAddress: string): Promise<void> {
  const snapshot = await emailsRef(uid).get()
  const batch = firestore().batch()
  for (const doc of snapshot.docs) {
    const shouldBePrimary = doc.id === primaryAddress
    if ((doc.get('primary') === true) !== shouldBePrimary) {
      batch.set(doc.ref, { primary: shouldBePrimary }, { merge: true })
    }
  }
  await batch.commit()
}

/**
 * Claim `address` for `uid` in the uniqueness index, transactionally.
 *
 * Returns false when another account already holds it. Re-claiming your own
 * is a no-op success, which is what makes the whole flow idempotent.
 */
async function claimIndexEntry(address: string, uid: string): Promise<boolean> {
  return firestore().runTransaction(async (transaction) => {
    const ref = indexRef(address)
    const existing = await transaction.get(ref)
    if (existing.exists) {
      const owner = existing.get('uid')
      if (owner !== uid) return false
      return true
    }
    transaction.set(ref, { uid, address, claimedAt: FieldValue.serverTimestamp() })
    return true
  })
}

/**
 * Is `address` spoken for by an account other than `uid`?
 *
 * Consults BOTH the index and Firebase Auth, and the Auth half is the
 * load-bearing one. The index only knows about addresses that have been
 * through this feature; every account that existed before it has its primary
 * in the Auth record and nowhere else. Checking the index alone would let a
 * brand-new account claim an established user's sign-up address, which is the
 * exact ambiguity the uniqueness rule exists to prevent.
 *
 * `findUserByEmailAcrossPools` rather than a project-pool `getUserByEmail`:
 * an SSO user lives in their org's GCIP tenant and is invisible to
 * project-level lookups (AGL-1122), so the narrow call would report an
 * enterprise customer's address as free.
 */
async function addressTakenByAnother(address: string, uid: string): Promise<boolean> {
  const indexed = await indexRef(address).get()
  if (indexed.exists && indexed.get('uid') !== uid) return true
  const pooled = await findUserByEmailAcrossPools(address)
  if (pooled !== null && pooled !== undefined && pooled.record.uid !== uid) return true
  return false
}

/**
 * Stage a new address and return the secret for its confirmation link.
 *
 * The address is stored UNVERIFIED and does nothing until the round-trip
 * completes: it is not a sign-in identifier, it receives no account mail, and
 * — importantly — it does NOT claim the uniqueness index. Claiming on `add`
 * would make this endpoint a squatting tool: anyone could park an address
 * they do not own and lock its real owner out of adding it. The index is
 * claimed by {@link confirmAccountEmail}, so the first account to prove
 * delivery wins, and proving delivery is the only way to win.
 *
 * The pre-flight `addressTakenByAnother` here is a courtesy, not the guard —
 * it turns the common case into an immediate, honest error instead of a
 * confirmation email that fails at the end. The real check runs again inside
 * the confirmation transaction, because anything can change in between.
 */
export async function addAccountEmail(
  uid: string,
  input: unknown,
): Promise<AccountEmailResult & { address: string | null; secret: string | null }> {
  const address = normalizeAccountEmail(input)
  if (address === null) {
    return {
      ...refuse('invalid-address', 'Enter a valid email address.'),
      address: null,
      secret: null,
    }
  }

  const existing = await emailsRef(uid).get()
  if (existing.docs.some((doc) => doc.id === address)) {
    return {
      ...refuse('already-on-this-account', 'That address is already on this account.'),
      address,
      secret: null,
    }
  }
  // THE CAP (see MAX_ACCOUNT_EMAILS). Counted from a server read immediately
  // before the write — a number read anywhere else is a number that can be
  // stale by the time it is trusted.
  if (existing.size >= MAX_ACCOUNT_EMAILS) {
    return {
      ...refuse(
        'cap-reached',
        `An account can hold ${MAX_ACCOUNT_EMAILS} email addresses. ` +
          'Remove one before adding another.',
      ),
      address,
      secret: null,
    }
  }
  if (await addressTakenByAnother(address, uid)) {
    return {
      ...refuse(
        'claimed-by-another-account',
        'That address is already in use on another account.',
      ),
      address,
      secret: null,
    }
  }

  await emailsRef(uid).doc(address).set(
    {
      address,
      verified: false,
      primary: false,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  const secret = await issueVerificationToken(uid, address)
  return { ...ok(), address, secret }
}

/**
 * Mint a single-use confirmation secret and store only its digest.
 *
 * The returned string is `{tokenId}.{secret}`; the caller puts it in the
 * emailed link and never persists it. A reader of the database therefore
 * cannot confirm anybody's address — they hold a SHA-256 of the half that
 * matters.
 */
export async function issueVerificationToken(
  uid: string,
  address: string,
): Promise<string> {
  const tokenId = randomBytes(16).toString('hex')
  const secret = randomBytes(32).toString('hex')
  await firestore()
    .collection(EMAIL_VERIFICATIONS_COLLECTION)
    .doc(tokenId)
    .set({
      uid,
      address,
      digest: createHash('sha256').update(secret).digest('hex'),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Date.now() + EMAIL_VERIFICATION_TTL_MS,
    })
  return `${tokenId}.${secret}`
}

/** Constant-time compare of two hex digests of equal length. */
function digestsMatch(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * Complete the round-trip: the bearer of this link can receive mail at the
 * address, so the address becomes verified and the account claims it.
 *
 * Deliberately NOT authenticated against the current session. The person
 * clicking the link is whoever opened the mailbox, and requiring them to be
 * signed in as the right account first is how confirmation links strand
 * people who read mail on a different device. The token itself carries the
 * uid, and it can do nothing except verify the one address it was minted for.
 *
 * The uniqueness claim happens HERE and inside the same logical step as the
 * flag flip, so two accounts racing on one address cannot both end up
 * verified.
 */
export async function confirmAccountEmail(
  token: unknown,
): Promise<AccountEmailResult & { address: string | null; uid: string | null }> {
  const raw = String(token ?? '')
  const separator = raw.indexOf('.')
  if (separator <= 0) {
    return {
      ...refuse('token-invalid', 'That confirmation link is not valid.'),
      address: null,
      uid: null,
    }
  }
  const tokenId = raw.slice(0, separator)
  const secret = raw.slice(separator + 1)
  if (!/^[a-f0-9]{32}$/.test(tokenId) || !/^[a-f0-9]{64}$/.test(secret)) {
    return {
      ...refuse('token-invalid', 'That confirmation link is not valid.'),
      address: null,
      uid: null,
    }
  }

  const tokenRef = firestore().collection(EMAIL_VERIFICATIONS_COLLECTION).doc(tokenId)
  const snapshot = await tokenRef.get()
  if (!snapshot.exists) {
    return {
      ...refuse('token-invalid', 'That confirmation link has already been used.'),
      address: null,
      uid: null,
    }
  }
  if (!digestsMatch(snapshot.get('digest'), createHash('sha256').update(secret).digest('hex'))) {
    return {
      ...refuse('token-invalid', 'That confirmation link is not valid.'),
      address: null,
      uid: null,
    }
  }
  const expiresAt = Number(snapshot.get('expiresAt') ?? 0)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await tokenRef.delete()
    return {
      ...refuse('token-expired', 'That confirmation link has expired — send a new one.'),
      address: null,
      uid: null,
    }
  }

  const uid = String(snapshot.get('uid') ?? '')
  const address = String(snapshot.get('address') ?? '')
  if (!uid || !address) {
    await tokenRef.delete()
    return {
      ...refuse('token-invalid', 'That confirmation link is not valid.'),
      address: null,
      uid: null,
    }
  }

  // Single-use: burned before the claim, so a link cannot be replayed even if
  // the claim below fails.
  await tokenRef.delete()

  if (await addressTakenByAnother(address, uid)) {
    return {
      ...refuse(
        'claimed-by-another-account',
        'That address has since been confirmed on another account.',
      ),
      address,
      uid,
    }
  }
  const claimed = await claimIndexEntry(address, uid)
  if (!claimed) {
    return {
      ...refuse(
        'claimed-by-another-account',
        'That address has since been confirmed on another account.',
      ),
      address,
      uid,
    }
  }

  await emailsRef(uid)
    .doc(address)
    .set(
      { address, verified: true, verifiedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  return { ...ok(), address, uid }
}

/**
 * Remove an address, freeing its index entry.
 *
 * The index entry is released so the address can be used again — on this
 * account or another. Leaving it behind would make removal a way to burn an
 * address permanently, including somebody else's if they ever wanted it.
 */
export async function removeAccountEmail(
  uid: string,
  input: unknown,
): Promise<AccountEmailResult> {
  const address = normalizeAccountEmail(input)
  if (address === null) return refuse('invalid-address', 'Enter a valid email address.')

  const snapshot = await emailsRef(uid).get()
  const rows: AccountEmail[] = snapshot.docs.map((doc) => ({
    address: String(doc.get('address') ?? doc.id),
    verified: doc.get('verified') === true,
    primary: doc.get('primary') === true,
  }))
  const verdict = canRemoveAccountEmail(address, rows)
  if (!verdict.allowed) {
    const row = rows.find((entry) => entry.address === address)
    // Distinct codes so the card can say WHICH floor it hit — "make another
    // address primary first" and "this is your only confirmed address" are
    // different instructions, and a single code would collapse them into one
    // unhelpful sentence.
    const code: AccountEmailRefusal =
      row === undefined
        ? 'unknown-address'
        : row.primary === true
          ? 'cannot-remove-primary'
          : 'last-verified-address'
    return refuse(code, String(verdict.message ?? 'That address cannot be removed.'))
  }

  await emailsRef(uid).doc(address).delete()
  const indexed = await indexRef(address).get()
  if (indexed.exists && indexed.get('uid') === uid) {
    await indexRef(address).delete()
  }
  return ok()
}

export interface SetPrimaryContext {
  /** `decoded.firebase?.tenant` — the pool the caller signed in through. */
  tenantId: string | null
}

/**
 * Re-designate the primary address.
 *
 * THE MOST SECURITY-SENSITIVE WRITE IN THIS MODULE, because the primary IS
 * the Firebase Auth record's email, which is what `decoded.email` carries,
 * which is what `evaluateSsoDomainPolicy` reads at the session mint and what
 * the invite-accept comparison matches on. Changing it changes an
 * authorization input — so it goes through `evaluatePrimaryChange` first, and
 * that function refuses to move a primary off a domain the deployment
 * requires SSO for. See its docstring for why that refusal ignores the
 * enforcement switch.
 *
 * The Auth record is updated in the account's OWN pool via `authForPool`: a
 * project-level `updateUser` cannot see a GCIP tenant account, so the narrow
 * call would silently fail for exactly the enterprise users this policy is
 * about.
 *
 * `emailVerified: true` is set alongside the address, and it is honest — the
 * only addresses that can reach this point are ones this module verified by
 * an emailed round-trip. Omitting it would flip the account to unverified and
 * lock it out of every route behind `emailUnverifiedResponse()`.
 */
export async function setPrimaryAccountEmail(
  uid: string,
  input: unknown,
  context: SetPrimaryContext,
): Promise<AccountEmailResult> {
  const address = normalizeAccountEmail(input)
  if (address === null) return refuse('invalid-address', 'Enter a valid email address.')

  const snapshot = await emailsRef(uid).get()
  const rows: AccountEmail[] = snapshot.docs.map((doc) => ({
    address: String(doc.get('address') ?? doc.id),
    verified: doc.get('verified') === true,
    primary: doc.get('primary') === true,
  }))
  const current = rows.find((row) => row.primary === true) ?? null
  const next = rows.find((row) => row.address === address) ?? null

  const decision = evaluatePrimaryChange({
    current,
    next,
    requiredDomains: ssoRequiredDomains(),
    tenantId: context.tenantId ?? null,
    enforcementEnabled: ssoDomainEnforcementEnabled(),
  })
  if (!decision.allowed) {
    return refuse(decision.verdict, String(decision.message ?? 'That change is not allowed.'))
  }

  await authForPool(context.tenantId).updateUser(uid, {
    email: address,
    emailVerified: true,
  })
  await reconcilePrimaryFlag(uid, address)
  return ok()
}

/**
 * The account that holds `address` as a VERIFIED alias, or null.
 *
 * ## Read this before calling it
 *
 * This is the one lookup that maps an arbitrary address to an account, and it
 * exists for exactly two callers: resolving a sign-in identifier, and
 * matching an org invitation. Both are safe for the same reason — neither
 * GRANTS anything on the strength of the address:
 *
 *  - a sign-in identifier still has to be followed by the account's password;
 *  - an invitation is an explicit grant the ORG made, and this only decides
 *    which of the recipient's mailboxes it may arrive at.
 *
 * It must never be wired into an SSO path. `sso-jit` resolves the org from
 * the GCIP tenant on a re-verified token and matches the domain the IdP
 * asserted; giving it this function would let a user add an address and be
 * provisioned into the matching organization, which is the escalation this
 * whole feature was designed around.
 *
 * Returns null for an unverified row by construction: the index is only ever
 * written by the confirmation path.
 */
export async function findAccountByVerifiedAlias(
  input: unknown,
): Promise<{ uid: string; address: string } | null> {
  const address = normalizeAccountEmail(input)
  if (address === null) return null
  const indexed = await indexRef(address).get()
  if (!indexed.exists) return null
  const uid = String(indexed.get('uid') ?? '')
  if (!uid) return null
  return { uid, address }
}

/*==========================================
 * PROVIDER-SUPPLIED ADDRESSES.
 *
 * A federated provider asserts its own address, and `providerData[].email`
 * can differ from the primary. Until now nothing registered one: it was
 * absent from `users/{uid}/emails`, held no `emailIdentityIndex` entry, and
 * so lived entirely OUTSIDE the uniqueness guard — while remaining a real
 * mailbox, a working sign-in identifier, and a recipient of real mail.
 *
 * The consequence is a collision the guard was built to prevent and could not
 * see: one address that is one account's primary and another account's Google
 * provider address. Anything mapping address → uid then answers confidently
 * and wrongly.
 *=========================================*/

/** What one {@link registerProviderAddresses} pass did. */
export interface ProviderAddressRegistration {
  /** Addresses newly claimed for this account. */
  claimed: string[]
  /** Addresses another account already holds — recorded, never taken. */
  conflicted: string[]
}

/**
 * Providers whose asserted address counts as proven.
 *
 * `password` is excluded because its address is the primary, already handled,
 * and its verification state lives on the Auth record rather than in the
 * provider entry. Everything else here is a federated IdP that has itself
 * established control of the mailbox — the same standard
 * {@link confirmAccountEmail} applies, met by a different party.
 */
function isFederatedProvider(providerId: string | null | undefined): boolean {
  const id = String(providerId ?? '')
  return id !== '' && id !== 'password' && id !== 'phone' && id !== 'anonymous'
}

/**
 * Register the addresses a federated provider asserts for this account.
 *
 * Called from the session mint — the one place every interactive sign-in
 * passes through with a verified token — and BEST-EFFORT by contract.
 *
 * ## Three rules, in priority order
 *
 * 1. **Sign-in must not depend on this.** It is bookkeeping. A person locked
 *    out because an index write failed is a worse outcome than the collision
 *    it was preventing, so every failure here is swallowed and logged, and
 *    the caller runs it off the critical path.
 * 2. **A claim never takes an entry another account holds.**
 *    {@link claimIndexEntry} already refuses; what was missing is that the
 *    refusal went nowhere. A conflict now lands on the row as
 *    `indexConflict`, which the staff account page reads — silently skipping
 *    is exactly what produced the live collision.
 * 3. **A conflicted address is stored UNVERIFIED.** This is the conservative
 *    half and it matters: `verifiedAccountEmails` feeds invitation matching,
 *    so marking a contested address verified on both accounts would make one
 *    invitation match two people. Unverified, the row is a record that the
 *    address exists on this account and grants nothing.
 *
 * ⛔ It does not merge, reassign or disable anything. Two real accounts
 * sharing an address is a human decision — the row makes it visible and stops
 * there.
 *
 * ⚠️ Registering here CANNOT reach SSO provisioning. `sso-jit` reads the
 * address the IdP asserted at sign-in and never consults this store;
 * `apps/console/specs/account-emails-never-reach-sso.spec.ts` fails if that
 * stops being true. That guard is what makes this safe to write at all.
 */
export async function registerProviderAddresses(
  uid: string,
  record: {
    email?: string | null
    providerData?: readonly {
      providerId?: string | null
      email?: string | null
    }[]
  } | null,
): Promise<ProviderAddressRegistration> {
  const claimed: string[] = []
  const conflicted: string[] = []
  const primary = normalizeAccountEmail(record?.email ?? null)

  const candidates = new Set<string>()
  for (const provider of record?.providerData ?? []) {
    if (!isFederatedProvider(provider?.providerId)) continue
    const address = normalizeAccountEmail(provider?.email ?? null)
    // The primary is registered by `listAccountEmails`' own backfill, on the
    // Auth record's authority. Re-doing it here would race that seed.
    if (address === null || address === primary) continue
    candidates.add(address)
  }

  for (const address of candidates) {
    try {
      const won = await claimIndexEntry(address, uid)
      if (won) claimed.push(address)
      else conflicted.push(address)

      await emailsRef(uid)
        .doc(address)
        .set(
          {
            address,
            // Only when the claim was won — see rule 3.
            verified: won,
            primary: false,
            source: 'provider',
            ...(won
              ? { verifiedAt: FieldValue.serverTimestamp(), indexConflict: false }
              : { indexConflict: true, indexConflictAtMs: Date.now() }),
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
    } catch (error) {
      // Rule 1. Never rethrow: the caller is a sign-in.
      console.error('[account-emails] provider address registration failed', uid, error)
    }
  }

  if (conflicted.length) {
    // Loud, per rule 2 — a conflict that only ever landed in a document would
    // be discovered by whoever happened to open the right page.
    console.error(
      '[account-emails] provider address already claimed by another account',
      JSON.stringify({ uid, conflicted: conflicted.length }),
    )
  }
  return { claimed, conflicted }
}

/**
 * Every VERIFIED address on an account, for matching an invitation.
 *
 * Bounded by {@link MAX_ACCOUNT_EMAILS}, which is what makes it safe to feed
 * straight into a Firestore `in` query (limit 30).
 *
 * ⛔ NOT the answer to "every address this account holds" — it is verified-only,
 * subcollection-only and silently truncating, all correct here and all wrong
 * there. `account-addresses.ts` is that resolver and explains why at length.
 */
export async function verifiedAccountEmails(uid: string): Promise<string[]> {
  const snapshot = await emailsRef(uid).get()
  return snapshot.docs
    .filter((doc) => doc.get('verified') === true)
    .map((doc) => String(doc.get('address') ?? doc.id))
    .slice(0, MAX_ACCOUNT_EMAILS)
}
