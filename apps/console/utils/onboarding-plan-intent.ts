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
'use client'

import {
  onboardingPlanQuery,
  parseOnboardingPlanIntent,
  type OnboardingPlanIntent,
} from '@aglyn/aglyn'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'

/**
 * Carry the marketing pricing CTA's plan across the email-verification wall
 * (AGL-1535).
 *
 * The AGL-1117 machinery carries the intent through auth bounces on the URL,
 * and that is enough right up until verification: the password door provisions
 * the org (AGL-1523 grace) and lands on `/{slug}/billing?plan=pro`, the app
 * layout bounces the still-unverified account to `/verify-email`, and after the
 * link is clicked `goToApp()` hard-navigates to `/` — with no plan on it. The
 * person who came to buy Pro arrives in their sites and has to find billing.
 *
 * ## Why the server, and not sessionStorage
 *
 * Every browser-local option (sessionStorage like the AGL-1497 consent marker,
 * localStorage, a ref) assumes the verification click happens in the tab that
 * signed up. It frequently does not: people open mail on their phone, or in
 * whatever browser their mail client hands them. The intent has to survive a
 * round trip through an email, so it has to live where the ACCOUNT lives.
 *
 * ## Why `users/{uid}` and not a new collection
 *
 * Signup already writes this document — `persistSignUpProfile` puts the name
 * the form collected there — and the rules already make it owner-read/write
 * (no API route, so no new endpoint to gate, rate-limit or reason about). It
 * is also the only surface that survives the org provisioning FAILING, which
 * is precisely when someone is left standing on the picker with the plan they
 * picked most in need of remembering. Deliberately not the org doc: orgs are
 * Admin-SDK-write-only, so consuming the intent would need a round trip to a
 * new endpoint just to clear a field.
 *
 * ## Why the wire form is what gets stored
 *
 * The stored value is the same query string the deep link uses, re-parsed by
 * the same defensive parser on the way out. A client-writable field is a
 * client-FORGEABLE field, so this must not be a second, more trusting path
 * into plan selection — and it isn't: it decides a redirect and a preselected
 * card, exactly what `?plan=` on the URL already decides, and nothing that
 * touches entitlement.
 */

const FIELD = 'onboardingPlanIntent'

/**
 * How long a remembered intent stays honourable.
 *
 * A verification round trip is minutes, occasionally a day. The window is not
 * the mechanism (consumption is) — it is the backstop for a consume-write that
 * never lands, so that a stale intent expires instead of hijacking the org jump
 * forever.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface StoredOnboardingPlanIntent {
  /** The canonical deep-link query, e.g. `plan=pro&interval=year`. */
  query: string
  createdAtMs: number
}

/**
 * Remember the intent for the account that just signed up. Best-effort by
 * contract, like every other post-account-creation write on that page: a
 * failed remember must never surface as a failed sign-up.
 */
export async function rememberOnboardingPlanIntent(
  firestore: Firestore,
  uid: string,
  intent: OnboardingPlanIntent | null,
): Promise<void> {
  if (!firestore || !uid || !intent) return
  const stored: StoredOnboardingPlanIntent = {
    query: onboardingPlanQuery(intent),
    createdAtMs: Date.now(),
  }
  try {
    await setDoc(doc(firestore, 'users', uid), { [FIELD]: stored }, { merge: true })
  } catch (error) {
    console.error('sign-up plan intent write failed', error)
  }
}

/**
 * Read the remembered intent and clear it, so the upsell landing happens once
 * rather than on every future visit to the org jump.
 *
 * The clear is awaited but its failure is swallowed: having read the intent,
 * honouring it is better than dropping it because the erase did not land — the
 * age window above is what stops that from repeating forever.
 */
export async function consumeOnboardingPlanIntent(
  firestore: Firestore,
  uid: string,
): Promise<OnboardingPlanIntent | null> {
  if (!firestore || !uid) return null
  let stored: Partial<StoredOnboardingPlanIntent> | null = null
  try {
    const snapshot = await getDoc(doc(firestore, 'users', uid))
    stored = (snapshot.data()?.[FIELD] ?? null) as typeof stored
  } catch (error) {
    // A denied or offline read is not worth a broken jump page — the visitor
    // simply lands in their sites, which is today's behaviour.
    console.error('plan intent read failed', error)
    return null
  }
  if (!stored || typeof stored.query !== 'string' || !stored.query) return null
  try {
    // Explicit null, never `undefined` — Firestore rejects the latter.
    await setDoc(doc(firestore, 'users', uid), { [FIELD]: null }, { merge: true })
  } catch (error) {
    console.error('plan intent clear failed', error)
  }
  const createdAtMs = Number(stored.createdAtMs ?? 0)
  if (!createdAtMs || Date.now() - createdAtMs > MAX_AGE_MS) return null
  // Re-parsed, not trusted: the same defensive contract parser the URL goes
  // through, so a hand-edited document cannot name a plan the CTAs cannot.
  return parseOnboardingPlanIntent(new URLSearchParams(stored.query))
}
