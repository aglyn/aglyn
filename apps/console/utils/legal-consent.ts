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
 * Clickwrap consent, carried across the mobile OAuth redirect (AGL-1497).
 *
 * The consent checkbox lives in React state, and on mobile the Google flow is
 * `signInWithRedirect` — the browser leaves the page entirely and comes back
 * to a FRESH mount where that state is gone. The account is created during
 * that round-trip, so without a marker the redirect path both bypassed the
 * gate and had nothing left to record: the tick genuinely did not survive to
 * the moment it was supposed to be evidence of.
 *
 * Same mechanism, and the same reasoning, as `interactive-signin.ts`:
 * sessionStorage survives same-tab navigation, and the timestamp lets an
 * abandoned sign-up self-heal instead of leaving a tick lying around that
 * silently consents to a LATER attempt.
 */
import { getAdditionalUserInfo, type UserCredential } from 'firebase/auth'

const MARKER_KEY = 'aglyn:legal-consent-at'
const DEFAULT_MAX_AGE_MS = 120_000

/**
 * Where the sign-in page sends someone whose "sign in" turned out to create an
 * account. The sign-up page reads it to explain why they were moved, so the
 * bounce reads as an answer rather than as a failure.
 */
export const CONSENT_REQUIRED_SEARCH = 'consent=required'

/**
 * Send someone to the page that actually has the clickwrap gate on it.
 *
 * A hard navigation, not a router push: the caller has just signed an account
 * out, and the sign-up page has to boot against that cleared auth state rather
 * than re-use a tree rendered while it was still signed in.
 */
export function sendToConsentGate(): void {
  window.location.assign(`/signup?${CONSENT_REQUIRED_SEARCH}`)
}

/**
 * Did this credential just CREATE the account (AGL-1497)?
 *
 * `signInWithPopup` with a Google provider is not a sign-in — it is a
 * sign-in-or-sign-up, and Firebase does not ask which one you meant. So the
 * /signin page's Google button has always been a fourth account-creation
 * door, one with no consent checkbox anywhere near it: a brand-new human
 * could hold an Aglyn account having never been shown the Terms.
 *
 * `getAdditionalUserInfo` is the only thing that distinguishes the two, and
 * before this it appeared nowhere in the repo.
 */
export function isNewAccount(credential: UserCredential): boolean {
  return getAdditionalUserInfo(credential)?.isNewUser === true
}

export function markLegalConsent(): void {
  try {
    window.sessionStorage.setItem(MARKER_KEY, String(Date.now()))
  } catch {
    // Private mode / storage disabled: desktop is unaffected (the popup flow
    // never unmounts, so React state still holds the tick).
  }
}

/**
 * Reads-and-clears the marker. True only when consent was given in this tab
 * within `maxAgeMs` — i.e. the sign-up now completing is the one it was for.
 */
export function consumeLegalConsent(maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  try {
    const raw = window.sessionStorage.getItem(MARKER_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(MARKER_KEY)
    return Date.now() - Number(raw) < maxAgeMs
  } catch {
    return false
  }
}

export function clearLegalConsent(): void {
  try {
    window.sessionStorage.removeItem(MARKER_KEY)
  } catch {
    // ignore
  }
}

/** The doors an acceptance can come through, for the record's `context`. */
export type LegalAcceptanceContext =
  | 'signup-password'
  | 'signup-google'
  | 'signup-google-redirect'

/**
 * Hand the acceptance to the server, which stamps it with the version and the
 * server clock and writes the record the user cannot touch.
 *
 * Best-effort by the same contract as the profile and org writes beside it on
 * this page: the account exists and the user is signed in by the time this
 * runs, so a failed record must not present as a failed sign-up. It is
 * reported loudly to the console and returns false, so the caller can decide.
 */
export async function postLegalAcceptance(
  user: { getIdToken: () => Promise<string> },
  version: string,
  context: LegalAcceptanceContext,
): Promise<boolean> {
  try {
    const idToken = await user.getIdToken()
    const response = await fetch('/api/auth/legal-acceptance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ version, context }),
    })
    if (!response.ok) {
      // A non-2xx resolves rather than throws, so this needs checking
      // explicitly or the failure is invisible.
      console.error(
        'legal acceptance not recorded',
        response.status,
        await response.text().catch(() => ''),
      )
      return false
    }
    return true
  } catch (error) {
    console.error('legal acceptance not recorded', error)
    return false
  }
}
