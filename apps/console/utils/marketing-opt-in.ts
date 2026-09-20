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
 * The console's side of the product-updates decision (AGL-3185): the marker
 * that carries a sign-up tick across the mobile OAuth redirect, and the two
 * calls every door makes to `/api/auth/marketing-consent`.
 *
 * The marker is the `legal-consent.ts` mechanism for the same reason: on a
 * phone the Google flow is a full-page redirect, the page is torn down
 * before the account exists, and React state does not survive that. Session
 * storage does, and the timestamp lets an abandoned attempt expire instead
 * of opting in a later one.
 *
 * Absence is never carried. An unticked box sets no marker, consuming a
 * missing marker answers `false`, and `false` records nothing — the sign-up
 * door only ever writes a grant.
 */

import {
  PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  type PlatformMarketingConsentDecision,
  type PlatformMarketingConsentSourceKind,
  type PlatformMarketingConsentState,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** The one route both halves of the record are read and written through. */
export const MARKETING_CONSENT_ROUTE = '/api/auth/marketing-consent'

const MARKER_KEY = 'aglyn:marketing-opt-in-at'
const DEFAULT_MAX_AGE_MS = 120_000

export function markMarketingOptIn(): void {
  try {
    window.sessionStorage.setItem(MARKER_KEY, String(Date.now()))
  } catch {
    // Private mode / storage disabled: desktop is unaffected (the popup flow
    // never unmounts, so React state still holds the tick).
  }
}

/**
 * Reads-and-clears the marker. True only when the box was ticked in this tab
 * within `maxAgeMs` — the sign-up now completing is the one it was for.
 */
export function consumeMarketingOptIn(maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  try {
    const raw = window.sessionStorage.getItem(MARKER_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(MARKER_KEY)
    return Date.now() - Number(raw) < maxAgeMs
  } catch {
    return false
  }
}

export function clearMarketingOptIn(): void {
  try {
    window.sessionStorage.removeItem(MARKER_KEY)
  } catch {
    // ignore
  }
}

/** What the route answers a GET with. */
export interface MarketingConsentStatus extends PlatformMarketingConsentState {
  /** Whether the one-time prompt should show now, decided by the server. */
  promptDue: boolean
  /** The wording version this deploy shows. */
  currentTextVersion: string
}

/** A signed-in account, as the console's hooks hand it over. */
type TokenUser = { getIdToken: () => Promise<string> } | null | undefined

/**
 * The person's recorded decision, or `null` when it could not be read.
 *
 * Fails SILENT rather than closed, like the re-acceptance banner's read: a
 * status that could not be fetched must not show a prompt to somebody who
 * already answered, and must not hide the preference switch either — the
 * card says it could not load instead.
 */
export async function fetchMarketingConsentStatus(
  user: TokenUser,
): Promise<MarketingConsentStatus | null> {
  try {
    const response = await authorizedFetch(user, MARKETING_CONSENT_ROUTE)
    if (!response.ok) return null
    return (await response.json()) as MarketingConsentStatus
  } catch {
    return null
  }
}

/** What a door can send: a decision, or the prompt's dismissal. */
export type MarketingConsentAnswer = PlatformMarketingConsentDecision | 'dismissed'

/**
 * Hands a decision to the server, which stamps the server clock and writes
 * the record on both documents.
 *
 * The wording version is sent so the server can refuse a decision made
 * against a sentence this deploy no longer shows. Best-effort by the same
 * contract as the legal acceptance beside it on the sign-up page: a failed
 * record is reported loudly and returns false, and must not present as a
 * failed sign-up.
 */
export async function postMarketingConsent(
  user: TokenUser,
  answer: MarketingConsentAnswer,
  source: PlatformMarketingConsentSourceKind,
): Promise<boolean> {
  try {
    const response = await authorizedFetch(user, MARKETING_CONSENT_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: answer,
        source,
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      }),
    })
    if (!response.ok) {
      // A non-2xx resolves rather than throws, so this needs checking
      // explicitly or the failure is invisible.
      console.error(
        'marketing consent not recorded',
        response.status,
        await response.text().catch(() => ''),
      )
      return false
    }
    return true
  } catch (error) {
    console.error('marketing consent not recorded', error)
    return false
  }
}
