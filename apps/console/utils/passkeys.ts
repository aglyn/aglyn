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
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { AuthAppErrorCodes, type AuthAppCode } from '@aglyn/shared-data-enums'
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import {
  browserLocalPersistence,
  setPersistence,
  type Auth,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'
import { markInteractiveSignIn } from './interactive-signin'
import { signInWithPooledCustomToken } from './pooled-custom-token'

/**
 * Client half of the passkey ceremonies (AGL-662): the browser runs
 * `navigator.credentials` via `@simplewebauthn/browser`, the server verifies
 * and — for sign-in — answers with a Firebase custom token that flows into
 * the UNCHANGED session machinery (`signInWithCustomToken`, then
 * `useSessionCookie` mints the shared cookie exactly as any other
 * interactive sign-in would).
 */

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn()
}

/**
 * Hydration-safe support check: the server always renders "unsupported",
 * and the button appears in an effect — a support check must never cause a
 * hydration mismatch on the sign-in page.
 */
export function usePasskeysSupported(): boolean {
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    setSupported(browserSupportsWebAuthn())
  }, [])
  return supported
}

/** A server refusal with the machine-readable reason the routes emit. */
export class PasskeyRequestError extends Error {
  constructor(
    public readonly reason: string,
    public readonly status: number,
  ) {
    super(reason)
    this.name = 'PasskeyRequestError'
  }
}

export interface PasskeySignInFailure {
  code: AuthAppCode
  message: string
}

/**
 * Turns any passkey sign-in rejection into something the user can read
 * (AGL-1417).
 *
 * ## Why every branch must return something
 *
 * Both ceremony sites used to special-case `NotAllowedError` and `AbortError`
 * and then do nothing at all — the button showed a spinner, the spinner went
 * away, and that was the entire experience.
 *
 * The reasoning was that those two names mean "the user closed the prompt",
 * and for a REGISTRATION ceremony that is fair: the prompt is always shown,
 * so a dismissal really is a dismissal. For AUTHENTICATION it is wrong.
 * WebAuthn overloads `NotAllowedError` to also mean **no discoverable
 * credential matched the RP ID**, and it does so deliberately, so that a site
 * cannot use the error to probe whether someone has a credential. A person
 * who has never registered a passkey can therefore tap the button and have
 * the ceremony end without any chooser ever appearing.
 *
 * We cannot distinguish the two. So the copy names both possibilities and
 * gives the way forward for each, and — this is the part that was missing —
 * it is always returned. A silent failure is the defect regardless of which
 * of the two actually happened.
 */
export function describePasskeySignInFailure(
  caught: unknown,
): PasskeySignInFailure {
  const name = (caught as { name?: string })?.name

  if (name === 'NotAllowedError' || name === 'AbortError') {
    return {
      code: AuthAppErrorCodes.PASSKEY_NOT_COMPLETED,
      message: 'No passkey was used to sign in.',
    }
  }

  const reason =
    caught instanceof PasskeyRequestError ? caught.reason : undefined

  return {
    code: AuthAppErrorCodes.PASSKEY_SIGNIN_FAILED,
    message: SERVER_REFUSALS[reason] ?? 'Passkey sign-in failed.',
  }
}

/**
 * The reasons the passkey routes emit, in the user's language. Left as one
 * blanket "Passkey sign-in failed." these were indistinguishable, so a
 * rate-limited user and a user with a flagged credential got identical,
 * equally unactionable text.
 *
 * ⚠️ Only the first three are REACHABLE on the sign-in path, and the table
 * overstated its own coverage until AGL-1417's smoke pass. `signin/verify`
 * catches every classified `PasskeyError` and answers a uniform
 * `{ error: 'passkey-signin-failed' }` 401
 * (`app/api/auth/passkeys/signin/verify/route.ts:71-75`) — deliberately, so
 * the response cannot be used to probe which of "unknown credential / bad
 * signature / replayed challenge" occurred. That posture is correct and is
 * NOT being changed here.
 *
 * The consequence is that `passkey-signin-failed` is the reason a real user
 * actually receives, and it was the one key absent from this table — so the
 * commonest server refusal fell through to the bare fallback string with no
 * way forward in it. That is now the entry that matters.
 */
