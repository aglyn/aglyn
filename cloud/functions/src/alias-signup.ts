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
 * REFUSE A NEW ACCOUNT WHOSE ADDRESS IS ALREADY ANOTHER ACCOUNT'S (AGL-4041).
 *
 * An account can hold extra, verified addresses (AGL-2486). They live in
 * `emailIdentityIndex/{address}` and `users/{uid}/emails/{address}`, never in
 * the Auth record. Firebase's own "one account per email" only knows about
 * the Auth record, so "Continue with Google" with an address that is
 * another account's verified alias creates a SECOND account under it. On
 * 2026-10-24 that left the first account unable to make its own address
 * primary (EMAIL_EXISTS), and the person with two accounts.
 *
 * ## When this refuses, and when it does not
 *
 * Refused only when ALL of these hold:
 *  - the account is being created in the PROJECT pool (Google, password).
 *    An SSO tenant creation is never refused here: SSO provisioning must not
 *    depend on the alias store (`account-emails-never-reach-sso.spec.ts`).
 *  - the index has an entry for the address, owned by another uid;
 *  - that owner's row for the address says `verified: true`;
 *  - the owner still exists. An index entry left behind by a deleted account
 *    must never stop its address being used again.
 *
 * ⛔ FAILS OPEN. Any read that errors or times out admits the account. This
 * guards against a duplicate, which is recoverable. A sign-up refused
 * because a bookkeeping read failed is an outage.
 *
 * Kept free of `firebase-admin` so `test/alias-signup.test.mjs` can drive it
 * with plain functions.
 */

/** The text a client looks for to tell this refusal from any other. */
export const EMAIL_ON_ANOTHER_ACCOUNT_MARKER = 'email-on-another-account'

export interface AliasSignupReads {
  /** `emailIdentityIndex/{address}.uid`, or null when there is no entry. */
  indexOwner(address: string): Promise<string | null>
  /** `users/{uid}/emails/{address}.verified === true`. */
  rowVerified(uid: string, address: string): Promise<boolean>
  /** False only when Auth says the account no longer exists. */
  ownerExists(uid: string): Promise<boolean>
}

export type AliasSignupVerdict =
  | { refused: false; cause: 'not-applicable' | 'free' | 'unreadable' }
  | { refused: true; cause: 'verified-alias' }

export function normalizeSignupAddress(email: string | null | undefined): string | null {
  const address = String(email ?? '').trim().toLowerCase()
  return address.includes('@') ? address : null
}

export async function aliasSignupVerdict(
  user: { uid?: string | null; email?: string | null; tenantId?: string | null },
  reads: AliasSignupReads,
): Promise<AliasSignupVerdict> {
  if (user.tenantId) return { refused: false, cause: 'not-applicable' }
  const address = normalizeSignupAddress(user.email)
  if (address === null) return { refused: false, cause: 'not-applicable' }

  try {
    const owner = await reads.indexOwner(address)
    if (!owner || owner === user.uid) return { refused: false, cause: 'free' }
    if (!(await reads.rowVerified(owner, address))) return { refused: false, cause: 'free' }
    if (!(await reads.ownerExists(owner))) return { refused: false, cause: 'free' }
    return { refused: true, cause: 'verified-alias' }
  } catch {
    return { refused: false, cause: 'unreadable' }
  }
}
