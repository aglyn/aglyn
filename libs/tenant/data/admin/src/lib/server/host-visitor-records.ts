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
  soloConsentGroup,
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
    const leadsRef = hostRef.collection('leads')
    const firestore = hostRef.firestore
    /*
     * `null` for anything that is not a usable address — a lead captured
     * against a malformed one keeps an auto-id and stays its own row. Keying
     * several unusable addresses under one guessed id would merge two
     * different people, which is worse than two rows for one.
     */
    const key = personKey(lead.email)
    const leadRef = key ? leadsRef.doc(key) : leadsRef.doc()
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
        const used = (await tx.get(leadsRef.count())).data().count
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
       * THE GROUP OF ONE, and deliberately so on this silo.
       *
       * `hosts/{hostId}/leads` is private by path — no sibling site can sweep
       * it, declared group or not — so pooling a lead's basis would record a
       * disclosure that reaches nothing. The contact written by the same
       * capture door IS org-shared and IS pooled, which is where a declared
       * group's disclosure is honored.
       */
      const group = soloConsentGroup(hostId)
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
          ...(existing.exists
            ? {}
            : {
                firstSeenAtMs: now,
                createdAt: FieldValue.serverTimestamp(),
                [CAPTURED_BY_HOST_FIELD]: [hostId],
              }),
          /*
           * Recorded under THIS host even though the collection already sits
           * under it.
           *
           * A lead cannot be swept by another site — `hosts/{hostId}/leads`
           * is private by path — so the host key adds no enforcement here.
           * It is written anyway because {@link readMarketingBasis} is one
           * function over four silos, and a silo whose basis lived somewhere
           * else would need the reader to know which collection it was
           * handed. A reader that has to be told the shape is a reader that
           * can be told the wrong one.
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
