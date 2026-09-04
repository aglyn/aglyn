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
  doc,
  runTransaction,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'

/**
 * The workspace a sign-up asked for, held until the address is proven
 * (AGL-2590).
 *
 * ## Why the workspace is not created at sign-up any more
 *
 * `/api/auth/session` refuses to mint a session cookie while `email_verified`
 * is false, and every console route refuses the account behind it. So the
 * workspace the sign-up form used to create seconds after the Firebase
 * account was unusable until the person verified: they could not open it,
 * enter it, or do anything with it. The AGL-1115 benefit it was created for —
 * landing in a workspace rather than a chooser — is delivered on the first
 * USABLE session, which is after verification either way.
 *
 * What eager creation did buy was a permanent claim on a workspace address,
 * handed out before anyone had shown the address belonged to them. This module
 * is the other half of removing that: the name the person typed is held with
 * the ACCOUNT and applied when the workspace is finally created.
 *
 * ## Why `users/{uid}`, and not browser storage
 *
 * The same reasoning as `onboarding-plan-intent.ts`, which crosses the same
 * wall: the verification click routinely happens in a different browser from
 * the one that signed up — a phone, whatever the mail client opens. Anything
 * kept in sessionStorage or localStorage is simply not there. The account's own
 * document is, and sign-up already writes it.
 *
 * ## ⚠️ Why the record is bound to the credential that wrote it
 *
 * Identity Platform holds ONE account per email address. When a verified
 * federated provider signs in on an address that an UNVERIFIED password
 * account already holds, it takes over that account: the same `localId`, the
 * password credential destroyed, the password providers removed (measured
 * against the Auth emulator — see `oauth-over-unverified-password.emulator.spec.ts`).
 * That is the correct anti-pre-hijacking behaviour, and it is why an attacker
 * who signs up as `victim@example.com` cannot keep a password into the
 * victim's account.
 *
 * But the takeover is an AUTH-layer event. It does not touch Firestore, so
 * everything the unverified account wrote survives on the same uid and is
 * inherited by whoever takes the account over. A workspace was the worst of
 * those, and this issue removes it. This record is the next one: without a
 * binding, an attacker's typed "Evil Corp" would be applied to the victim's
 * first verified session and become the address their customers use.
 *
 * So the record names the provider that wrote it, and it is honoured only
 * while the account still holds that provider. After a federated takeover the
 * password provider is gone, the record is discarded, and the workspace is
 * named the ordinary way. A person who genuinely signs up with a password and
 * then signs in with Google on the same address before verifying pays the same
 * price — a workspace named by derivation rather than by what they typed,
 * which they can rename. Nothing distinguishes them from the attack at the
 * moment the decision has to be made, and a renameable name is the cheaper
 * mistake.
 */
const FIELD = 'pendingSignUpWorkspace'

/**
 * How long a held name stays honourable.
 *
 * The same window `onboarding-plan-intent.ts` gives the plan a visitor picked,
 * for the same reason: a verification round trip is minutes, occasionally a
 * day. The window is the backstop, not the mechanism — the claim below is what
 * makes this happen once.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The provider id Identity Platform gives an email/password credential. */
const PASSWORD_PROVIDER = 'password'

export interface PendingSignUpWorkspace {
  /** The workspace name to create. */
  name: string
  /**
   * Whether a person TYPED this name (AGL-1942).
   *
   * The AGL-1523 picker notice quotes the name back — "we couldn't create your
   * workspace X" — which only reads as an answer when X is what they entered.
   */
  nameWasTyped: boolean
}

interface StoredPendingSignUpWorkspace extends PendingSignUpWorkspace {
  /**
   * The sign-in provider the account held when this was written. See the
   * module note: the record is void once the account no longer holds it.
   */
  provider: string
  createdAtMs: number
}

/** The shape this module needs from a Firebase `User`. */
export interface SignUpWorkspaceAccount {
  uid: string
  providerData: readonly { providerId: string }[]
}

/**
 * Hold the name the sign-up form collected until the address is proven.
 *
 * Best-effort by contract, like every other post-account-creation write on the
 * sign-up page: the account exists and the person is signed in by this point,
 * so a failed hold must never surface as a failed sign-up. The cost of losing
 * it is a workspace named the way the server would have named it anyway.
 */