const SERVER_REFUSALS: Record<string, string> = {
  // Reachable: thrown before the ceremony is classified.
  'rate-limited':
    'Too many passkey attempts from this network. Wait a few minutes and ' +
    'try again.',
  'bad-origin': 'Passkey sign-in is not available on this address.',
  // Reachable, and the one nearly every failed ceremony lands on. Says what
  // to do without disclosing which check failed.
  'passkey-signin-failed':
    'That passkey could not be used to sign in. Try another sign-in method, ' +
    'then re-add the passkey from Manage account → Security.',
  // ⚠️ UNREACHABLE on the sign-in path — flattened by signin/verify above.
  // Kept because they are the reasons the server logs, so they stay the
  // shared vocabulary, and because the options leg forwards its own reason.
  // Do not cite any of these as evidence that a case is covered.
  'credential-unknown':
    `That passkey is not registered to an ${PLATFORM_BRAND_NAME} account. ` +
    'It may have been ' +
    'removed.',
  'credential-cloned':
    'That passkey was refused for security reasons. Sign in another way and ' +
    'remove it from Manage account → Security.',
  'challenge-invalid': 'The passkey request expired. Try again.',
  'verification-failed': 'That passkey could not be verified.',
}

/**
 * One POST in a passkey ceremony.
 *
 * `user` absent is the SIGN-IN ceremony, which is anonymous by nature: there
 * is no account yet to authorize it with. Every other step names one, and
 * those go out with credentials or not at all — the token is minted here,
 * at call time, so a ceremony that outlives a token's remaining lifetime
 * still sends a live one on its next step.
 */
async function postJson(
  path: string,
  body: unknown,
  user?: MaybeTokenSource,
): Promise<any> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }
  const response = user
    ? await authorizedFetch(user, path, init)
    : await fetch(path, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PasskeyRequestError(
      String(payload?.error ?? 'request-failed'),
      response.status,
    )
  }
  return payload
}

/**
 * Registers a passkey for the signed-in user. Resolves with the label the
 * credential was stored under; the server sends the "passkey added"
 * security alert on success.
 */
export async function registerPasskey(
  user: Pick<User, 'getIdToken'>,
  label?: string,
): Promise<{ credentialId: string; label: string }> {
  const { challengeId, options } = await postJson(
    '/api/auth/passkeys/register/options',
    {},
    user,
  )
  const response = await startRegistration({ optionsJSON: options })
  return postJson(
    '/api/auth/passkeys/register/verify',
    { challengeId, response, label },
    user,
  )
}

/**
 * Signs in with a discoverable passkey. On success the local Firebase user
 * is signed in; the shared session cookie mint follows via the normal
 * interactive-sign-in path (AGL-463).
 */
export async function signInWithPasskey(auth: Auth): Promise<void> {
  const { challengeId, options } = await postJson(
    '/api/auth/passkeys/signin/options',
    {},
  )
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await postJson('/api/auth/passkeys/signin/verify', {
    challengeId,
    response,
  })
  markInteractiveSignIn()
  await setPersistence(auth, browserLocalPersistence)
  // Passkeys are project-pool only (AGL-662): make sure a leftover tenant
  // selection from an SSO attempt cannot mis-route this sign-in. `null` is
  // the pool, stated deliberately — the same helper every other exchange
  // goes through (AGL-1993).
  await signInWithPooledCustomToken(auth, token, null)
}

/**
 * Removes one of the signed-in user's passkeys (AGL-1881).
 *
 * Resolves with the label it was stored under, so the confirmation can name
 * the credential the user just took off their account rather than saying
 * "passkey removed" about one of several.
 *
 * `removed: false` means it was already gone — a double-click or a retry —
 * and is a success, not an error the caller has to interpret.
 */
export async function removePasskey(
  user: Pick<User, 'getIdToken'>,
  credentialId: string,
): Promise<{ removed: boolean; label: string | null }> {
  return postJson('/api/auth/passkeys/remove', { credentialId }, user)
}
