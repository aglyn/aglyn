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
 * The record a console door writes when a person decides about the
 * platform's own product email (AGL-3185).
 *
 * ## Two documents, one decision
 *
 * The decision goes onto the person's own `users/{uid}` first — the console
 * shows the preference from there, and it must not depend on the operator's
 * CRM accepting a row — and then onto the operator's marketing contact for
 * the same address through `upsertHostContact`, which is every other capture
 * door's path and the only one the send-time consent join reads. The contact
 * half carries the decision AND its provenance, so a campaign's audience
 * count reports this basis as the person's own click and never as something
 * asserted on their behalf.
 *
 * ## Server-side, because the client cannot and should not
 *
 * The sign-up page is a client of the person's own project; the operator's
 * marketing org is somebody else's data. Only the Admin SDK writes there, and
 * only after the person's ID token has been verified by the route in front
 * of this module. The user-document half could be a client write — the rules
 * make it owner-writable — but a mirror the client writes and the server
 * reads back is two writers of one fact, so both halves are written here.
 *
 * ## Which host, and why it is a setting
 *
 * The marketing host is the deployment's, not the code's: this repository is
 * what a self-hosted install runs, and an install with no product audience of
 * its own has nowhere for a contact to go. `PLATFORM_MARKETING_HOST_ID` names
 * it, and when it is unset the decision is recorded on the person's document
 * alone. No hostname or document id is hardcoded here for the same reason
 * `platform-marketing-host.ts` gives: nothing in the code knows which site
 * is the operator's.
 */

