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
  CAPTURED_BY_HOST_FIELD,
  checkContactQuota,
  consentGroupScope,
  CONTACT_FACETS_FIELD,
  type ContactInteraction,
  type ContactSource,
  marketingConsentFieldsForGroup,
  mergeContactInteraction,
  normalizeCampaignIds,
  readContactFacet,
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
  consentGroupForSite,
  getOrgForHost,
  orgDataCollectionForHost,
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
  /**
   * Explicit marketing opt-in (AGL-301) with a consent timestamp, recorded
   * against {@link hostId} — the brand whose form carried the checkbox.
   */
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
  /**
   * The campaigns the CAPTURE SURFACE is filed under.
   *
   * ⚠️ A different fact from {@link campaignTouch} beside it, and the two must
   * never be folded together. A touch is where the visitor came FROM — an ad,
   * a link, a browser-supplied label resolved through an allowlist. This is
   * which campaigns the merchant put the form itself in, which is the
   * merchant's own act and is true of everybody who fills that form in,
   * including the visitor who arrived by typing the address.
   *
   * ⛔ And it is not consent. Filing a form under a campaign says nothing
   * about what the person agreed to; `marketingConsent` above is the only
   * input that records a basis.
   */
  campaignIds?: readonly string[]
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
    // shared list.
    const contactsRef = await orgDataCollectionForHost(
      options.hostId,
      'contacts',
    )
    /*
     * The consent group this capture belongs to — the sites declared to be
     * one sender, or this site alone. Resolved once and used for three
     * different decisions below, which must all agree: which controller the
     * basis is recorded for, which sites the row becomes visible to, and
     * whether the capture surface had to disclose anything.
     */
    const group = await consentGroupForSite(options.hostId)
    const interaction: ContactInteraction = {
      type: options.source,
      atMs: options.interaction.atMs ?? Date.now(),
      // WHICH SITE this visit happened on. The row is shared; the history on
      // it is not, and a timeline with no site cannot be split for an
      // agency's client without showing them another client's activity.
      hostId: options.hostId,
      ...(options.interaction.refId
        ? { refId: options.interaction.refId }
        : {}),
      ...(options.interaction.summary
        ? { summary: options.interaction.summary.slice(0, 200) }
        : {}),
      // The entry point, when the door knows it. Written only when present:
      // an absent field is a door that has none, and Firestore rejects
      // `undefined` inside an array element outright.
      ...(options.interaction.formId
        ? { formId: String(options.interaction.formId).slice(0, 128) }
        : {}),
      ...(options.interaction.path
        ? { path: String(options.interaction.path).slice(0, 500) }
        : {}),
    }

    /*
     * THE CAMPAIGNS THIS CAPTURE FILES THE PERSON UNDER.
     *
     * Normalized here rather than trusted, because it reaches this function
     * from a public endpoint's document read and every reader of the stored
     * array goes through the same coercion.
     */
    const campaignIds = normalizeCampaignIds(options.campaignIds ?? [])

    /*==========================================
     * THE DEDUPE LOOKUP IS UNSCOPED, AND HAS TO BE.
     *
     * One human who touched two sites is ONE person. Narrowing this read to
     * what the capturing site may already see would make a second submission
     * on a sibling brand create a SECOND document for the same address —
     * which loses the dedupe the shared address book exists for, and bills
     * the org twice for one human.
     *
     * Recognizing somebody is not the same act as being allowed to read their
     * row, and the two were the same query while every contact was stamped
     * org-wide. They are separated here: this finds the person, and
     * `visibleTo` below decides who may see them — widened by the capture
     * that just happened, never by the lookup that found them.
     *=========================================*/
    const existing = await contactsRef
      .where('email', '==', email)
      .limit(1)
      .get()

    if (!existing.empty) {
      const docSnapshot = existing.docs[0]
      /*
       * MERGED INTO THIS GROUP'S FACET, not into the top of the document.
       *
       * `sources`, `interactions`, the tags, the notes and every commercial
       * figure are the HOLDER's own business records: a booking taken by one
       * client of an agency is that client's, and while these lived at the
       * top of a shared row every other client could read them. The identity
       * — the address, and a canonical name for a holder that has set none of
       * its own — stays shared, because that is what makes this one row.
       */
      const facet = readContactFacet(
        docSnapshot.data() as Record<string, unknown>,
        group.groupId,
      )
      const merged = mergeContactInteraction(
        {
          name: facet.name ?? undefined,
          sources: facet.sources,
          interactions: facet.interactions,
        },
        { source: options.source, interaction, name: options.name },
      )
      await docSnapshot.ref.set(
        {
          // The search keys travel WITH the name, and only when the name is
          // written: stamping an empty key over a real one would make the
          // contact unfindable by the name it still displays.
          ...(merged.name ? nameSearchFields(merged.name) : {}),
          /*
           * NESTED, not dot-pathed. This is a `set(…, { merge: true })`, and
           * a merge-set treats a key containing dots as a literal field name
           * — only `update()` reads them as paths. The nested form is what
           * Firestore deep-merges, so this writes one holder's facet and
           * leaves every other holder's untouched.
           */
          [CONTACT_FACETS_FIELD]: {
            [group.groupId]: {
              sources: merged.sources,
              interactions: merged.interactions,
              ...(merged.name ? { name: merged.name } : {}),
              /*
               * ADDED TO, never replaced. A person who filled in the spring
               * form and later the summer one is in both pushes, and an
               * assignment that overwrote would take a campaign a merchant
               * filed them under back out with nothing on screen to say so —
               * the reason `campaign-membership.ts` made the field an array
               * and the automation step has always used `arrayUnion`.
               *
               * Nested under the group id rather than written at
               * `contactCampaignFieldPath`, because this is a merge-`set`: a
               * `set` treats a dotted string as a literal field NAME and would
               * mint a top-level key with dots in it. Only `update()` reads
               * dots as a path. The nested form is what Firestore deep-merges,
               * so it reaches one holder's facet and leaves every other
               * holder's alone — the same guarantee the dotted path gives the
               * automation step, in the shape this write is allowed to take.
               */
              ...(campaignIds.length
                ? { campaignIds: FieldValue.arrayUnion(...campaignIds) }
                : {}),
              ...(options.purchaseCents
                ? {
                    ltvCents: FieldValue.increment(options.purchaseCents),
                    ordersCount: FieldValue.increment(1),
                    lastPurchaseAtMs: Date.now(),
                    // A contact that EXISTED before their first purchase
                    // reached this branch, and it never wrote
                    // `firstPurchaseAtMs` — only the create path did. So
                    // every converted lead permanently lacked RFM's R anchor
                    // while walk-in buyers carried it. Set it on the first
                    // purchase only; later purchases must not move it.
                    ...(facet.firstPurchaseAtMs
                      ? {}
                      : { firstPurchaseAtMs: Date.now() }),
                  }
                : {}),
            },
          },
          /*
           * ATTRIBUTION GROWS ON THE MERGE BRANCH, which the create-only
           * `hostId` beside it never did — so a person the first site
           * captured and the second site later met read as the first site's
           * alone, forever.
           *
           * `arrayUnion`, so the audience filter "everyone captured on A, B
           * or C" answers with the sites that actually met this person.
           */
          [CAPTURED_BY_HOST_FIELD]: FieldValue.arrayUnion(options.hostId),
          /*
           * AND SO DOES VISIBILITY — by the capture, never by the lookup.
           *
           * This site just collected this person: it has its own relationship
           * with them and may see the row. A site that has never captured
           * them gains nothing here, which is what keeps an agency's clients
           * apart on a document all of them share. The per-interaction
           * `hostId` above is what keeps the HISTORY apart on the same row.
           */
          visibleTo: FieldValue.arrayUnion(...consentGroupScope(group)),
          /*
           * RECORDED AGAINST THE CAPTURING SITE, not against the org.
           *
           * The contact document is shared by every site in the org, which is
           * the point of it — one address book behind many brands. Its
           * consent is not shared on the same terms: the checkbox this
           * capture carried was ticked under one brand's name, on one brand's
           * form, and a basis written at the top of this document made the
           * person mailable by every other brand the account holds.
           *
           * A merge writes one key of the map and leaves the rest, so a
           * person who opts in to a second site accumulates two grants rather
           * than replacing the first.
           */
          ...(options.marketingConsent
            ? marketingConsentFieldsForGroup(group, Date.now())
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
      /*
       * WHICH SITES HAVE MET THIS PERSON — attribution, and separate from
       * consent above.
       *
       * The scalar `hostId` beside it names the FIRST capturing site and is
       * never rewritten, which is provenance for the ROW. This array is the
       * one that grows and the one an audience query can filter on.
       */
      [CAPTURED_BY_HOST_FIELD]: [options.hostId],
      /*
       * THE CAPTURING GROUP, not the whole org.
       *
       * Stamping `['org']` here made every contact readable by every site in
       * the account on the day it was created — so an agency's twelve clients
       * shared one address book by default, and closing the missing-field
       * fail-open would not have touched it, because the field was present
       * and said so.
       *
       * A group of one — the default — is this site alone. A declared group
       * is the sites that already present as one sender. Widening beyond that
       * is available and is an ACT: an org may set `defaultResourceScope` to
       * `'org'`, or a later capture on a sibling site unions that site in.
       */
      visibleTo:
        (orgBilling?.org as { defaultResourceScope?: 'org' | 'host' } | null)
          ?.defaultResourceScope === 'org'
          ? [ORG_SCOPE_TOKEN]
          : consentGroupScope(group),
      email,
      ...(options.name ? nameSearchFields(options.name.slice(0, 120)) : {}),
      // The facet this capture creates. Everything a holder owns lives under
      // its own group id; the address and the canonical name above are the
      // only shared identity.
      [CONTACT_FACETS_FIELD]: {
        [group.groupId]: {
          sources: { [options.source]: true },
          interactions: [interaction],
          tags: [],
          // A create has nothing to union with, so the normalized list is the
          // whole membership.
          ...(campaignIds.length ? { campaignIds } : {}),
          ...(options.name
            ? { name: options.name.slice(0, 120) }
            : {}),
          ...(options.purchaseCents
            ? {
                ltvCents: options.purchaseCents,
                ordersCount: 1,
                lastPurchaseAtMs: Date.now(),
                firstPurchaseAtMs: Date.now(),
              }
            : {}),
        },
      },
      ...(options.marketingConsent
        ? marketingConsentFieldsForGroup(group, Date.now())
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
