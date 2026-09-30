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

import { isLockdownActive } from '@aglyn/aglyn/server'
import { findUserByUidAcrossPools } from './auth-pools'
import { getUserLockdown } from './lockdown'

/**
 * WHETHER AUTOMATED PLATFORM MAIL TO ONE ACCOUNT IS WITHHELD (AGL-3418).
 *
 * True for an account under an active user lock (`lockdowns/user--{uid}`)
 * or whose Auth record is disabled. Such an account cannot sign in to act on
 * a usage alert, a digest or a notification, and for a risk lock the mail is
 * worse than useless: it keeps a suspected bad actor informed about the
 * workspace it was locked out of.
 *
 * Discretionary mail only. The lock and unlock notices, security alerts,
 * password and verification mail, erasure confirmations and receipts do not
 * ask this, and must not — they are how the person learns what happened.
 *
 * Pass `authDisabled` when the caller already holds the Auth record, to skip
 * the pool lookup. A lookup that fails reads as "not disabled": the lock
 * record is the authoritative signal, and an outage must not silence mail.
 */
export async function isAccountMailWithheld(
  uid: string | null | undefined,
  options: { authDisabled?: boolean } = {},
): Promise<boolean> {
  if (!uid) return false
  if (options.authDisabled) return true
  if (isLockdownActive(await getUserLockdown(uid), Date.now())) return true
  if (options.authDisabled === false) return false
  const pooled = await findUserByUidAcrossPools(uid).catch(() => null)
  return pooled?.record?.disabled === true
}

/**
 * `uids` minus every account {@link isAccountMailWithheld} withholds, in
 * the order given. The checks run concurrently.
 */
export async function withoutMailWithheldAccounts(
  uids: readonly string[],
): Promise<string[]> {
  const withheld = await Promise.all(
    uids.map((uid) => isAccountMailWithheld(uid).catch(() => false)),
  )
  return uids.filter((_, index) => !withheld[index])
}
