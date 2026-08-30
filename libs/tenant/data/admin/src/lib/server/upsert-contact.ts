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

import {
  checkContactQuota,
  type ContactInteraction,
  type ContactSource,
  mergeContactInteraction,
  normalizeContactEmail,
  ORG_SCOPE_TOKEN,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import { attributeOrderToEmail } from './email-revenue-attribution'
import {
  attributeCampaignConversion,
  type ResolvedCampaignTouch,
} from './campaign-conversion-attribution'
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  getOrgForHost,
  orgDataCollectionForHost,
  scopedToHost,
} from './organizations'

/**
 * Contacts ingestion (AGL-197): upserts an org-scoped contact doc (AGL-237)
 * keyed by normalized email from any capture point (forms, membership,
 * orders, bookings). Fire-and-forget by design — callers should never
 * fail their primary write because contact capture had a problem.
 *
 * Quota (AGL-890): contacts are audience BANDS, not hard caps. Paid plans
 * always create — contacts past the included band meter onto the monthly
 * invoice (report-usage cron). Free hard-bands at the included count:
 * only there do dropped creations increment `counters/contactsDropped`,
 * surfaced as a console alert (AGL-891). Interactions on existing
 * contacts always append regardless of plan.
 */
export async function upsertHostContact(options: {
  hostId: string
  email: unknown
  name?: string
  source: ContactSource
  interaction: Omit<ContactInteraction, 'type' | 'atMs'> & { atMs?: number }
  /** Explicit marketing opt-in (AGL-301) with a consent timestamp. */
  marketingConsent?: boolean
  /**
   * Order value in cents — rolls into RFM fields (AGL-328).
   *
   * WHAT IT COUNTS (AGL-1748). GROSS of the platform fee and GROSS of
   * refunds — the money the customer handed over, not the money the merchant
   * kept. Every writer passes the same thing: whatever was actually charged
   * (`amount_total` for a Stripe path, `totals.totalCents` for POS), never a
   * figure re-derived from product docs, which is the AGL-1698/AGL-1711
   * lesson. Gross of the fee because this is a CUSTOMER attribute answering
   * "what is this person worth to me?", and the fee is a cost of the channel,
   * not something the buyer failed to spend.
   *
   * Refunds are still NOT netted here, and now they are recorded elsewhere
   * (AGL-1754). `refund.ts` writes `refundedCents`, `refundedOrdersCount` and
   * `lastRefundAtMs` BESIDE these fields — the shape AGL-1747 chose for the
   * same question on the orders CSV — rather than decrementing a stored number
   * whose meaning would then differ between rows written before and after that
   * commit. So `ltvCents` and `ordersCount` remain gross by definition, and a
   * READER that wants the net computes `ltvCents - refundedCents`, clamping
   * only what it ranks on: the difference can be negative for a customer whose
   * pre-AGL-1748 purchase was never counted and whose refund was, which is a
   * missing purchase showing itself rather than a corrupt contact. AGL-1753 is
   * the backfill that reconciles it. See `contact-refund.ts` in the commerce
   * plugin for the full reasoning and for why a refund never CREATES a contact.
   *
   * Passing 0 or omitting it means "no purchase": `ltvCents`, `ordersCount`,
   * `lastPurchaseAtMs` and `firstPurchaseAtMs` are all left untouched, which
   * is why a caller that formats the amount into the interaction summary and
   * forgets this field records a customer who has apparently never bought
   * anything.
   */
  purchaseCents?: number
  /**
   * The currency {@link purchaseCents} is in, lowercase, when the door knows.
   *
   * Absent everywhere today, because no order document carries a currency and
   * every checkout door writes `currency: 'usd'` onto the Stripe line items.
   * `attributeOrderToEmail` defaults it on that basis and says so. The field
   * exists so a door that ever charges in something else can pass it, and the
   * campaign revenue report keeps it in its own bucket rather than adding it
   * to the dollars.
   */
  purchaseCurrency?: string
  /**
   * The campaign this person came from, already resolved by the door.
   *
   * ⛔ The ORDER path passes none, and must not start. An order already has
   * its own join one branch below — `attributeOrderToEmail`, keyed on the
   * order id — and a second record for the same sale would be the same money
   * counted twice under two rules. This is the door for the moments an order
   * does NOT cover: a form submission, a membership sign-up, a booking, a
   * newsletter capture.
   *
   * Resolved rather than raw, for the reason `addHostLead` states: one
   * visitor action reaches several writers and the touch lookup is paid once.
   */
  campaignTouch?: ResolvedCampaignTouch | null
}): Promise<void> {
  try {
    const email = normalizeContactEmail(options.email)
    if (!email) return

    /*==========================================
     * THE PURCHASE DOOR, AND THEREFORE THE ATTRIBUTION DOOR.
     *
     * Every way of buying something in this product — the cart, buy-now, the
     * POS register, a draft order, a reservation, a subscription renewal, a
     * booking — announces itself here, in exactly one shape: source `order`,
     * a `purchaseCents` amount, and a `refId` naming what was bought. That
     * shape IS the purchase chokepoint, which is why the revenue join hangs
     * off it rather than off seven call sites in a webhook.
     *
     * ABOVE the audience-band gate below, and deliberately. Contact creation
     * is band gated, so a Free org past its included count drops the CRM
     * record — and an attribution written inside that branch would drop the
     * revenue with it. The join keys on the address hash, exactly as the
     * touch and the suppression list do, so it never needs a contact document
     * to exist: a guest checkout by somebody who is not and never becomes a
     * contact still credits the campaign whose link they clicked.
     *
     * Its own `catch`, inside a function that already swallows: this is the
     * least important write on the path, and a failure here must not cost the
     * contact capture below it.
     *=========================================*/
    if (options.source === 'order' && options.interaction.refId) {
      await attributeOrderToEmail({
        hostId: options.hostId,
        orderId: String(options.interaction.refId),
        email,
        amountCents: Number(options.purchaseCents ?? 0),
        ...(options.purchaseCurrency
          ? { currency: options.purchaseCurrency }
          : {}),
        orderedAtMs: options.interaction.atMs ?? Date.now(),
      }).catch(() => null)
    }

    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(options.hostId)
    // Contacts are org-scoped (AGL-237): every host in the org feeds one
    // shared list; hostId is stamped per contact for provenance.
    const contactsRef = await orgDataCollectionForHost(
      options.hostId,
      'contacts',
    )
    // Reads narrow to what this host may see (AGL-1039); the collection
    // ref is still what writes and `count()` use.
    const visible = scopedToHost(contactsRef, options.hostId)
    const interaction: ContactInteraction = {
      type: options.source,
      atMs: options.interaction.atMs ?? Date.now(),
      ...(options.interaction.refId
        ? { refId: options.interaction.refId }
        : {}),
      ...(options.interaction.summary
        ? { summary: options.interaction.summary.slice(0, 200) }
        : {}),
    }

    const existing = await visible
      .where('email', '==', email)
      .limit(1)
      .get()

    if (!existing.empty) {
      const docSnapshot = existing.docs[0]
      const merged = mergeContactInteraction(
        {
          name: docSnapshot.get('name') ?? undefined,
          sources: docSnapshot.get('sources') ?? {},
          interactions: docSnapshot.get('interactions') ?? [],
        },
        { source: options.source, interaction, name: options.name },
      )
      await docSnapshot.ref.set(
        {
          // The search keys travel WITH the name, and only when the name is
          // written: stamping an empty key over a real one would make the
          // contact unfindable by the name it still displays.
          ...(merged.name ? nameSearchFields(merged.name) : {}),
          sources: merged.sources,
          interactions: merged.interactions,
          ...(options.marketingConsent
            ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
            : {}),
          ...(options.purchaseCents
            ? {
                ltvCents: FieldValue.increment(options.purchaseCents),
                ordersCount: FieldValue.increment(1),
                lastPurchaseAtMs: Date.now(),
                // A contact that EXISTED before their first purchase (form,
                // membership, booking capture) reached this branch, and this
                // branch never wrote `firstPurchaseAtMs` — only the create
                // path below did. So every converted lead permanently lacked
                // RFM's R anchor while walk-in buyers carried it. Set it on
                // the first purchase only; later purchases must not move it.
                ...(docSnapshot.get('firstPurchaseAtMs')
                  ? {}
                  : { firstPurchaseAtMs: Date.now() }),
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return
    }

    // New contact: audience-band check via the aggregate count (cheap; no
    // doc reads) against the owning org's entitlements (AGL-238/890).
    // Metered plans always pass (overage bills via the report-usage
    // cron); only free's hard band drops the CRM record — visibly, via
    // the counter and the console alert (AGL-891). The signup/order that
    // triggered the capture always succeeds either way.
    const orgBilling = await getOrgForHost(options.hostId)
    const count = (await contactsRef.count().get()).data().count
    const quota = checkContactQuota((orgBilling?.org as any) ?? null, count)
    if (!quota.allowed) {
      await hostRef
        .collection('counters')
        .doc('contactsDropped')
        .set({ total: FieldValue.increment(1) }, { merge: true })
      return
    }

    const created = await contactsRef.add({
      hostId: options.hostId,
      // Org-wide by default — today's behavior. Keeping the field
      // populated on every new contact is what lets the scoped reads
      // above work at all: `array-contains-any` matches nothing on a doc
      // that lacks it (AGL-1037).
      visibleTo: [ORG_SCOPE_TOKEN],
      email,
      ...(options.name ? nameSearchFields(options.name.slice(0, 120)) : {}),
      sources: { [options.source]: true },
      interactions: [interaction],
      tags: [],
      ...(options.marketingConsent
        ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
        : {}),
      ...(options.purchaseCents
        ? {
            ltvCents: options.purchaseCents,
            ordersCount: 1,
            lastPurchaseAtMs: Date.now(),
            firstPurchaseAtMs: Date.now(),
          }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    /*
     * ATTRIBUTED ON CREATION ONLY, and therefore below the band gate rather
     * than above it — the opposite placement to the order join at the top of
     * this function, deliberately.
     *
     * The order join sits above because it credits MONEY, which is real
     * whether or not a CRM record was kept for the buyer, and a Free org past
     * its included band would otherwise silently drop the revenue with the
     * contact. This credits a contact, which does not exist when the band
     * dropped it: attributing one above the gate would report a campaign as
     * having produced people the customer cannot see anywhere in the console.
     *
     * The existing-contact branch above returns without reaching here, which
     * is the same rule `addHostLead` applies — an interaction appended to
     * somebody the site already held is another visit, not a new person, and
     * crediting it would let the most recent campaign re-earn the whole list.
     */
    if (options.campaignTouch) {
      await attributeCampaignConversion({
        hostId: options.hostId,
        kind: 'contact',
        refId: created.id,
        touch: options.campaignTouch,
        convertedAtMs: interaction.atMs,
      })
    }
  } catch (error) {
    console.error('upsertHostContact failed', error)
  }
}
