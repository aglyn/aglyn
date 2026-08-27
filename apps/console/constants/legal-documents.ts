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
 * TO PUBLISH A CHANGE, BEFORE LAUNCH: publish first, re-capture from the live
 * page, and update the hashes here — LEAVING `LEGAL_DOCUMENT_VERSION` AT `v1`.
 * No v2 exists until Aglyn has released. See the 2026-08-24 entry in the
 * changelog below for the full reasoning; the short form is that a version can
 * only supersede a version somebody accepted, and nobody has.
 * Archive the re-captured bytes over `Acceptance-Snapshots/v1/<key>.txt` in
 * the same pass — the archive is resolved by the CURRENT version folder, so a
 * moved hash and an unmoved archive is the one combination that breaks.
 *
 * AFTER LAUNCH: bump `LEGAL_DOCUMENT_VERSION`, archive the new capture under
 * the new version folder in Drive, and update the hashes here together. You
 * cannot quietly skip that step — `npm run check:legal-snapshots` fetches the
 * archived text for whatever version this constant names, re-hashes it, and
 * fails if it disagrees, so a version can never come to mean two different
 * documents once one has been agreed to.
 *
 * ⚠️ Neither path adds `constants/legal/v2/`. The snapshot TEXT left this repo
 * on 2026-08-20 and lives in the shared drive at
 * `Platform Docs/Legal/Acceptance-Snapshots/<version>/`; only the hash stays
 * here. And `specs/legal-document-version.spec.ts` no longer re-hashes
 * anything — it asserts the manifest's SHAPE, offline. The content check is
 * `check:legal-snapshots`, which needs Drive credentials and runs in CI.
 */

import { LEGAL_URLS } from './shared'

