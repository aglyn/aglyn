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
 * The durable half of the visitor-record ceilings (AGL-1529) — the lead
 * writer that enforces `LEADS_MAX_PER_HOST`, and the bookkeeping that makes a
 * trip of EITHER ceiling something a site's owner can see.
 *
 * The policy is pure and lives in `@aglyn/aglyn/server`
 * (`visitor-record-ceiling.ts`); this is the part that needs Firestore. Same
 * split as `visitorWriteRateLimitRefusal`, and for the same reason.
 */

import {
  CAPTURED_BY_HOST_FIELD,
  checkVisitorRecordCeiling,
  LEADS_MAX_PER_HOST,
  marketingConsentFieldsForGroup,
  personKey,
  readMarketingBasis,
  submissionMonthKey,
  visitorRecordRefusedCounterId,
  type VisitorRecordKind,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import {
  attributeCampaignConversion,
  type ResolvedCampaignTouch,
} from './campaign-conversion-attribution'
import { notifyHostManagers } from './notifications'
import firebaseAdmin from './firebase-admin'
import {
  consentGroupForSite,
  orgDataCollectionForHost,
  resolveOrgIdForHost,
  scopedToHost,
} from './organizations'
import { crmReadTokens, crmScopeTokens } from '@aglyn/aglyn/server'
import type { ConsentGroup, ScopeToken } from '@aglyn/aglyn/server'

const firestore = () => firebaseAdmin.app().firestore()

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
  return orgRow.exists ? orgRow : null
}

/**
 * The ref a write should target.
 *
 * This carried a not-yet-backfilled host row onto the org first, and reported
 * whether it had (`carried`). AGL-3276 emptied the host path and AGL-3277
 * removed it, so there is nothing left to carry: the org row is the only row.
 * `carried` stays on the shape, always `false`, because several callers
 * destructure it and a lie is cheaper to read than a signature change that
 * says nothing.
 */
export async function leadForWrite(
  hostId: string,
  key: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference
  existed: boolean
  carried: boolean
}> {
  const ref = (await orgLeadsForHost(hostId)).doc(key)
  return { ref, existed: (await ref.get()).exists, carried: false }
}


/**
 * Make a tripped ceiling OBSERVABLE rather than a silent drop — the * standing rule that a control which is not visible in the console does not
 * count as shipped.
 *
 * Two audiences, one call, in exactly `recordAbuseCeilingTrip`'s shape
 * (`apps/tenant/app/api/forms/submit/route.ts`, AGL-1655):
 *
 *  - A durable per-month refusal count at
 *    `hosts/{id}/counters/{siteMembers|leads}Refused`. Counters are excluded
 *    from every client write in `cloud/firebase-firestore.rules` (AGL-1367),
 *    so the record cannot be edited away by the site it describes, and host
 *    admins can already READ it — which is what lets the inbox console page
 *    render it with no rules change.
 *  - One in-app notification to the site's managers, on the FIRST refusal of
 *    the month only. A notification per refused bot request would be the
 *    flood again, delivered.
 *
 * The counter is month-keyed even though the CEILING is a total, because the
 * two facts are different: the ceiling is "how many records exist" and this is
 * "how many were turned away recently". Only the second is worth a notice.
 *
 * Best-effort throughout: bookkeeping that failed must never turn a contained
 * refusal into a 500, because a 500 is an invitation to retry.
 */
export async function recordVisitorRecordCeilingTrip(options: {
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  kind: VisitorRecordKind
  ceiling: number
  monthKey?: string
}): Promise<void> {
  const { hostRef, hostId, kind, ceiling } = options
  const monthKey = options.monthKey ?? submissionMonthKey()
  try {
    const refusedRef = hostRef
      .collection('counters')
      .doc(visitorRecordRefusedCounterId(kind))
    const refusedSnapshot = await refusedRef.get()
    const alreadyRefused = Number(refusedSnapshot.get(monthKey) ?? 0)
    await refusedRef.set(
      {
        [monthKey]: FieldValue.increment(1),
        // Explicit values only — Firestore rejects `undefined`.
        ceiling,
        lastRefusedAtMs: Date.now(),
      },
      { merge: true },
    )
    if (alreadyRefused === 0) {
      const leads = kind === 'leads'
      await notifyHostManagers(hostId, {
        type: 'system.visitorRecordsPaused',
        title: leads
          ? 'Lead capture paused — this site is at the platform limit'
          : 'Sign-ups paused — this site is at the platform limit',
        body:
          `This site holds ${ceiling.toLocaleString()} ` +
          `${leads ? 'leads' : 'member accounts'}, which is the platform ` +
          `safety limit, so further ${leads ? 'leads' : 'sign-ups'} are ` +
          'being refused. This is not part of your plan — every plan ' +
          `includes unlimited ${leads ? 'leads' : 'member accounts'}. ` +
          `Remove some ${leads ? 'leads' : 'members'}, or contact support ` +
          'if this is real traffic.',
        link: `/${hostId}/inbox`,
      })
    }
  } catch (error) {
    console.error('visitor record ceiling bookkeeping failed', error)
  }
}

