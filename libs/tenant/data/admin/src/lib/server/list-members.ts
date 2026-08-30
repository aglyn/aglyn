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
 * The only writer of `orgs/{orgId}/lists/{listId}/members` (AGL-2499).
 *
 * Two enrollment routes reach this collection — the commerce newsletter
 * handler and the workflow `enrollList` step — and they used to derive the
 * document id two incompatible ways: a full `sha256(email)` on one side, a
 * `hmac('aglyn-list-member', email)` truncated to 20 hex on the other. The
 * same person subscribing by both routes became two members of one list.
 *
 * The id is now `personKey` on both, which is the derivation both
 * `docs/specs/email-overhaul.md` §3d and `docs/specs/reusable-forms.md` §4
 * specify, and it normalizes before hashing so casing cannot fork it either.
 *
 * ## Why a helper and not two corrected call sites
 *
 * Two call sites that merely agree today are what produced the split: nothing
 * about either one said the other existed. A third route — the reusable-forms
 * capture path is already specified — would have been written the same way.
 * Enrolling goes through this function so that the id has one definition and
 * no caller is offered the chance to derive its own.
 */

import type { DocumentReference } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import {
  normalizeContactEmail,
  personKey,
  readMarketingBasis,
} from '@aglyn/aglyn/server'
import { createHash, createHmac } from 'node:crypto'

/**
 * The two ids this collection was written under before `personKey`.
 *
 * Read-only, and never written for a new row: they exist so an address
 * already enrolled under a legacy id is *found* rather than duplicated. See
 * `enrollListMember` for why that lookup is the migration.
 *
 * Both take the normalized address, which is what the two original call sites
 * happened to pass — each lowercased at its own entry point before hashing, so
 * every row already on the collection was keyed from a lowercased address even
 * though neither derivation enforced it.
 */
function legacyListMemberIds(normalizedEmail: string): string[] {
  return [
    createHash('sha256').update(normalizedEmail).digest('hex'),
    createHmac('sha256', 'aglyn-list-member')
      .update(normalizedEmail)
      .digest('hex')
      .slice(0, 20),
  ]
}

/**
 * What makes an enrollment mailable, and who is answerable for it.
 *
 * Two values and no third. They are not interchangeable and the difference is
 * the whole reason the basis is stored rather than implied:
 *
 * - `contact-opt-in` — the person ticked a box. The enrollment carries a
 *   decision they made, and `atMs` is when THEY made it, not when the row was
 *   written. Nobody is answerable because nobody asserted anything.
 * - `operator-attested` — a console account stated that they have this
 *   person's permission. That statement is itself the basis, so it is only
 *   worth storing with the account that made it and the moment they did.
 *
 * Rendering the second as though it were the first is what a support or
 * compliance question cannot recover from, which is why the basis rides
 * beside `marketingConsent` on every row that has one.
 */
export type ListMemberConsentBasis = 'contact-opt-in' | 'operator-attested'

/** A basis, with the attribution that makes it answerable. */
export interface ListMemberConsent {
  basis: ListMemberConsentBasis
  /**
   * When the basis was recorded.
   *
   * For a pass-through this is the ORIGINAL opt-in moment carried over from
   * the person's own record, because the question a consent record answers is
   * when the person said yes — not when somebody copied their answer onto a
   * list.
   */
  atMs: number
  /** The console account that attested. Meaningless for a pass-through. */
  byUid?: string | null
  /**
   * Why, in the operator's own terms, for whoever audits this later.
   *
   * Written for an attestation and ignored for a pass-through, which needs no
   * explanation beyond the person's own record. An import fills it from what
   * the FILE declared — the opt-in source and date the merchant supplied per
   * row — because "a declared basis per address, not one checkbox over the
   * file" is only worth asking for if the declaration survives onto the row
   * it was made about.
   */
  reason?: string
}

