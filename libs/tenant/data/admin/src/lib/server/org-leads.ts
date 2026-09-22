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
 * A lead's one home: `orgs/{orgId}/leads/{personKey}` (AGL-3275).
 *
 * ## Why leads moved
 *
 * A lead used to live at `hosts/{hostId}/leads/{personKey}` while the
 * contact for the same human lived on the org with a `visibleTo` array. The
 * path was doing the job `visibleTo` does, and doing it worse:
 *
 * - An AGENCY was isolated by the path. It is isolated by `visibleTo` too,
 *   with no configuration — `consentGroupScope` on a group of one is
 *   `['host:{id}']`.
 * - A MULTI-BRAND org could not be served at all. `personKey` is derived
 *   from the address, so the same person captured on two sibling brands
 *   produced two documents with byte-identical ids under different parents.
 *   One person was two records by construction, which is the thing AGL-3232
 *   had just finished eliminating for contacts.
 * - The two answers could disagree. A person's contact was visible to every
 *   brand in the consent group they actually consented to — the disclosure
 *   names those brands — while their lead was visible to whichever brand's
 *   form they happened to land on. The lead was scoped more narrowly than
 *   what the person was told, which is the safe direction to be wrong in and
 *   still the wrong answer.
 *
 * So a lead is stamped with `crmScopeTokens` and read with `crmReadTokens`,
 * the same pair the contacts surface uses. Nothing here is a new mechanism;
 * this is leads arriving at the one the rest of the CRM already had.
 *
 * ## The fallback is READ-ONLY, and temporary
 *
 * This repo has run this migration once already — AGL-237 moved datasets,
 * contacts and media to the org, AGL-1040 backfilled, AGL-1050 deleted the
 * fallback — and `orgDataCollectionForHost` carries what it learned:
 *
 *   "a second storage path that can still be WRITTEN is a second boundary to
 *   enforce forever, which undoes the premise of scoped sharing: one home
 *   per resource plus an explicit scope."
 *
 * So the host path is never written here. It is read, once, to carry a
 * not-yet-migrated lead onto the org as a side effect of the next write that
 * touches it ({@link leadForWrite}) — which shrinks what AGL-3276's backfill
 * has left to fold, and means no read can be answered by a stale host row
 * after a write has moved on. AGL-3277 deletes the fallback and the rules
 * block behind it once that backfill reports nothing left to plan.
 */

import {
  crmReadTokens,
  crmScopeTokens,
  type ConsentGroup,
  type ScopeToken,
} from '@aglyn/aglyn/server'
import firebaseAdmin from './firebase-admin'
import {
  consentGroupForSite,
  orgDataCollectionForHost,
  resolveOrgIdForHost,
  scopedToHost,
} from './organizations'

const firestore = () => firebaseAdmin.app().firestore()

/** The legacy home, for the read half of the migration window only. */
function hostLeads(hostId: string): FirebaseFirestore.CollectionReference {
  return firestore().collection('hosts').doc(hostId).collection('leads')
}

/**
 * The org collection a lead is written to. Always the org — see the
 * read-only note above.
 */
export async function orgLeadsForHost(
  hostId: string,
): Promise<FirebaseFirestore.CollectionReference> {
  return orgDataCollectionForHost(hostId, 'leads')
}

/**
 * The leads one site may LIST, narrowed by `visibleTo`.
 *
 * The Admin SDK does not evaluate rules, so an unnarrowed read here would
 * serve one agency client's leads on another's site — the same reason
 * `scopedToHost` exists for every other org-owned collection.
 */
export async function orgLeadsQueryForHost(hostId: string): Promise<{
  ref: FirebaseFirestore.CollectionReference
  query: FirebaseFirestore.Query
}> {
  const ref = await orgLeadsForHost(hostId)
  return { ref, query: scopedToHost(ref, hostId) }
}

/**
 * The tokens a reader holding this group may ask `array-contains-any` for.
 * Capped at 30 by `crmReadTokens`, as the contacts list is.
 */
