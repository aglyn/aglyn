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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { memberNameSearchFields } from './member-name-search'
import {
  checkVisitorRecordCeiling,
  HOST_TOKENS,
  marketingConsentFieldsForHost,
  SITE_MEMBER_CEILING_CODE,
  SITE_MEMBER_UNAVAILABLE_MESSAGE,
  SITE_MEMBERS_MAX_PER_HOST,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  recordVisitorRecordCeilingTrip,
  resolveCampaignTouch,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import {
  hashMemberPassword,
  mintMemberSession,
  setMemberCookie,
} from './membership'
import { memberCredentialRef } from './member-credentials'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Site member sign-up (AGL-109): creates the member record and its credential
 * document (the scrypt hash, AGL-3308), doubles as a lead, and signs the
 * visitor in via the session cookie.
 */
export const membershipRegisterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '')
    .trim()
    .slice(0, 80)
  // Explicit opt-in checkbox (AGL-2499) — never inferred from signing up.
  const marketingConsent = req.body?.marketingConsent === true
  if (!hostId) return res.status(400).json({ error: 'Missing host' })
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    // Member accounts are UNLIMITED on every plan (AGL-889) — no seat or
    // quota check belongs here. Audience monetization happens downstream:
    // contact bands meter the CRM projection (AGL-890) and paid
    // memberships carry the plan's digital transaction fee (AGL-892).
    //
    // `SITE_MEMBERS_MAX_PER_HOST` below is NOT that check and does not make
    // it one (AGL-1529). It is a flat PLATFORM ceiling — same number on every
    // plan, no `OrgEntitlements` key, nothing on the price list — and it
    // exists because this handler is reachable by an ANONYMOUS VISITOR, so
    // without it the collection was bounded only by a per-(host, IP) rate
    // limiter that fails soft and bounds the RATE rather than the TOTAL. An
    // abuse control is not something we sell; "unlimited member accounts on
    // every plan" stays literally true.
    const membersRef = hostRef.collection('siteMembers')
    const memberRef = membersRef.doc()
    /*
     * COUNT, DEDUPE AND CREATE IN ONE TRANSACTION (AGL-1529, the AGL-2231
     * treatment).
     *
     * Read-then-decide-then-`set()` is the create-time quota that laundered
     * everywhere else in this repo: N concurrent sign-ups each read the same
     * pre-count, each find room, and each land — and nothing re-counts
     * afterwards, so the extra accounts are permanent. The fix is WHEN the
     * count is evaluated, not the counting rule.
     * `Transaction.get(AggregateQuery)` serialises the count against a
     * concurrent create into this collection: the loser retries, re-reads the
     * higher count and is refused. The duplicate-email read moves inside for
     * free, which also closes the smaller race it always had — two
     * simultaneous sign-ups on one address both saw `empty` and both wrote.
     *
     * ALL READS BEFORE THE WRITE, which Firestore requires.
     *
     * The scrypt hash sits between the last read and the create ON PURPOSE.
     * It is ~100 ms of CPU and it is the most expensive thing in the request,
     * so a refused sign-up must never pay it — hashing before the transaction
     * would hand a flood a CPU amplifier on exactly the path the ceiling
     * exists to contain, and would also be a regression, since today a
     * duplicate-email refusal does not hash either. It is a pure computation,
     * not an effect, so it does not violate the "nothing happens in a
     * transaction body" rule the sibling routes state.
     *
     * A refusal is returned as DATA and rendered outside: a body that can run
     * several times must not be the place a response is built.
     */
    const refusal = await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(membersRef.where('email', '==', email).limit(1))
      if (!existing.empty) return { duplicate: true, ceiling: 0 }
      const used = (await tx.get(membersRef.count())).data().count
      // Live documents only, so removing a member in the inbox frees the slot.
      const verdict = checkVisitorRecordCeiling(used, SITE_MEMBERS_MAX_PER_HOST)
      if (verdict.exceeded) return { duplicate: false, ceiling: verdict.ceiling }
      // The hash goes to the credential document, which no client can read
      // (AGL-3308), and in this transaction, so a member never exists without
      // the password they chose. The profile below is what the console lists.
      tx.set(memberCredentialRef(hostRef, memberRef.id), {
        passwordScrypt: hashMemberPassword(password),
      })
      tx.create(memberRef, {
        email,
        ...(displayName ? memberNameSearchFields(displayName) : {}),
        /*
         * The checkbox is PERSISTED on the member, not only forwarded.
         *
         * It reached the lead and the contact from the two lines below and
         * was dropped for this document, so `hosts/{hostId}/siteMembers` had
         * no consent field of any kind and `audience: 'members'` had nothing
         * for the send-time join to read — the audience could not be filtered
         * even in principle (`docs/specs/email-overhaul.md` §1d/§3f). The
         * other two documents are not a substitute: a member is deduped in
         * this transaction while leads append every time, and contacts are
         * ORG-scoped where a member is the site's own.
         *
         * Written only when ticked. Signing up is not opting in — that is why
         * the checkbox exists and why it defaults unchecked — so the omitted
         * case stores nothing and reads back as an unrecorded basis rather
         * than as a refusal.
         *
         * Under this site's key even though `siteMembers` already lives
         * beneath it, so that one reader answers for every silo — see
         * `addHostLead`, which makes the same write for the same reason.
         */
        ...(marketingConsent
          ? marketingConsentFieldsForHost(hostId, Date.now())
          : {}),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return null
    })
    if (refusal?.duplicate) {
      return res.status(409).json({ error: 'That email is already a member' })
    }
    if (refusal) {
      // Visible to the HOST — the rule that a control nobody can see in
      // the console did not ship. Durable counter + one notification.
      await recordVisitorRecordCeilingTrip({
        hostRef,
        hostId,
        kind: 'siteMembers',
        ceiling: refusal.ceiling,
      })
      // Opaque to the VISITOR, who is a stranger to this site and not our
      // customer (AGL-1666's rules, restated in the message's own docblock).
      // The one genuinely useful thing to hand them is a door that still
      // opens, so the site's OWN published support address rides along when
      // it has one — read through the host-token registry, whose description
      // of this field is literally "where visitors should write for help".
      // Nothing else off the host document may leave the console.
      const contact = HOST_TOKENS['supportEmail']?.resolve(
        hostSnapshot.data() as any,
      )
      return res.status(429).json({
        error: SITE_MEMBER_UNAVAILABLE_MESSAGE,
        // Machine-readable, because the dispatcher's rate limiter answers 429
        // too and the status therefore discriminates nothing.
        code: SITE_MEMBER_CEILING_CODE,
        ...(contact ? { contact } : {}),
      })
    }
    // Sign-ups double as leads for the site owner (AGL-109), through the one
    // writer that enforces `LEADS_MAX_PER_HOST` (AGL-1529). A refused lead
    // never fails the sign-up: the visitor asked for an account, not for a
    // lead record, and the trip is recorded for the owner either way.
    /*
     * THE CAMPAIGN TOUCH, RESOLVED ONCE FOR THE WHOLE SIGN-UP.
     *
     * A sign-up is the identify moment for a visitor who has been anonymous
     * until now, and it writes two records that a campaign can be credited
     * with — the lead and the contact. One resolve, one keyed read, and the
     * two cannot end up naming different campaigns.
     *
     * The MEMBER record itself is not attributed. A member is an account the
     * visitor holds and the lead is the site's record of the same act, so
     * crediting both would count one sign-up twice under two names.
     */
    const signedUpAtMs = Date.now()
    const campaignTouch = await resolveCampaignTouch({
      hostId,
      wire: req.body?.campaignTouch,
      email,
      atMs: signedUpAtMs,
    })
    /*
     * Contacts ingestion (AGL-197), reported to whichever plugin keeps people
     * rather than written by this one (AGL-3080). Commerce knows it just met
     * somebody; what a person record is belongs to the plugin that models it,
     * and a workspace that keeps none is a quiet, correct answer here.
     */
    /*
     * A member account is a RELATIONSHIP (AGL-3232): the person is a
     * contact from this moment, and an open lead the site held for the
     * address is closed as converted onto that contact by the record
     * system — a sign-up files no lead of its own any more, the way a
     * portal user is a contact and not a lead in Salesforce.
     */
    void recordCapturedContact({
      /*
       * Not resolved here. The record system keys a person on the SITE they
       * were met on, so this costs the capture nothing — and resolving it
       * would put a Firestore read in front of the writer, which is the one
       * thing `recordCapturedContact` asks a door not to do.
       */
      orgId: '',
      hostId,
      identity: { email, name: displayName || undefined },
      interaction: {
        source: 'member',
        refId: memberRef.id,
        summary: 'Joined as a member',
      },
      surface: 'relationship',
      // An account is a subscription to the site, not an enquiry (AGL-2612):
      // the stage on the contact says only that the person asked to be
      // kept. A floor, so a customer who opens an account stays a customer.
      lifecycleFloor: 'subscriber',
      ...(marketingConsent ? { marketingConsent: true } : {}),
      // Where the visitor ARRIVED from — a fact about this visit and not
      // about the person, which is what `detail` carries.
      ...(campaignTouch ? { detail: { campaignTouch } } : {}),
    })
    // Event trigger (AGL-128/148). A sign-up is no longer a lead (AGL-3232),
    // so the `lead` event is the lead surfaces' to emit.
    await emitHostEvent(hostId, 'memberSignUp', { email })
    setMemberCookie(res, hostId, mintMemberSession(hostId, memberRef.id))
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Sign-up failed' })
  }
}