import {
  isPlatformMarketingConsentDecision,
  isPlatformMarketingConsentSourceKind,
  type PlatformMarketingConsentDecision,
  type PlatformMarketingConsentSourceKind,
  type PlatformMarketingConsentState,
  platformMarketingConsentSource,
  platformMarketingUserFields,
  readPlatformMarketingConsent,
  USER_MARKETING_PROMPT_DISMISSED_AT_FIELD,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import firebaseAdmin from './firebase-admin'
import { upsertHostContact } from './upsert-contact'

const firestore = () => firebaseAdmin.app().firestore()

/**
 * The variable naming the host whose contacts receive product-marketing
 * consent — the operator's own marketing site. Unset on a self-hosted
 * install, and honored as "record the preference, capture no contact".
 */
export const PLATFORM_MARKETING_HOST_ID_ENV = 'PLATFORM_MARKETING_HOST_ID'

/**
 * The configured marketing host, or `null` when the deployment names none.
 *
 * Read at call time rather than at module load, so a test can set it and a
 * process that started without it picks up a later value the same way every
 * other runtime setting here does.
 */
export function platformMarketingHostId(): string | null {
  const value = String(process.env.PLATFORM_MARKETING_HOST_ID ?? '').trim()
  return value || null
}

/** What became of the contact half of the record. */
export type PlatformMarketingContactOutcome =
  | { status: 'recorded'; contactId: string; created: boolean }
  /** No marketing host is configured — a self-hosted install. */
  | { status: 'unconfigured' }
  /** The account carries no address a contact could be keyed on. */
  | { status: 'no-email' }
  /** The capture door refused the row — its band, an erasure, or an error. */
  | { status: 'refused'; reason: string }

export interface RecordPlatformMarketingConsentInput {
  uid: string
  /** The account's address, from the verified token. */
  email: string | null | undefined
  /** The name the token carries, for an account whose document holds none. */
  name?: string | null
  decision: PlatformMarketingConsentDecision
  source: PlatformMarketingConsentSourceKind
  /** The wording version the door showed, stamped by the route. */
  textVersion: string
  /** Injectable for tests; defaults to the clock. */
  now?: number
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to {@link platformMarketingHostId}. */
  hostId?: string | null
  /** Injectable for tests; defaults to the real capture door. */
  upsert?: typeof upsertHostContact
}

export interface RecordPlatformMarketingConsentResult {
  /** The timestamp both documents carry. */
  atMs: number
  contact: PlatformMarketingContactOutcome
}

/**
 * The name the person's own document holds, else the one the caller has.
 *
 * The sign-up form writes `firstName`/`lastName` onto the document; a Google
 * account carries its name on the token instead. Either is the name the
 * contact row should show, and a blank is left blank rather than invented.
 */
function accountName(
  snapshot: { get?: (field: string) => unknown } | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  const first = String(snapshot?.get?.('firstName') ?? '').trim()
  const last = String(snapshot?.get?.('lastName') ?? '').trim()
  const stored = [first, last].filter(Boolean).join(' ')
  return stored || String(fallback ?? '').trim() || undefined
}

/**
 * Records a decision on both documents.
 *
 * Loud on bad input, like `recordLegalAcceptance`: a decision that cannot be
 * attributed to an account, a door and a wording is not a record of anything.
 * Quiet on the contact half — a refused row is returned, not thrown — because
 * the person's own preference has already been recorded by then, and the
 * operator's CRM band is not a reason to tell them their choice failed.
 */
export async function recordPlatformMarketingConsent(
  input: RecordPlatformMarketingConsentInput,
): Promise<RecordPlatformMarketingConsentResult> {
  const uid = String(input.uid ?? '').trim()
  if (!uid) throw new Error('recordPlatformMarketingConsent: uid is required')
  if (!isPlatformMarketingConsentDecision(input.decision)) {
    throw new Error('recordPlatformMarketingConsent: decision is required')
  }
  if (!isPlatformMarketingConsentSourceKind(input.source)) {
    throw new Error('recordPlatformMarketingConsent: source is required')
  }
  const textVersion = String(input.textVersion ?? '').trim()
  if (!textVersion) {
    throw new Error('recordPlatformMarketingConsent: textVersion is required')
  }

  const atMs = input.now ?? Date.now()
  const source = platformMarketingConsentSource({
    kind: input.source,
    decision: input.decision,
    uid,
    atMs,
    textVersion,
  })

  const userRef = (input.firestore ?? firestore()).collection('users').doc(uid)
  const snapshot = await userRef.get()
  await userRef.set(
    platformMarketingUserFields({ decision: input.decision, atMs, source }),
    { merge: true },
  )

  const hostId =
    input.hostId === undefined ? platformMarketingHostId() : input.hostId
  if (!hostId) return { atMs, contact: { status: 'unconfigured' } }
  const email = String(input.email ?? '').trim()
  if (!email) return { atMs, contact: { status: 'no-email' } }

  const name = accountName(snapshot, input.name)
  const verdict = await (input.upsert ?? upsertHostContact)({
    hostId,
    email,
    ...(name ? { name } : {}),
    source: 'account',
    // The sentence the provenance carries is also the timeline row's: what
    // the person did, in the words an auditor reads.
    interaction: { atMs, summary: source.reason },
    ...(input.decision === 'granted'
      ? { marketingConsent: true }
      : { declineMarketingConsent: true }),
    marketingConsentSource: source,
    // An account on the platform is at least a lead for the platform's own
    // CRM, whichever way the marketing decision went; the floor never moves
    // a customer back.
    initialLifecycleStage: 'lead',
  })
  if ('refused' in verdict) {
    return { atMs, contact: { status: 'refused', reason: verdict.refused } }
  }
  return {
    atMs,
    contact: {
      status: 'recorded',
      contactId: verdict.contactId,
      created: verdict.created,
    },
  }
}

/**
 * Stamps a prompt dismissal — no decision — so the console stays quiet for
 * the snooze window and asks once more after it.
 */
export async function snoozePlatformMarketingPrompt(
  uid: string,
  options: { now?: number; firestore?: any } = {},
): Promise<{ atMs: number }> {
  const trimmed = String(uid ?? '').trim()
  if (!trimmed) throw new Error('snoozePlatformMarketingPrompt: uid is required')
  const atMs = options.now ?? Date.now()
  await (options.firestore ?? firestore())
    .collection('users')
    .doc(trimmed)
    .set({ [USER_MARKETING_PROMPT_DISMISSED_AT_FIELD]: atMs }, { merge: true })
  return { atMs }
}

/** The decision the person's own document holds, for the console to show. */
export async function readPlatformMarketingConsentForUser(
  uid: string,
  options: { firestore?: any } = {},
): Promise<PlatformMarketingConsentState> {
  const trimmed = String(uid ?? '').trim()
  if (!trimmed) throw new Error('readPlatformMarketingConsentForUser: uid is required')
  const snapshot = await (options.firestore ?? firestore())
    .collection('users')
    .doc(trimmed)
    .get()
  return readPlatformMarketingConsent(
    (snapshot?.data?.() as Record<string, unknown> | undefined) ?? null,
  )
}