export interface EnrollListMemberInput {
  /** `orgs/{orgId}/lists/{listId}` — the caller has already proved it exists. */
  listRef: DocumentReference
  email: string
  name?: string
  /** Free-form provenance: `'newsletter'`, `'action:{actionId}'`. */
  source: string
  /**
   * Explicit marketing opt-in, with a consent timestamp — the same shape
   * `upsertHostContact` and `addHostLead` already carry.
   *
   * A list membership had NO consent field of any kind, so `audience: 'list'`
   * had nothing for the send-time join to read
   * (`docs/specs/email-overhaul.md` §1d/§3f). This is the field that closes
   * it, and it is the caller's captured checkbox: enrolling is an act, and
   * `false`/omitted therefore writes nothing rather than a basis.
   */
  marketingConsent?: boolean
  /**
   * The basis in full, for a caller that knows more than "a box was ticked".
   *
   * `marketingConsent: true` is the shorthand a capture surface uses: it means
   * `contact-opt-in`, recorded now, asserted by nobody. Anything else — a
   * pass-through carrying the person's ORIGINAL opt-in date, or an
   * attestation carrying the account that made it — has to say so, and this
   * is where it says it. The two inputs are normalized to one value before
   * anything is written, so there is a single writer of the consent fields.
   */
  consent?: ListMemberConsent
  /**
   * How the person got here: enrolled by hand or by an automation
   * (`'manual'`), or selected by a dynamic list's rule (`'rule'`).
   *
   * The materializer needs to tell its own rows apart from a manual one on
   * the same list, because a person who stops matching the rule leaves and a
   * person somebody added by hand does not.
   */
  via?: 'manual' | 'rule'
}

export interface EnrolledListMember {
  /** The document actually written — a legacy id when one was adopted. */
  memberId: string
  /** True when an existing legacy-keyed row was written instead of a new one. */
  adopted: boolean
  /** False when the row already existed under some id. */
  created: boolean
}

/** Why nothing was written. */
export type EnrollListMemberRefusal =
  /** Not an address this collection can key. Nothing to write, nothing to fix. */
  | 'unusable-address'
  /**
   * The person's membership records a REFUSAL. Not overridable by any caller
   * and not reported as a failure to fix, because the fix would be to ignore
   * it.
   */
  | 'declined'

/**
 * Enrolled, or refused and why.
 *
 * A union rather than `EnrolledListMember | null`, because the two refusals
 * are not the same event and a caller that cannot tell them apart is a caller
 * that reports a person's recorded refusal as a malformed address.
 */
export type EnrollListMemberResult =
  | ({ enrolled: true } & EnrolledListMember)
  | { enrolled: false; refusal: EnrollListMemberRefusal }

/**
 * Enrolls one address into a list, at one document per person.
 *
 * ## The legacy lookup is the migration
 *
 * Changing the derivation without one would strand every row written under the
 * old ids: the next enrollment of an address already on the list would key a
 * *new* document beside the old one, so a defect that produced duplicates only
 * when two routes met would start producing them on a single route. Rather
 * than rewrite those ids — a bulk operation that has to delete the row it
 * replaces, and deleting an enrollment destroys the consent record that says
 * the person asked to be there — the write resolves the person's existing
 * document and keeps using it.
 *
 * The cost is one `getAll` of three refs, on a human-triggered signup, in
 * place of the blind `set` this replaced. It is one round trip, not three.
 *
 * `addedAt` is stamped only when the document is created, so re-enrolling
 * keeps the date the person actually joined — the same "earliest wins" collapse
 * `docs/specs/email-overhaul.md` §3d asks a backfill to preserve.
 *
 * ## A recorded refusal stops every route through this function
 *
 * This is the only writer of the collection, so the refusal check belongs
 * here and not at the four call sites: a guard on the button that adds
 * somebody by hand leaves the newsletter handler, the workflow `enrollList`
 * step and the dynamic-list materializer free to put the same person back.
 * The membership snapshot is already in hand from the id resolution above, so
 * the check costs no read.
 *
 * It answers the question about the LIST ROW. A refusal recorded on the
 * person's CRM record is a different document this function does not fetch —
 * a caller that can see one is expected to consult it, and the send-time
 * consent join reads the row this function writes either way.
 */