export const LEGAL_DOCUMENT_VERSION = 'v1'

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
 * individuals starting a business — are an intended ICP, so §7 correctly
 * describes the market. Deleting "or personal" to scope the beta to business
 * use would misdescribe who Aglyn sells to, and it buys nothing: Texas DTPA
 * §17.45(4) counts businesses under $25M
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
 * §11 MATCHES THE IMPLEMENTATION as of the AGL-1592 correction below — the
 * earlier "narrower than the implementation, fix it in v5" note is GONE, not
 * merely superseded: the narrower wording was never deliberate. §11 now states
 * the suppression carve-out outright ("we will delete it from your account and
 * keep it only on a limited internal do-not-contact list, used for nothing
 * else"), because a number we cannot recognise is a number we will dial the
 * next time it reaches us. The carve-out is standard (CCPA §1798.105(d); the
 * TSR's entity-specific do-not-call duty is unmeetable without a retained
 * list). Do NOT "fix" this by making the code forget the number: that reads as
 * compliance and produces the call the person asked to prevent.
 *
 * v4 CORRECTIONS published 2026-08-14 (AGL-1594 + AGL-1592), folded into the
 * SAME v4 snapshot rather than a v5, because v4 was still unpromoted and a bump
 * would force every user to re-accept for a copy fix:
 *
 *   - AGL-1594, Privacy §3: the "Sale"/"sharing" paragraph claimed "no
 *     advertising technology and no third-party analytics on our websites or
 *     the console". GA4 (G-YW5PG16YTM) has run on app.aglyn.com since AGL-118
 *     and on aglyn.com since AGL-1559, so half that sentence was false — and
 *     §4 of the same document already disclosed analytics, contradicting it.
 *     The no-adtech half is true and load-bearing, so it stays; the analytics
 *     half is replaced by the actual configuration (Signals off, ads
 *     personalization off in every region, no Ads link, 14-month retention)
 *     plus the conclusion that analytics configured this way is neither a
 *     "sale" nor a "share". The Cookie Policy carried the same defect and was
 *     corrected in the same pass — it is besigner-only, has never been
 *     clickwrapped, and is NOT snapshotted here, so it has no hash to update.
 *   - AGL-1592, Privacy §11: the do-not-contact carve-out described above.
 *
 * Both edits are AUTHORED-SOURCE changes to the besigner markdown block and
 * were published FIRST, then re-captured. That ordering is not a preference: a
 * snapshot is evidence of what a user was actually shown, so hand-writing one
 * for text that is not live would be a false record of the same shape as the
 * defect being fixed. The live page was confirmed serving the new text (Flight
 * row 16:T3430, = 13360 bytes, matching the published source byte-for-byte)
 * before this hash moved. terms.txt is UNCHANGED by this pass.
 *
 * Both documents also move their "Last updated" date to August 14, 2026, which
 * is the mechanism ToS §5.3 and Privacy §12 name for a change taking effect.
 * Same capture method as v1–v3, proven against the v3 hashes before this set
 * was taken.
 *
 * v5 (2026-08-18, AGL-1794 + AGL-1860): again one snapshot cycle for two
 * changes, for the same reason v4 was.
 *
 *   - AGL-1794, Terms §10: a new §10.6 "Chargebacks and Payment Disputes"
 *     AND a rewrite of §10.1 and §10.2. The new clause makes the transfer
 *     reversal contractual — a lost dispute is recovered from the merchant's
 *     SHARE (the implemented proportional maths, not the gross charge), a
 *     reversal may take the connected balance below zero, and the two caps
 *     already true in code (never more than the merchant received, never
 *     twice for one purchase) become merchant protections rather than
 *     implementation details. Aglyn keeps bearing the processor's dispute fee
 *     and does not recharge the platform transaction fee on a reversed sale,
 *     with headroom to change that under **§4.7** — the fee-change right.
 *     NOT §5.1, which is the right to change the SERVICES; an earlier draft
 *     anchored a money term to a features clause and it was caught on review.
 *
 *     §10.1/§10.2 are the correction that clause made unavoidable. Live §10.1
 *     said "you — not Aglyn — are the merchant of record" and §10.2 said
 *     "Aglyn does not process, hold, or disburse your sales proceeds". Both
 *     are false: every storefront checkout is a DESTINATION CHARGE on the
 *     platform account with no `on_behalf_of` (`cart-checkout.ts`,
 *     `checkout.ts` one-time and subscription, `draft-order.ts`, `reserve.ts`,
 *     `pos-order.ts`), so Aglyn's account is the settlement account and
 *     Aglyn's balance is what a dispute debits. §10.1 is now "You Are the
 *     Seller" and drops `marketplace` from its feature list, pointing
 *     marketplace sales at the Marketplace Publisher Agreement — live §10.1
 *     had been flatly contradicting MPA §8.1/§8.3 on the same charge model.
 *     §10.2 is now "How Payments Are Processed and Paid Out" and describes the
 *     real flow, including that a refund gives back Aglyn's platform fee
 *     (`refund.ts`'s `refund_application_fee: 'true'`), which was disclosed
 *     nowhere.
 *
 *     ⚠️ The rewrite deliberately states the MECHANICS and NO LABEL: it does
 *     not assert who the merchant of record is for storefront sales. Declaring
 *     it drags the marketplace-facilitator sales-tax question with it, and
 *     nobody has decided that. §10.3's "collection and remittance of all
 *     applicable taxes" is UNTOUCHED for the same reason — changing it would
 *     be a tax allocation between Aglyn and its customers, which is the most
 *     dangerous edit available here. Both are recorded as open counsel
 *     questions on AGL-1794, not as oversights.
 *
 *     ⚠️ NO LONGER CURRENT GUIDANCE (AGL-1956, 2026-08-24) — left standing as
 *     the record of what the 2026-08-18 publish decided, not as advice. The
 *     question this paragraph declined to answer has since been answered:
 *     Aglyn accepts marketplace-facilitator status, §10.3 changed, and the new
 *     §10.7 states the allocation. That correction was folded into `v1` rather
 *     than cut as a `v2` (see the 2026-08-24 entry below), so there is no
 *     version boundary here to look for — the label did not move and the text
 *     did. Do not read this paragraph as current guidance to leave §10.3
 *     alone.
 *
 *     Also in the same publish: §2's Services definition and §12.3 now say
 *     "the Aglyn marketplace" (AGL-975), because a fresh snapshot carrying the
 *     old adjective would red the naming guard on a file that has no
 *     exemption and cannot be given one.
 *
 *   - AGL-1860, Privacy §2 and §5: the Aglyn Assist disclosure, which is that
 *     feature's legal precondition. §2's `**AI features.**` paragraph now
 *     names Anthropic as the provider ("currently", not "e.g." — the
 *     subprocessor register is exhaustive now, so "e.g." reads as an
 *     undisclosed set), names Assist, and encodes the confirm-before-write
 *     guardrail. A second paragraph discloses what an Assist exchange retains
 *     — question, answer, console page, token count, thumbs rating — that it
 *     is org-scoped and accessible to staff, and enumerates three purposes
 *     including METERING, because per-org cost telemetry exists purely for
 *     billing and a policy silent about it would be silent about the one
 *     field that does. §5 adds the retention sentence, published in the strong
 *     form only because it was verified against landed code: all three Assist
 *     collections are true subcollections of `orgs/{orgId}` and `eraseOrg`'s
 *     `recursiveDelete(orgRef)` reaches them. No new deletion mechanism was
 *     invented — §5 routes to the §7 that already exists, which is the
 *     AGL-1592 lesson.
 *
 * Same publication-first ordering as every prior set: the besigner edits were
 * published, the live pages confirmed serving them, and only then were these
 * snapshots captured. The capture method was re-proven byte-for-byte against
 * the v4 terms + privacy pins AND the `2026-08-14.1` publisher-agreement pin
 * before this set was taken.
 *
 * v6 (2026-08-18, AGL-1987 + AGL-1992): a CORRECTION OF PUBLISHED TEXT, taken
 * the same day v5 published. Both documents were wrong on the live page, in
 * opposite directions, and both errors were about a number.
 *
 *   - AGL-1987, Terms §10.6 and §10.2: the lost-dispute clawback is GROSS, and
 *     v5 published the opposite. ⚠️ THE v5 NOTE ABOVE IS ITSELF WRONG and is
 *     left standing as the record of what shipped: it says a lost dispute is
 *     recovered from the merchant's "SHARE (the implemented proportional
 *     maths, not the gross charge)" and that Aglyn "does not recharge the
 *     platform transaction fee on a reversed sale". Neither is what the code
 *     does. Stripe transfers the FULL charge to the connected account and
 *     debits `application_fee_amount` at the DESTINATION, so `transfer.amount`
 *     equals `charge.amount`, the proportional share is the WHOLE principal,
 *     and the merchant hands back the gross while Aglyn keeps its commission.
 *     The asymmetry is deliberate: `refund.ts` sends
 *     `refund_application_fee: 'true'`, the dispute door sends no such flag.
 *
 *     THREE sentences were defective, not the one AGL-1987 quotes, and the
 *     third is the one a careless correction leaves behind:
 *       1. "the portion of the disputed amount that was transferred or payable
 *          to you" — reads as the merchant's net share.
 *       2. "does not recharge you the platform transaction fee (Section 4.3)
 *          on a reversed sale" — flatly false; the clause AGL-1987 was filed
 *          for.
 *       3. "We will not recover from you more than the amount you received for
 *          the sale" — A CAP THE CODE BREAKS AS READ. The merchant's economic
 *          receipt is $95 and the reversal takes $100. Deleting only (2) would
 *          have left a cap contradicting the corrected opening.
 *     §10.2's "recover YOUR SHARE of a refunded, disputed, or otherwise
 *     reversed sale" was corrected in the same pass for the same reason — not
 *     false, but it re-created the ambiguity one subsection earlier. §10.2's
 *     refund-door sentence ("we give back our platform transaction fee on the
 *     refunded amount") is UNTOUCHED and correct.
 *
 *     ⚠️ The clause says "platform transaction fee (Section 4.3)", NOT
 *     "commission", though AGL-1987 named "commission" as must-survive. The
 *     Terms define the fee at §4.3 and have never used "commission"; an
 *     undefined synonym for a defined money term is how a dispute over which
 *     one governs starts. The defined term wins; see the issue for the record.
 *
 *     ⚠️ NOT ESTABLISHED, and it is a real limitation: no Stripe dispute has
 *     been exercised end to end. `transfer.amount === charge.amount` is
 *     measured in TEST MODE only. The behaviour is pinned by two guards proven
 *     red on purpose (`33b391969`, which is comment-and-guard only — it
 *     changed no behaviour, so gross is what has always shipped), and
 *     `docs.aglyn.com` already states the split publicly. If a real dispute
 *     behaves differently this clause changes and costs another bump.
 *
 *   - AGL-1992, Privacy §5 and §2: AGL-1972 gave Assist conversations a
 *     180-day TTL (`ASSIST_EXCHANGE_RETENTION_DAYS`, verified on `origin/main`
 *     at capture time, not read from a plan), which made v5's "retained for as
 *     long as your Organization exists" false the day after it published. §5
 *     now describes the SPLIT, because that is what makes the short period
 *     honest rather than a loss: `assistExchanges` (question, answer, uid —
 *     180 days) versus `assistSignals` (docs paths, model, cost, rating — no
 *     prose, NO uid — life of the Organization). §2's "Retention and deletion
 *     follow the same rules as the rest of your Organization's data" became
 *     the opposite of true and is neutralised to "are described in Section 5"
 *     rather than restating the number twice — two copies of a number is how
 *     the register drifted before.
 *
 *     The error ran in the customer's favour (we delete SOONER than promised)
 *     and nothing diverges in fact for 180 days — the gcloud TTL policy is
 *     declared and OWED, not enabled (`docs/FIRESTORE_MANUAL_CONFIG.md`), so
 *     no exchange has been deleted. That window is why this was correctable
 *     rather than urgent, and it is not an argument for leaving it.
 *
 * One bump for both documents, as v4 and v5 were, because every bump re-pins
 * clickwrap and forces re-acceptance — and this is the SECOND re-consent in
 * one day. AGL-1990's DPA and Subprocessors edits published in the same sitting
 * and are deliberately NOT here: neither page is acceptance-pinned, so they
 * cost no bump and have no hash.
 *
 * Publication-first as always: the bytes come from the PAGE, never from a
 * hand-written file.
 *
 * v1 CORRECTIONS published 2026-08-24 (AGL-1956), folded into the SAME v1
 * snapshot rather than cut as a v2 — the same call as the v4 corrections
 * above, resting on the same fact that collapsed the whole ladder back to `v1`
 * on 2026-08-20: production holds ZERO acceptance records. Aglyn has not
 * launched. There is no accepted v1 for a v2 to supersede, so a v2 would
 * assert a version history that never happened, and the re-acceptance
 * interstitial it forces would be shown for a document nobody has ever
 * accepted. `v1` is not a claim that the text never changed — it is a claim
 *
 * ⚠️ THE HASHES BELOW MOVED WITHOUT THE LABEL, and that is what "updated in
 * the v1" MEANS. `v1` must pin the text that is actually live. Holding the
 * label while leaving the old hashes standing would be the worse bug of the
 * two — v1 would name text that no longer exists, and the clickwrap record
 * would break in the opposite direction, claiming reproducibility for bytes
 * nobody can produce. terms is re-pinned at 39042 bytes / `0fba3a…`, captured
 * from the live page after publication. The archived
 * `Acceptance-Snapshots/v1/terms.txt` was replaced with the same bytes in the
 * same pass, because `check:legal-snapshots` resolves the archive by the
 * CURRENT version folder and would otherwise be comparing this hash against
 * the superseded 36704-byte capture.
 *
 * ⚑ THE FIRST GENUINE BUMP HAPPENS AFTER LAUNCH, and this entry is not a
 * precedent for one before then. The moment a single real acceptance exists
 * the reasoning inverts: from then on any change to a pinned document costs a
 * bump, because there is finally a version somebody agreed to and a superseded
 * snapshot that has to stay resolvable out of history. If you are reading this
 * later and wondering why a substantive Terms change — a tax allocation
 * between Aglyn and its customers, no less — carries no version bump: that is
 * why, and the answer expires at the first acceptance.
 *
 * WHAT THE 2026-08-24 PUBLISH CHANGED: Aglyn ACCEPTS marketplace-facilitator
 * status for US sales tax, and the Terms are aligned to it.
 * This is the decision the v5 note above recorded as deliberately unmade — the
 * ⚠️ paragraph saying §10.3 was "UNTOUCHED for the same reason" no longer
 * states current policy: changing it was correctly identified there as "a tax
 * allocation between Aglyn and its customers", and that allocation has now
 * been made.
 *
 *   - NEW §10.7 "Sales Tax": Aglyn acts as a marketplace facilitator (a
 *     marketplace provider, in Texas's wording) and, WHERE IT HAS AN
 *     OBLIGATION UNDER THAT LAW, calculates, collects and remits sales, use
 *     and similar transaction taxes; tax is added on top of the price, never
 *     transferred to the connected account, and the merchant's share and the
 *     platform fee are both computed on the pre-tax price. The scope sentence
 *     is load-bearing and deliberately narrow — the clause creates no
 *     obligation in a jurisdiction or for a transaction where Aglyn is not a
 *     facilitator with a collection obligation. It does NOT promise universal
 *     collection, because Aglyn cannot deliver that.
 *   - §10.3 no longer says the merchant owes "the collection and remittance of
 *     all applicable taxes"; it routes to §10.7. That sentence was the outlier:
 *     MPA §8.1/§8.3 have said Aglyn is merchant of record and remits the tax on
 *     the identical destination-charge shape since 2026-08-14, so the Terms
 *     were contradicting the publisher agreement, and — after the AGL-1794
 *     rewrite — contradicting §10.2 two paragraphs earlier.
 *   - THE ECHOES MOVED WITH IT, which is most of the work: §4.3 dropped "taxes"
 *     from the merchant's solely-responsible list; §4.5 was conflating tax on
 *     the customer's PURCHASE OF AGLYN (still theirs) with tax on their OWN
 *     SALES (now §10.7's) in one sentence and now splits them; §10.5's
 *     no-liability sentence carves out Aglyn's own §10.7 obligation. The
 *     Acceptable Use Policy's parallel bullet moved in the same publish — it is
 *     not hash-pinned, so it costs no bump and has no hash here.
 *   - §18.7's limitation period goes from one (1) year to two (2) years. A
 *     one-year contractual deadline contradicted §19.12, which promises no
 *     Texas DTPA right is waived while the DTPA carries a two-year statute
 *     (Tex. Bus. & Com. Code §17.565). The clause now also yields to any longer
 *     non-shortenable statutory period and says outright that it does not
 *     shorten a consumer-protection limitations period.
 *   - §18.2 and §18.6 venue: Williamson County -> TRAVIS County. Williamson
 *     entered from a former residential address; every published Aglyn address
 *     is 5900 Balcones Dr STE 100, Austin, TX 78731, which is Travis. AGL-1917
 *     carried a checklist line asking whether Williamson was intended: it was
 *     not. The same correction landed in MPA §13.3 and the internal
 *     Legal/README index, so no straggler contradicts the corrected clause.
 *
 * §18 is otherwise UNTOUCHED and must stay that way: AAA Consumer Clause
 * Registry registration is DEFERRED on cost, and the
 * decision was explicitly to keep naming AAA and to keep both the consumer
 * arbitration clause and the class-action waiver. What changed in §18 are
 * defects that are wrong on their own merits, not the structure.
 *
 * ⚠️ NO DTPA WAIVER EXISTS ANYWHERE and none was added. AGL-1917 flags a
 * §17.42 waiver as possibly unenforceable against clickwrap consumers; that
 * waiver was already REMOVED in the v4 pass (AGL-1565), and §19.12 today
 * affirmatively disclaims any such waiver. The checklist item is stale, not
 * outstanding — verified by grepping all nine published legal documents.
 *
 * Re-acceptance: NONE is forced, and none is owed. The console still answers
 * "We have no record of your acceptance on this account" for every account it
 * is asked about — the shape of a pre-release product with an empty clickwrap
 * collection — so the interstitial a bump would raise has nobody to raise
 * itself for. Privacy is UNCHANGED by this pass and served as the capture
 * control, reproducing 15286 bytes / 42ea82… byte-for-byte before this set was
 * taken.
 *
 * ## ONE snapshot in the tree, and why that is enough
 *
 * Only the CURRENT version is checked out. Superseded text is not deleted —
 * it was committed, so it lives in git history forever and comes back with
 * `git show <sha>:apps/console/constants/legal/v1/privacy.txt`. Keeping old
 * versions in the working tree as well is pure redundancy, and it is what made
 * the folder list grow without bound (v1…v7 accumulated in eight days).
 *
 * Collapsed back to `v1` on 2026-08-20 because production held ZERO
 * acceptance records: every version between was pre-launch churn pinning text
 * nobody had ever agreed to, so none of it was evidence of anything. Once a
 * real acceptance exists this stops being true — from then on a bump is
 * required for any change, and the superseded snapshot's value is that the
 * recorded `sha256` can still be resolved out of history.
 *
 * That is why the changelog above runs v1…v6 and then reads `v1` again for
 * 2026-08-24: the numbered entries are the pre-collapse ladder, kept as the
 * publication history of the TEXT, while the live label has been `v1` since
 * 2026-08-20 and stays `v1` until launch. A dated entry with no new number is
 * the collapse working, not a missing bump.
 *
 * ## What the .txt is FOR, since it is not for reading
 *
 * Nobody is ever shown one. `LEGAL_URLS` points every human at the published
 * pages; no runtime code reads these files and only specs do. They exist so
 * that "you accepted v1, sha 42ea82…" is REPRODUCIBLE — a URL alone proves
 * nothing, because the page changes (this one changed three times on the day
 * it was written). Storing the full text on each acceptance row would be
 * gigabytes at scale; a 64-byte hash plus one archived copy is kilobytes.
 *
 * ## The capture
 *
 * A DOM text-node walk, sliced from `Last updated:` to just BEFORE the closing
 * `©` line. NOT `canonicalizeLegal` — that breaks on block elements and joins
 * inline runs, which yields the same words with different line boundaries and
 * therefore a different sha. Prove the method on an UNCHANGED pinned document
 * before trusting a new pin.
 *
 * ⚠️ The control ROTATES — it is whichever pinned document this pass did not
 * touch, never a fixed name. On the pass that first wrote this paragraph terms
 * was untouched and served as the control at 35966 bytes; on 2026-08-22 terms
 * itself changed (§12.1 and §12.2 gained the Apache-2.0 sentences, AGL-2484)
 * and PRIVACY was the control, reproducing 15286 bytes / `42ea82…`
 * byte-for-byte both before and after publication. Naming terms permanently
 * here would have pointed the next capture at the one document it cannot
 * prove anything with.
 *
 * ⚠️ The slice boundary is NOT uniform across the codebase. This manifest
 * EXCLUDES the closing `©` line; the parallel publisher-agreement pin in
 * `libs/aglyn/src/lib/app-utils/publisher-agreement.ts` INCLUDES it, as its
 * own docstring says. Two conventions, both load-bearing, both verified
 * against their live pages — read the target's docstring before capturing,
 * because either method produces a plausible file under the other's rule.
 */
export const LEGAL_DOCUMENTS: LegalDocumentManifestEntry[] = [
  {
    key: 'terms',
    url: LEGAL_URLS.TERMS,
    sha256:
      '0fba3a5fbc9305bf7501b0c1774c743588acb08c363f80509480bd824f38b795',
    bytes: 39042,
  },
  {
    key: 'privacy',
    url: LEGAL_URLS.PRIVACY,
    sha256:
      '42ea82d50df140c03eafeeacce65376b8dd5b5cb3f230aedb13b2e344f216cba',
    bytes: 15286,
  },
]
