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

import { AuthAppErrorCodes, type AuthAppCode } from '@aglyn/shared-data-enums'
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import {
  browserLocalPersistence,
  setPersistence,
  signInWithCustomToken,
  type Auth,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'
import { markInteractiveSignIn } from './interactive-signin'

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
 */
const SERVER_REFUSALS: Record<string, string> = {
  'rate-limited':
    'Too many passkey attempts from this network. Wait a few minutes and ' +
    'try again.',
  'bad-origin': 'Passkey sign-in is not available on this address.',
  'credential-unknown':
    'That passkey is not registered to an Aglyn account. It may have been ' +
    'removed.',
  'credential-cloned':
    'That passkey was refused for security reasons. Sign in another way and ' +
    'remove it from Manage account → Security.',
  'challenge-invalid': 'The passkey request expired. Try again.',
  'verification-failed': 'That passkey could not be verified.',
}

async function postJson(
  path: string,
  body: unknown,
  idToken?: string,
): Promise<any> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
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
  const idToken = await user.getIdToken()
  const { challengeId, options } = await postJson(
    '/api/auth/passkeys/register/options',
    {},
    idToken,
  )
  const response = await startRegistration({ optionsJSON: options })
  return postJson(
    '/api/auth/passkeys/register/verify',
    { challengeId, response, label },
    // Re-read: the ceremony can outlive a token's remaining lifetime.
    await user.getIdToken(),
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
  // selection from an SSO attempt cannot mis-route this sign-in.
  auth.tenantId = null
  await signInWithCustomToken(auth, token)
}
