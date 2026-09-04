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

import { FieldValue } from 'firebase-admin/firestore'
import {
  parseCampaignTouch,
  type CampaignTouch,
} from '@aglyn/aglyn/app-utils/campaign-touch'
/*
 * Stamped from the REVENUE join's constants, aliased at the import.
 *
 * They are spelled `EMAIL_` because that is where both halves of that join
 * could reach them, not because the window is an email fact — it is the
 * platform's one answer to how long a touch may be credited. Reading them
 * from there is what makes a lead's record and an order's record carry the
 * same rule rather than two that happen to agree.
 */
import {
  EMAIL_ATTRIBUTION_MODEL as ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS as ATTRIBUTION_WINDOW_DAYS,
  emailTouchIsInWindow,
} from '@aglyn/shared-util-email/email-revenue-window'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  CAMPAIGN_ATTRIBUTIONS_COLLECTION,
  eraseCampaignAttributionsForPersonKey,
} from './campaign-attribution-store'
import { readEmailCampaignTouch } from './email-delivery-log'
import { isDocumentId } from './document-id'
import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/**
 * THE IDENTIFY-MOMENT JOIN — a form, a lead, a contact or a booking, credited
 * to the campaign that led to it.
 *
 * ## Why there is a second join at all, and why it is not a second SCHEME
 *
 * `email-revenue-attribution.ts` credits an ORDER by looking the buyer's
 * address up in the touch map a click wrote. That works because an order
 * names its buyer. Every other outcome a campaign causes is produced by
 * somebody who was anonymous until the instant they produced it: they arrive
 * from a campaign link, browse, and only become identifiable when they submit
 * a form, sign up, book or check out. There is no address to look up until
 * the very moment being attributed.
 *
 * So the touch is carried on the VISITOR (`campaign-touch.ts`) and attached
 * here, at each moment they become somebody. What is NOT rebuilt is the
 * model: the same seven-day window, the same last-click rule, the same
 * `model`/`windowDays` stamped onto every record so a report can say what it
 * counted. The email channel is not re-derived either — it is READ from the
 * touch the delivery webhook already wrote, so a campaign email and a
 * campaign ad are two inputs to one comparison rather than two schemes with
 * two answers.
 *
 * ## Last touch, across both channels
 *
 * At the identify moment there can be two candidate touches:
 *
 *  - the WEB touch the visitor's device carried, from an ad, a partner link
 *    or a social post; and
 *  - the EMAIL touch on `emailDeliveries/{personKey}.campaignTouches[hostId]`,
 *    written server-side when they clicked a campaign's mail.
 *
 * Both are window-checked and the LATER one wins. Splitting the outcome
 * between them is the multi-touch model the revenue work rejected for the
 * reason that applies here unchanged: a rule the merchant did not choose
 * produces a figure nobody can check. One outcome, one campaign, and a rule
 * stated on the record.
 *
 * ## No campaign touch means NO RECORD
 *
 * Direct traffic writes nothing at all, and there is deliberately no fallback
 * — no "most recent campaign on this site", no referrer inference, no
 * `utm_source=direct`. A conversion nobody can be credited with is a
 * conversion nobody is credited with, and the absence of a record is how the
 * report says so. The cost of a miss is one uncounted outcome; the cost of a
 * guess is a campaign that reads as effective because it was the last one to
 * run.
 *
 * ## Three reads at most, and usually one
 *
 * Resolving a touch costs ONE keyed document read, and only when the visitor
 * gave an address — no query, no index, nothing that can be truncated. A door
 * resolves once per request and hands the result to every writer beneath it,
 * so a form submission that creates a submission, a contact and a lead pays
 * for the lookup once rather than three times.
 *
 * ## Never throws
 *
 * The same contract as the revenue join and for the same reason: the visitor
 * has already done the thing being attributed and the record of it is already
 * written. A lost attribution understates a campaign; a thrown one loses a
 * lead.
 */

/**
 * The collection and the erasure sweep, re-exported so a caller needs one
 * import for the whole join. They are DEFINED in a leaf module because the
 * sweep runs from `email-delivery-log.ts`, which this file reads — see
 * `campaign-attribution-store.ts` for why that cycle is not merely untidy.
 */
export {
  CAMPAIGN_ATTRIBUTIONS_COLLECTION,
  eraseCampaignAttributionsForPersonKey,
}

/** The single conversion rollup document under an email campaign. */
export const CAMPAIGN_CONVERSIONS_REPORT_DOC = 'conversions'

/**
 * Which identify moment a record credits.
 *
 * Kept apart rather than summed, which is the whole reason the kind is on the
 * record. One form submission by a new person creates a submission, a contact
 * and possibly a lead — three true statements about one visitor action — and
 * a report that added them would treble every campaign's conversions. A
 * reader asks for one kind at a time, exactly as the revenue rollup buckets
 * by currency and never totals across them.
 */
