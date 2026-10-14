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
 * WHAT ENFORCING SINGLE SIGN-ON WOULD DO TO EACH ACCOUNT (AGL-1888, AGL-3671) —
 * the pure half of the Single sign-on card's rehearsal table, with no import at
 * all, so the native apps replay it (`ssoEnforcementAccounts`) beside the
 * console's card, which draws the very same rows.
 *
 * The rehearsal answers one entry per account of the identity pool: the sign-in
 * methods enforcement would remove (`unlinked`), the ones it leaves (`kept`),
 * and why it would leave the account alone (`skipped`). An account can be
 * designated break-glass only if it holds a way in that is not the identity
 * provider itself: anything else would look like protection and provide none.
 */

/** One account of the rehearsal, as the single sign-on route answers it. */
export interface SsoEnforcementAccount {
  uid: string
  email: string | null
  unlinked: readonly string[]
  kept: readonly string[]
  skipped?: string
}

/** One row of the rehearsal table, in the words the console shows. */
export interface SsoEnforcementRow {
  uid: string
  /** The address, else the account's uid. */
  label: string
  /** What the account would lose, or why it would lose nothing. */
  wouldLose: string
  /** What it keeps. */
  keeps: string
  /** Whether it can be designated break-glass (it holds a way in other than the provider). */
  eligible: boolean
  /** Whether it is designated break-glass now. */
  designated: boolean
}

/**
 * Would designating this account actually keep a way in?
 *
 * Mirrors `assessSsoLockoutRisk` deliberately, and over the same fact it
 * uses: an account protects the org only when it holds a provider that is
 * NOT the org's IdP. Designating an account whose sole credential is the SAML
 * link is the most natural way to get this wrong, because it looks exactly
 * like protection and fails in precisely the situation it exists for.
 *
 * The plan is read BEFORE designation, so both halves count: `unlinked` is
 * what enforcement would strip (all non-IdP by construction), and `kept` is
 * what it would leave — which for an already-designated or would-orphan
 * account is the whole set.
 */
export function protectsIfDesignated(account: Pick<SsoEnforcementAccount, 'unlinked' | 'kept'>, providerId: string | undefined): boolean {
  return [...account.unlinked, ...account.kept].some((id) => id !== providerId)
}

/** What the account would lose, as the rehearsal table words it. */
export function ssoEnforcementLoses(account: Pick<SsoEnforcementAccount, 'unlinked' | 'skipped'>): string {
  if (account.skipped === 'break-glass') return 'Nothing — designated break-glass'
  if (account.skipped) return 'Nothing — it would be left with no way in'
  return account.unlinked.join(', ') || '—'
}

/** The rehearsal table's rows, one per account, for the break-glass choice. */
export function ssoEnforcementAccounts(
  accounts: readonly SsoEnforcementAccount[] | null | undefined,
  providerId: string | undefined,
  designated: readonly string[] | null | undefined,
): SsoEnforcementRow[] {
  const chosen = new Set(designated ?? [])
  return (accounts ?? []).map((account) => ({
    uid: account.uid,
    label: account.email ?? account.uid,
    wouldLose: ssoEnforcementLoses(account),
    keeps: account.kept.join(', ') || '—',
    eligible: protectsIfDesignated(account, providerId),
    designated: chosen.has(account.uid),
  }))
}