/** What a caller wants stored on the lead. `createdAt` is stamped here. */
export interface HostLeadInput {
  email: string
  /** The name the person typed, when they typed one (AGL-2303). */
  name?: string
  /** `signup`, `booking`, `form:{formId}` — the surface that produced it. */
  source: string
  /**
   * Explicit marketing opt-in, with a consent timestamp — the same shape
   * `upsertHostContact` already carries (AGL-301). Omitted or `false` writes
   * nothing: a lead is a side effect of an action the visitor DID take
   * (sign up, book), which is not by itself consent to be emailed
   * marketing, so this is only set when the caller captured an explicit
   * checkbox.
   */
  marketingConsent?: boolean
}

/**
 * Record one lead at `hosts/{hostId}/leads/{personKey}`, bounded by
 * `LEADS_MAX_PER_HOST` (AGL-1529).
 *
 * ## One person is one document
 *
 * `docs/specs/reusable-forms.md` §4b. This used to be `tx.create(ref.doc())`
 * — an auto-id per capture event — so one returning customer who signed up
 * and booked twice was three "leads". The Members & leads tab presented a
 * list of events as a list of people, and the only thing holding two rows for
 * one person together was string equality on the address at render time.
 *
 * The events are not lost, they are just no longer the record: `sources`
 * carries every surface that produced a capture, `submissionCount` counts
 * them, and `firstSeenAtMs`/`lastSeenAtMs` bracket them. The submissions, the
 * bookings and the member document are still there and still one row each.
 *
 * The id is {@link personKey} — `sha256(normalizeContactEmail(email))`, the
 * SAME derivation a list membership's `memberKey` uses, imported rather than
 * restated. Two specs named this function and the rule both stated is that
 * whichever ships second imports the first's helper: a second copy is how
 * `emailSuppressionKey` and `suppressionId` came to disagree.
 *
 * ## Why every lead writer goes through here
 *
 * There are three lead writes in the repo — the sign-up handler and the two
 * bookings paths — and all three were `hostRef.collection('leads').add(…)`
 * with a `.catch()` on the end. A cap enforced at two of three call sites is
 * not a cap, and the fourth writer somebody adds next month would not have
 * one either. One function is the only shape that survives that.
 *
 * ## The count is evaluated INSIDE the transaction that writes
 *
 * A create-time quota can be laundered by WHEN it is evaluated, not by the
 * counting rule (AGL-2231/2265/2266). Read-then-decide-then-`add()` lets N
 * concurrent visitors each read the same pre-count, each find room, and each
 * land — and nothing re-counts afterwards, so the extra rows are permanent.
 * `Transaction.get(AggregateQuery)` serialises the count against a concurrent
 * create into the same collection: the loser retries, re-reads the higher
 * count, and is refused. The count is of LIVE documents, so triaging leads in
 * the inbox frees the slots.
 *
 * ## Refusing a lead never fails the visitor's action
 *
 * A lead is a SIDE EFFECT — of a sign-up, or of a booking. The visitor did
 * not ask for it and cannot see it, so refusing one must not refuse the thing
 * they did ask for. This returns a boolean and never throws; the trip is
 * recorded and the caller carries on. That is the honest split, and it is why
 * `SITE_MEMBERS_MAX_PER_HOST` (which governs an action a visitor DID take) is
 * enforced with a 429 in the sign-up handler and this is not.
 */
