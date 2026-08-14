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
 * What a clickwrap acceptance is an acceptance OF (AGL-1497).
 *
 * A record that points at a live URL proves nothing. `aglyn.com/legal/terms`
 * answers "what does the page say today?", and the question a dispute asks is
 * "what did this person see on the day they signed up?" — a different
 * question, and the documents are already moving: the published pages have
 * diverged from their masters in the Platform Docs drive, and the live Terms
 * still carry `[Registered agent address — pending]` in three places that
 * somebody is going to edit before launch.
 *
 * So a version here names a FIXED TEXT, not a link:
 *
 *   - `constants/legal/{version}/{key}.txt` is an immutable snapshot of the
 *     document as published, captured from the live page — the text a user
 *     was actually shown, not the drive master it has drifted from.
 *   - `sha256` pins that snapshot. It goes onto every acceptance record, so a
 *     record is self-contained evidence of content and any later tampering
 *     with the archive is detectable rather than invisible.
 *
 * Per VERSION, not per acceptance: the snapshots are ~41 KB in total and the
 * hash on each record is 64 bytes, so a million acceptances cost kilobytes
 * instead of gigabytes. (Production Firestore is around 6.3 MB today.)
 *
 * WHY THE VERSION IS NOT A DATE. The drive masters still carry an unfilled
 * `[EFFECTIVE DATE]` placeholder, so there is no date to read from the source
 * of truth at all — and ToS §5.3 changes the Terms by "posting the updated
 * Terms and updating the 'Last updated' date", which makes the date the field
 * that moves every time the thing it would identify changes. `v1` is an opaque
 * revision id we own.
 *
 * TO PUBLISH A CHANGE: add `constants/legal/v2/`, bump `LEGAL_DOCUMENT_VERSION`
 * and the hashes here. You cannot quietly skip that step — the spec in
 * `specs/legal-document-version.spec.ts` re-hashes the snapshots and fails if
 * the text under a version no longer matches the hash recorded for it, so `v1`
 * can never come to mean two different documents.
 */

import { LEGAL_URLS } from './shared'

export const LEGAL_DOCUMENT_VERSION = 'v4'

export interface LegalDocumentManifestEntry {
  /** Stable key, and the snapshot's filename under `legal/{version}/`. */
  key: string
  /** The URL rendered in the consent control. */
  url: string
  /** SHA-256 of the snapshot, as UTF-8 bytes. */
  sha256: string
  /** Byte length of the snapshot, a cheap second check on the same content. */
  bytes: number
}