export async function enrollListMember(
  input: EnrollListMemberInput,
): Promise<EnrollListMemberResult> {
  const email = normalizeContactEmail(input.email)
  if (!email) return { enrolled: false, refusal: 'unusable-address' }
  const key = personKey(email)
  if (!key) return { enrolled: false, refusal: 'unusable-address' }

  const members = input.listRef.collection('members')
  const canonicalRef = members.doc(key)
  const legacyRefs = legacyListMemberIds(email)
    // A legacy derivation that happens to agree with `personKey` — `sha256` of
    // the same normalized address does — must not be fetched twice: `getAll`
    // rejects duplicate references.
    .filter((id) => id !== key)
    .map((id) => members.doc(id))

  const snapshots = await input.listRef.firestore.getAll(
    canonicalRef,
    ...legacyRefs,
  )
  const existing = snapshots.find((snapshot) => snapshot.exists)
  const target = existing?.ref ?? canonicalRef

  if (
    existing &&
    readMarketingBasis(existing.data() as Record<string, unknown>).basis ===
      'declined'
  ) {
    return { enrolled: false, refusal: 'declined' }
  }

  /*
   * ONE value from the two ways a caller may state a basis.
   *
   * `marketingConsent: true` is a capture surface saying "a box was ticked
   * just now", which is `contact-opt-in` recorded at this moment with nobody
   * asserting it. Normalizing here rather than branching at the write is what
   * keeps the consent fields to a single writer — two branches stamping
   * overlapping subsets of them is how a row comes to carry a basis with no
   * timestamp, or a timestamp with no basis.
   */
  const consent: ListMemberConsent | null =
    input.consent ??
    (input.marketingConsent
      ? { basis: 'contact-opt-in', atMs: Date.now() }
      : null)

  await target.set(
    {
      email,
      ...(input.name ? { name: input.name } : {}),
      source: input.source,
      ...(input.via ? { via: input.via } : {}),
      /*
       * Written only when the caller has a basis, and never unwritten.
       *
       * A merge that stamped `marketingConsent: false` on the omitted case
       * would erase a basis this person gave on an earlier enrollment, and a
       * withdrawn consent is not the same event as a re-enrollment that
       * happened to carry no checkbox. Withdrawal has its own path — the
       * unsubscribe link and the suppression list.
       *
       * `marketingConsentAtMs` moves with each fresh basis on purpose: the
       * question a consent record answers is when the person last said yes.
       *
       * The `marketingConsent` family rather than the `consent*` names
       * `docs/specs/email-overhaul.md` §3d sketched: `readMarketingBasis` is
       * the shipped reader and it reads these, so a second vocabulary here
       * would be a basis the send-time join cannot see. The two new fields
       * are attribution ON that field — they say why the person is mailable,
       * never whether — so nothing about the send decision moves into them.
       *
       * `marketingConsentByUid` is written on EVERY basis, `null` for a
       * pass-through. Leaving it absent would let a real opt-in that
       * supersedes an earlier attestation inherit the attesting account, and
       * a row reading "this account vouched for them" when the person ticked
       * a box themselves is a false attribution in the one direction a
       * compliance answer cannot afford.
       *
       * `marketingConsentReason` follows the same rule for the same reason:
       * always written, `''` for a pass-through, so a later real opt-in
       * cannot inherit the sentence an earlier import wrote about where the
       * merchant said the address came from.
       */
      ...(consent
        ? {
            marketingConsent: true,
            marketingConsentAtMs: consent.atMs,
            marketingConsentBasis: consent.basis,
            marketingConsentByUid: consent.byUid ?? null,
            marketingConsentReason: consent.reason ?? '',
          }
        : {}),
      ...(existing ? {} : { addedAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )

  return {
    enrolled: true,
    memberId: target.id,
    adopted: target.id !== key,
    created: !existing,
  }
}