export async function leadReadTokensForHost(
  hostId: string,
  group?: ConsentGroup,
): Promise<ScopeToken[]> {
  return crmReadTokens(group ?? (await consentGroupForSite(hostId)))
}

/**
 * The `visibleTo` a capture on this site stamps: the consent group's sites,
 * or `['org']` where the org set `defaultResourceScope`.
 *
 * Widened by the capture, never by the lookup — a site that has never
 * captured this person gains nothing by finding them, which is what keeps an
 * agency's clients apart on a record they share. Callers UPDATING an
 * existing lead union these in rather than replacing, exactly as
 * `upsert-contact` does.
 */
export async function leadScopeForHost(
  hostId: string,
  org?: Record<string, unknown> | null,
): Promise<ScopeToken[]> {
  const group = await consentGroupForSite(hostId, org)
  return crmScopeTokens(org ?? null, group)
}

/**
 * The lead for an address, wherever it currently lives.
 *
 * ## The lookup is UNSCOPED, and has to be
 *
 * One human who touched two sibling brands is one person. Narrowing this to
 * what the capturing site may already see would let a second submission on a
 * sibling brand mint a SECOND record for the same address — the duplication
 * this migration exists to end, reintroduced one layer up. Recognizing
 * somebody and being allowed to read their row are different acts:
 * this finds the person, {@link leadScopeForHost} decides who may see them.
 *
 * `upsert-contact` states the same rule at its own dedupe lookup, and for the
 * same reason. A caller that wants only what a site may SEE wants
 * {@link orgLeadsQueryForHost}.
 *
 * @returns the org row; else the not-yet-migrated host row; else `null`.
 */
export async function readLeadForHost(
  hostId: string,
  key: string,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const orgRow = await (await orgLeadsForHost(hostId)).doc(key).get()
  if (orgRow.exists) return orgRow
  const hostRow = await hostLeads(hostId).doc(key).get()
  return hostRow.exists ? hostRow : null
}

/**
 * The ref a write should target, with any host-path predecessor already
 * carried onto it.
 *
 * A lead that has not been backfilled yet is copied to the org on the next
 * write that touches it, under the capturing site's scope, and the host row
 * is left where it is for AGL-3276 to archive. Two things follow: a write
 * never has to decide which of two rows it is amending, and no later read
 * can be answered by a host row that a write has since moved past.
 *
 * `carried` says whether this call did that copy, so a caller can log it and
 * the backfill's count can be reconciled against it.
 */
export async function leadForWrite(
  hostId: string,
  key: string,
  org?: Record<string, unknown> | null,
): Promise<{
  ref: FirebaseFirestore.DocumentReference
  existed: boolean
  carried: boolean
}> {
  const ref = (await orgLeadsForHost(hostId)).doc(key)
  if ((await ref.get()).exists) return { ref, existed: true, carried: false }

  const legacy = await hostLeads(hostId).doc(key).get()
  if (!legacy.exists) return { ref, existed: false, carried: false }

  // The legacy row carries no `visibleTo` — it was scoped by its parent — so
  // the capturing site's group supplies one. `set` rather than `create`: a
  // peer carrying the same row in the same second must not fail the write
  // that provoked it, and both writes carry identical field values.
  await ref.set(
    {
      ...(legacy.data() ?? {}),
      visibleTo: await leadScopeForHost(hostId, org),
      migratedFromHostId: hostId,
    },
    { merge: true },
  )
  return { ref, existed: true, carried: true }
}

/**
 * Whether a host-path lead survives for this address — AGL-3276 reconciling
 * itself, and AGL-3277's deletion check. Not a read path for product code,
 * which wants {@link readLeadForHost}.
 */
export async function legacyLeadExists(
  hostId: string,
  key: string,
): Promise<boolean> {
  return (await hostLeads(hostId).doc(key).get()).exists
}

/** Every org id this process has resolved a lead for — the backfill's entry point. */
export async function orgIdForLeadHost(hostId: string): Promise<string | null> {
  return resolveOrgIdForHost(hostId)
}