/**
 * The documents covered by one acceptance. ToS §19.1 makes the Terms the
 * entire agreement INCLUDING the policies it incorporates by reference, so
 * accepting these two accepts that set.
 *
 * v2 (2026-08-13, AGL-1499): the approved pre-launch legal corrections —
 * beta/$50-cap separation in the Terms (§1.1, §6, §14.3, §15.3), the real
 * retention posture and CCPA flat denial in the Privacy Policy. Captured from
 * the live pages after publication, same method as v1.
 *
 * v3 (2026-08-14, AGL-1555): the registered agent exists, so the Terms lose
 * their three `[Registered agent address — pending]` placeholders — the party
 * block (registered office), §19.8 Notices, and §19.11 Contact all now name
 * Northwest Registered Agent in Austin. The Privacy Policy's §3 provider bullet
 * drops Anthropic, which processes nothing: `ANTHROPIC_API_KEY` is absent from
 * production and the AI-assist route 501s. Same capture method as v1 and v2,
 * proven against the v2 hashes before this set was taken.
 *
 * The DMCA designated-agent block and the cookie policy changed in the same
 * pass but are not snapshotted here — only the two documents the consent
 * control links to are, and the Terms incorporate the rest by reference
 * (§19.1). See `LEGAL_URLS`.
 *
 * v4 (2026-08-14, AGL-1564 + AGL-1565): one snapshot cycle for two legal
 * changes, because every bump re-pins clickwrap and forces re-acceptance.
 *
 *   - AGL-1564, Privacy Policy: phone number is now disclosed as collected
 *     (§1.1, naming both sources — given to us, or asserted by the customer's
 *     SSO identity provider), the §2 purposes list separates the transactional
 *     use (billing, dunning, service and security notices) from the
 *     marketing/sales-outreach use, and §11 gains a call/text opt-out. The
 *     capability was already live — `users/{uid}.phoneNumber` is written by
 *     `/api/auth/session` and `/api/auth/sso-jit` — and the policy was silent.
 *   - AGL-1565, Terms: §19.12's Texas DTPA waiver is REMOVED — §17.42 needs a
 *     signed writing with the consumer represented by counsel of their own
 *     selection, which clickwrap structurally cannot be, so the clause bound
 *     nobody while inviting an unconscionability argument against the clauses
 *     around it, and 0 of 10 benchmarked peers attempt any consumer-statute
 *     waiver. It is replaced by a sentence saying no such waiver is asked for.
 *     §18.2 now applies the AAA's CONSUMER rules, with any in-person hearing
 *     in the consumer's own locality, where the user is an individual using
 *     the Services primarily for personal, family, or household purposes, and
 *     Commercial rules in every other case (Webflow's precedent). §15.5 gains
 *     the carve-outs the cap had in neither direction: death or personal
 *     injury, fraud, gross negligence or willful misconduct, and any
 *     non-waivable consumer right. §15.3's $50 floor was re-read under the
 *     consumer posture and is still correctly scoped to unpaid use.
 *
 * ⚠️ §7's licence for "internal business OR PERSONAL purposes" is DELIBERATE
 * and MUST NOT BE "FIXED". Consumers — solo founders and pre-entity
 * individuals starting a business — are an intended ICP (Zach, 2026-08-14),
 * so §7 correctly describes the market. An earlier pass on the same day
 * recommended deleting "or personal" and scoping the beta to business use;
 * that recommendation is REVERSED and must not be quietly re-reversed. It was
 * never an escape anyway: Texas DTPA §17.45(4) counts businesses under $25M
 * in assets as consumers, so the entire ICP — agencies included — sits inside
 * the statute either way. §19.12 and §18.2 were what misdescribed the market;
 * §7 was not.
 *
 * ⚠️ TCPA is NOT solved by any of this. The v4 Privacy Policy discloses
 * marketing calls and texts; a disclosure is not consent, and consumers being
 * a real ICP is where the TCPA bites hardest. No outbound calling or texting
 * programme should start until the consent mechanism is designed. Recorded as
 * counsel questions in `Platform Docs/Legal/Analysis/` — privacy benchmark
 * items 9-10, terms benchmark items 1, 2, 2b, 2c, 4.
 *
 * §11's opt-out promise now HAS a mechanism (AGL-1592): the do-not-contact
 * list at `contactSuppressions/{e164}`, its staff intake at
 * `/admin/contact-suppressions`, a STOP-keyword seam awaiting an SMS pipeline,
 * and `forgetUserPhoneNumber`, which stops `/api/auth/sso-jit` re-asserting an
 * erased number from the customer's IdP. That closes the mechanism gap and NOT
 * the consent gap above — they are separate, and both are prerequisites.
 *
 * ⚠️ §11 IS NOW SLIGHTLY NARROWER THAN THE IMPLEMENTATION, deliberately, and
 * the fix belongs in v5. §11 says you may "ask us to delete the phone number
 * we hold for you" without saying that we keep it on a suppression list — and
 * we must, because a number we cannot recognise is a number we will dial the
 * next time it reaches us. The carve-out is standard (CCPA §1798.105(d);
 * the TSR's entity-specific do-not-call duty is unmeetable without a retained
 * list), but it should be stated rather than inferred. Proposed wording is on
 * AGL-1592. Do NOT resolve the mismatch by making the code forget the number:
 * that reads as compliance and produces the call the person asked to prevent.
 *
 * Both documents also move their "Last updated" date to August 14, 2026, which
 * is the mechanism ToS §5.3 and Privacy §12 name for a change taking effect.
 * Same capture method as v1–v3, proven against the v3 hashes before this set
 * was taken.
 */
export const LEGAL_DOCUMENTS: LegalDocumentManifestEntry[] = [
  {
    key: 'terms',
    url: LEGAL_URLS.TERMS,
    sha256:
      '1ae10b9074cb2e175dd7553180c0bb9a0d77a88c3a263a102a5c6a4c143a1ec2',
    bytes: 33295,
  },
  {
    key: 'privacy',
    url: LEGAL_URLS.PRIVACY,
    sha256:
      '913eda63de5304f40e1ad44a816f696e8a58c51c40d2419f8afbcc3e9d64acd7',
    bytes: 12032,
  },
]