export async function rememberPendingSignUpWorkspace(
  firestore: Firestore,
  uid: string,
  pending: PendingSignUpWorkspace,
): Promise<void> {
  const name = pending.name.trim()
  if (!firestore || !uid || !name) return
  const stored: StoredPendingSignUpWorkspace = {
    name,
    nameWasTyped: pending.nameWasTyped,
    provider: PASSWORD_PROVIDER,
    createdAtMs: Date.now(),
  }
  try {
    await setDoc(
      doc(firestore, 'users', uid),
      { [FIELD]: stored },
      { merge: true },
    )
  } catch (error) {
    console.error('sign-up workspace hold failed', error)
  }
}

/**
 * Take the held name, exactly once.
 *
 * ## Why a transaction
 *
 * A verified account can reach its first session from more than one place at
 * once — the tab that signed up is polling for verification while the tab that
 * clicked the link is landing — and both would read the same held name and
 * create the same workspace twice. Reading and clearing in one transaction
 * makes the second reader find nothing.
 *
 * ## Why the clear is unconditional
 *
 * A record that fails the provider binding or the age window is CONSUMED, not
 * left behind: it has already been judged, and leaving it would put the same
 * judgement in front of every later sign-in. A record that is claimed and then
 * fails to become a workspace is handed to the AGL-1523 notice on the picker,
 * which offers the name back in the create dialog — the person is told, rather
 * than the record silently retrying forever against a name the server has
 * already refused.
 */
export async function claimPendingSignUpWorkspace(
  firestore: Firestore,
  account: SignUpWorkspaceAccount,
): Promise<PendingSignUpWorkspace | null> {
  if (!firestore || !account?.uid) return null
  let stored: Partial<StoredPendingSignUpWorkspace> | null
  try {
    const reference = doc(firestore, 'users', account.uid)
    stored = await runTransaction(firestore, async (transaction) => {
      const snapshot = await transaction.get(reference)
      const held = (snapshot.data()?.[FIELD] ??
        null) as Partial<StoredPendingSignUpWorkspace> | null
      if (!held) return null
      // Explicit null, never `undefined` — Firestore rejects the latter.
      transaction.set(reference, { [FIELD]: null }, { merge: true })
      return held
    })
  } catch (error) {
    // A denied, offline or contended read is not worth a broken landing — the
    // person reaches the workspace chooser, which is where sign-up landed
    // everyone before AGL-1115 and still offers workspace creation.
    console.error('sign-up workspace claim failed', error)
    return null
  }
  if (!stored || typeof stored.name !== 'string' || !stored.name) return null
  const createdAtMs = Number(stored.createdAtMs ?? 0)
  if (!createdAtMs || Date.now() - createdAtMs > MAX_AGE_MS) return null
  // The binding. See the module note: a record written by a credential this
  // account no longer holds was written by somebody else.
  const provider = String(stored.provider ?? '')
  if (
    !provider ||
    !account.providerData.some((entry) => entry?.providerId === provider)
  ) {
    return null
  }
  return { name: stored.name, nameWasTyped: stored.nameWasTyped === true }
}

/** What `/api/orgs/create` answered. */
export interface SignUpWorkspaceOutcome {
  /** The workspace address, when one was created. */
  slug: string | null
  /** The server's error copy, when it sent any. */
  error: string | null
}

/**
 * Create the workspace, and say what happened.
 *
 * Shared by the two doors that provision (AGL-2590): the sign-up page, for an
 * account that arrives already verified, and the workspace chooser, for the
 * first verified session of an account that had to wait. One routine, so the
 * two cannot disagree about what a refusal means.
 *
 * A 409 means the address was taken and the workspace was NOT created, so the
 * caller falls through to the chooser; inventing a suffix here would hand
 * somebody a workspace URL they never chose.
 */
export async function createSignUpWorkspace(
  user: MaybeTokenSource,
  name: string,
): Promise<SignUpWorkspaceOutcome> {
  try {
    const response = await authorizedFetch(user, '/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('sign-up org create failed', payload?.error)
      return {
        slug: null,
        error: typeof payload?.error === 'string' ? payload.error : null,
      }
    }
    return {
      slug: typeof payload?.slug === 'string' ? payload.slug : null,
      error: null,
    }
  } catch (error) {
    console.error('sign-up org create failed', error)
    return { slug: null, error: null }
  }
}