export type CampaignConversionKind = 'form' | 'lead' | 'contact' | 'booking'

/** Which channel the credited touch arrived through. */
export type CampaignTouchChannel = 'email' | 'web'

/** The touch a conversion is credited to, once both channels have been asked. */
export interface ResolvedCampaignTouch {
  channel: CampaignTouchChannel
  /** The campaign document, when the touch was a click on our own mail. */
  campaignId?: string
  /** `utm_source`, when the touch was a link on the web. */
  source?: string
  /** `utm_medium`, when the touch was a link on the web. */
  medium?: string
  /** `utm_campaign`, when the touch was a link on the web. */
  campaign?: string
  /** When the visitor followed the campaign link, epoch ms. */
  touchedAtMs: number
  /**
   * `sha256` of the normalized address the touch was resolved against, when
   * the visitor gave one. The handle an erasure erases by — see
   * {@link eraseCampaignAttributionsForPersonKey}.
   */
  personKey?: string
}

/** What one conversion attribution record holds. */
export interface CampaignConversionRecord extends ResolvedCampaignTouch {
  kind: CampaignConversionKind
  /** The submission, lead, contact or booking this credits. */
  refId: string
  /** When the visitor became identifiable. */
  convertedAtMs: number
  /** The model this credit was decided under. */
  model: string
  /** The window, in days, it was decided inside. */
  windowDays: number
}

/**
 * The document id for one conversion.
 *
 * `{kind}:{refId}`, so the same submission credited twice is the same
 * document — which is what makes {@link attributeCampaignConversion}'s
 * `create()` idempotent. Scoped by kind because the ids come from different
 * collections and a booking id has no reason to be distinct from a form
 * submission's.
 */
export function campaignConversionId(
  kind: CampaignConversionKind,
  refId: string,
): string {
  return `${kind}:${refId}`
}

/**
 * The campaign touch to credit a conversion happening now, or `null`.
 *
 * Called ONCE per conversion request, at the door, and the result handed to
 * every writer beneath it. See the module docblock for the cost argument.
 *
 * @returns the winning touch, or `null` when neither channel has one inside
 *          the window — which is the ordinary case and writes nothing.
 */
export async function resolveCampaignTouch(
  options: {
    hostId: string
    /**
     * The wire form the conversion request carried, when the door reports
     * one. Re-parsed through the allowlist that wrote it rather than trusted:
     * it arrives from the visitor's browser, so it may claim no more than an
     * inbound URL could.
     */
    wire?: unknown
    /** The address the visitor identified with, raw. */
    email?: unknown
    /** When they identified themselves. Defaults to now. */
    atMs?: number
  },
  firestore?: any,
): Promise<ResolvedCampaignTouch | null> {
  try {
    const hostId = String(options.hostId ?? '')
    if (!isDocumentId(hostId)) return null
    const convertedAtMs = Number(options.atMs ?? Date.now())
    if (!Number.isFinite(convertedAtMs) || convertedAtMs <= 0) return null

    // The window is enforced inside the parser, so an expired or
    // future-dated wire value answers null here exactly as it does in the
    // browser that decided whether to send it.
    const web: CampaignTouch | null = parseCampaignTouch(
      options.wire,
      convertedAtMs,
    )

    const key = personKey(options.email)
    /*
     * The email channel is only askable of somebody who named an address, and
     * that is the whole reason this join needs the web channel at all. No
     * address means no keyed read: the ordinary anonymous conversion costs
     * nothing here.
     */
    const emailTouch = key
      ? await readEmailCampaignTouch(
          String(options.email ?? ''),
          hostId,
          firestore ?? defaultFirestore(),
        )
      : null
    const emailInWindow =
      emailTouch &&
      isDocumentId(emailTouch.campaignId) &&
      emailTouchIsInWindow(emailTouch.clickedAtMs, convertedAtMs)
        ? emailTouch
        : null

    /*
     * LAST TOUCH decides, and a tie goes to email. A tie is only reachable
     * when the two instants are the same millisecond, and in that case the
     * email touch is the better evidence: it was recorded by the provider's
     * own click event on the server, while the web touch is a value the
     * visitor's device supplied.
     */
    const emailWins =
      emailInWindow && (!web || emailInWindow.clickedAtMs >= web.atMs)
    if (emailWins) {
      return {
        channel: 'email',
        campaignId: emailInWindow.campaignId,
        touchedAtMs: emailInWindow.clickedAtMs,
        ...(key ? { personKey: key } : {}),
      }
    }
    if (!web) return null
    return {
      channel: 'web',
      ...(web.source ? { source: web.source } : {}),
      ...(web.medium ? { medium: web.medium } : {}),
      ...(web.campaign ? { campaign: web.campaign } : {}),
      touchedAtMs: web.atMs,
      ...(key ? { personKey: key } : {}),
    }
  } catch (error) {
    console.error('resolveCampaignTouch failed', error)
    return null
  }
}