export async function addHostLead(options: {
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  lead: HostLeadInput
  /**
   * The ceiling to compare against. Defaults to `LEADS_MAX_PER_HOST` and is
   * passed by NOTHING in production — it exists so the suite can re-drive the
   * same count against a ceiling one higher and require the write to succeed.
   * A refusal that survives its own ceiling being raised was never that
   * ceiling's refusal, and there is exactly ONE comparison below, so knifing
   * it cannot be absorbed by a fallback branch.
   */
  ceiling?: number
  /**
   * The campaign this person came from, already resolved by the door.
   *
   * Resolved rather than raw, and passed rather than looked up, because one
   * visitor action reaches several writers: a form submission that creates a
   * submission, a contact AND a lead must pay for the touch lookup once. A
   * door that hands none — every order path, every import — attributes
   * nothing, which is how a lead that no campaign caused stays uncredited.
   */
  touch?: ResolvedCampaignTouch | null
}): Promise<boolean> {
  const { hostRef, hostId, lead } = options
  const maxPerHost = options.ceiling ?? LEADS_MAX_PER_HOST
  try {
    const leadsRef = await orgLeadsForHost(hostId)
    const firestore = hostRef.firestore
    /*
     * `null` for anything that is not a usable address — a lead captured
     * against a malformed one keeps an auto-id and stays its own row. Keying
     * several unusable addresses under one guessed id would merge two
     * different people, which is worse than two rows for one.
     */
    const key = personKey(lead.email)
    /*
     * A lead the org has not taken over yet is carried across BEFORE the
     * transaction opens (AGL-3275). It has to happen outside: the carry is
     * itself a read-then-write, and a transaction that also counted the
     * collection would be reading a row it was about to create. Two doors
     * carrying the same person in the same second both write the legacy
     * fields under `merge`, so the race is a no-op rather than a conflict.
     */
    const leadRef = key
      ? (await leadForWrite(hostId, key)).ref
      : leadsRef.doc()
    /*
     * The scope this capture stamps, and the group whose terms its consent is
     * recorded under. Both resolved HERE rather than in the transaction body:
     * a contended transaction re-runs that body, and neither of these can
     * change between attempts, so resolving them inside would pay for the org
     * read again on every retry.
     */
    const scope = await leadScopeForHost(hostId)
    const group = await consentGroupForSite(hostId)
    const now = Date.now()
    const seen = {
      // `arrayUnion`, so a person who books twice has `['booking']` and one
      // who signed up and then submitted a form has both. Bounded by the
      // number of surfaces, not by the number of captures.
      sources: FieldValue.arrayUnion(lead.source),
      lastSeenAtMs: now,
      submissionCount: FieldValue.increment(1),
      ...(lead.name ? { name: lead.name } : {}),
    }
    let created = false
    const refused = await firestore.runTransaction(async (tx) => {
      // Reset per attempt: a contended transaction re-runs its body, and a
      // flag left standing from an aborted attempt would credit a campaign
      // with a person who turned out to exist already.
      created = false
      // ALL READS BEFORE THE WRITE, which Firestore requires.
      const existing = await tx.get(leadRef)
      /*
       * ⛔ THE CEILING GATES A NEW PERSON, NEVER AN EXISTING ONE.
       *
       * A returning visitor's capture is an UPDATE — it does not grow the
       * collection, so refusing it buys no capacity and costs the customer
       * the source and the timestamp they would have learned. That is the
       * enforcement-at-use shape the capacity rule exists to forbid: a limit
       * must refuse the addition, never a person already recorded or the
       * data attached to them.
       *
       * It also means the count is only paid on a genuinely new person,
       * which is the case that can move it.
       */
      if (!existing.exists) {
        /*
         * COUNTED OVER WHAT THIS SITE MAY SEE, not over the org (AGL-3275).
         *
         * The collection is org-wide now, and `LEADS_MAX_PER_HOST` is a
         * per-SITE ceiling. An unfiltered count would charge every brand in
         * an agency's account for every other brand's leads, and the first
         * client to fill its allowance would refuse captures on sites that
         * had taken none. `scopedToHost` is the same narrowing every other
         * org-owned read uses, so a single-site org counts exactly what it
         * counted before this moved.
         *
         * A lead shared by two brands in one consent group is counted by
         * both, which is the honest answer: each of them holds it.
         */
        const used = (
          await tx.get(scopedToHost(leadsRef, hostId).count())
        ).data().count
        if (checkVisitorRecordCeiling(used, maxPerHost).exceeded) return true
      }
      /*
       * Consent is carried forward and never cleared.
       *
       * A basis is written only when this capture carried an explicit
       * opt-in, so a later booking by someone who did not tick the box
       * leaves an earlier grant standing — absent-or-granted, the shape
       * every other writer uses. The TIMESTAMP is carried over rather than
       * restamped, for the reason given at the read below.
       */
      /*
       * The EARLIEST grant is the one that happened, so a later capture
       * carrying the same checkbox keeps the original date rather than
       * restamping when this person opted in. Read back through the shared
       * reader so "already consented" means the same thing here as it does
       * at send time.
       */
      /*
       * THE SITE'S REAL GROUP, because the silo that justified a group of one
       * is gone (AGL-3275).
       *
       * This read `soloConsentGroup(hostId)` for as long as a lead lived at
       * `hosts/{hostId}/leads`, and the reason was the path: private by
       * construction, so pooling a lead's basis would have recorded a
       * disclosure that reached nothing, while the contact written by the
       * same capture door was org-shared and pooled.
       *
       * A lead is now org-shared on exactly the terms the contact is, so the
       * premise is false and keeping the group of one would leave a
       * multi-brand org holding a lead its sibling brand can SEE but may not
       * MAIL — a narrower basis than the one `consentGroupDisclosure` named
       * beside the checkbox this person ticked. Pooling here records what
       * they were actually told; an undeclared group is still a group of one,
       * so an agency is unchanged and configures nothing.
       *
       * Resolved above the transaction — see `group`'s declaration.
       */
      const prior = readMarketingBasis(existing.data() ?? null, group)
      const consentAtMs =
        prior.basis === 'granted' && prior.basisAtMs !== null
          ? prior.basisAtMs
          : now
      created = !existing.exists
      tx.set(
        leadRef,
        {
          email: lead.email,
          ...seen,
          /*
           * WIDENED BY THE CAPTURE, NEVER BY THE LOOKUP (AGL-3275).
           *
           * `arrayUnion` rather than a replace, exactly as `upsert-contact`
           * stamps a contact: this site just collected this person, so it may
           * see the row. A site that merely FOUND them — the unscoped dedupe
           * lookup in `readLeadForHost` — gains nothing, which is what keeps
           * an agency's clients apart on a record they share.
           */
          visibleTo: FieldValue.arrayUnion(...scope),
          /*
           * EVERY SITE THAT CAPTURED THIS PERSON, not just the first
           * (AGL-3275).
           *
           * This was written once, on create, and that was sound while the
           * collection sat under one host and could hold only that host's
           * name. On the org the row is shared, so a sibling brand capturing
           * a person the first brand already holds has to be recorded here or
           * the "Known by" answer silently omits it — the same `arrayUnion`
           * the contact door has always used for this field, now that a lead
           * has the same question to answer.
           */
          [CAPTURED_BY_HOST_FIELD]: FieldValue.arrayUnion(hostId),
          ...(existing.exists
            ? {}
            : {
                firstSeenAtMs: now,
                createdAt: FieldValue.serverTimestamp(),
              }),
          /*
           * The basis is recorded under the GROUP, keyed by its host, because
           * {@link readMarketingBasis} is one function over four silos and a
           * silo whose basis lived somewhere else would need the reader to
           * know which collection it was handed. A reader that has to be told
           * the shape is a reader that can be told the wrong one.
           */
          ...(lead.marketingConsent
            ? marketingConsentFieldsForGroup(group, consentAtMs)
            : {}),
        },
        { merge: true },
      )
      return false
    })
    if (refused) {
      await recordVisitorRecordCeilingTrip({
        hostRef,
        hostId,
        kind: 'leads',
        ceiling: maxPerHost,
      })
      return false
    }
    /*
     * ATTRIBUTED ON CREATION ONLY.
     *
     * A returning visitor's capture is an update — the campaign did not
     * produce a lead, it produced another visit by a person the site already
     * held — and crediting it would let whichever campaign ran most recently
     * re-earn every lead on the list. `created` is set inside the transaction
     * that decides it, so the attribution and the write agree about whether
     * this person is new.
     *
     * Awaited rather than fired off: `addHostLead` already returns only after
     * its own write, and a caller that `void`s it (every one of them) is
     * unaffected. Never throws, so a failure here cannot cost the lead.
     */
    if (created && options.touch) {
      await attributeCampaignConversion({
        hostId,
        kind: 'lead',
        refId: leadRef.id,
        touch: options.touch,
        convertedAtMs: now,
      })
    }
    return true
  } catch (error) {
    // Same posture the three original call sites had (`.catch(() => undefined)`
    // / `.catch(console.error)`): a lead that failed to store must not fail
    // the sign-up or the booking that produced it.
    console.error('lead write failed', error)
    return false
  }
}