/**
 * Credits one conversion to the campaign the visitor last came from.
 *
 * ## Why the record is a document and not a field
 *
 * The revenue join's three reasons, and the first is decisive here too.
 * `create()` fails when the document already exists, which is exact
 * idempotency for free: a retried form POST, a redelivered booking webhook
 * and a re-run capture all land here a second time and must all leave the
 * rollup where they found it. Second, the four kinds live in four different
 * collections — a contact is org-scoped and shared across every site in the
 * org — so there is no one document a field could go on. Third, the
 * submission, the lead and the booking are read by the inbox, the export and
 * the fulfilment path, and none of them wants a field about marketing.
 *
 * ## The rollup exists for the EMAIL channel only
 *
 * A campaign document is a real entity with a real id, so its conversions
 * roll up under it beside the revenue the same join already credits it with.
 * A web campaign is a LABEL the marketer typed into a URL, with no document,
 * no id and no bound on how many distinct values exist — the same unbounded
 * key space the analytics collector caps its per-day label map against. A
 * rollup keyed on it would be a map anybody who can vary a query string can
 * grow. So the web channel's records stand on their own and a report reads
 * them; see the module's report seam note.
 *
 * @returns the record written, or `null` when nothing was credited.
 */
export async function attributeCampaignConversion(
  options: {
    hostId: string
    kind: CampaignConversionKind
    /** The submission, lead, contact or booking being credited. */
    refId: string
    /** The touch {@link resolveCampaignTouch} picked, or `null` for direct. */
    touch: ResolvedCampaignTouch | null | undefined
    /** When the visitor became identifiable. Defaults to now. */
    convertedAtMs?: number
  },
  firestore?: any,
): Promise<CampaignConversionRecord | null> {
  try {
    const { touch } = options
    if (!touch) return null
    const hostId = String(options.hostId ?? '')
    const refId = String(options.refId ?? '')
    if (!isDocumentId(hostId) || !isDocumentId(refId)) return null
    const convertedAtMs = Number(options.convertedAtMs ?? Date.now())
    if (!Number.isFinite(convertedAtMs) || convertedAtMs <= 0) return null
    // Re-checked at the write rather than trusted from the resolve. The two
    // are separated by the writes that produced the thing being credited, and
    // a touch that has aged out between them is a touch outside the window.
    if (!emailTouchIsInWindow(touch.touchedAtMs, convertedAtMs)) return null

    const record: CampaignConversionRecord = {
      kind: options.kind,
      refId,
      channel: touch.channel,
      ...(touch.campaignId ? { campaignId: touch.campaignId } : {}),
      ...(touch.source ? { source: touch.source } : {}),
      ...(touch.medium ? { medium: touch.medium } : {}),
      ...(touch.campaign ? { campaign: touch.campaign } : {}),
      touchedAtMs: touch.touchedAtMs,
      convertedAtMs,
      model: ATTRIBUTION_MODEL,
      windowDays: ATTRIBUTION_WINDOW_DAYS,
      ...(touch.personKey ? { personKey: touch.personKey } : {}),
    }

    const db = firestore ?? defaultFirestore()
    const hostRef = db.collection('hosts').doc(hostId)
    /*
     * `create()`, never `set()` — the revenue join's argument, unchanged. The
     * ALREADY_EXISTS failure IS the idempotency, and the rollup below is
     * reached only when the create succeeded, so the two can never disagree
     * about whether this conversion was counted.
     */
    try {
      await hostRef
        .collection(CAMPAIGN_ATTRIBUTIONS_COLLECTION)
        .doc(campaignConversionId(options.kind, refId))
        .create({ ...record, createdAt: FieldValue.serverTimestamp() })
    } catch {
      return null
    }

    if (touch.channel === 'email' && touch.campaignId) {
      /*
       * A merge-set that CREATES, for the reason `reports/revenue` gives: this
       * writes a document UNDER a campaign, so a campaign that no longer
       * exists gains an orphaned report rather than being resurrected as a
       * husk in the merchant's history — and the campaign was proven to exist
       * when its click wrote the touch.
       *
       * Every figure is an increment, so two conversions settling at once
       * both land.
       */
      await hostRef
        .collection('campaigns')
        .doc(touch.campaignId)
        .collection('reports')
        .doc(CAMPAIGN_CONVERSIONS_REPORT_DOC)
        .set(
          {
            model: ATTRIBUTION_MODEL,
            windowDays: ATTRIBUTION_WINDOW_DAYS,
            byKind: { [options.kind]: FieldValue.increment(1) },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
    }

    return record
  } catch (error) {
    console.error('attributeCampaignConversion failed', error)
    return null
  }
}
