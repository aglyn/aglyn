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
import { EMAIL_DELIVERIES_COLLECTION } from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { emailSuppressionKey } from '@aglyn/tenant-data-admin/server/email-suppression'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/*==========================================
 * THE CAMPAIGN TOUCH — which campaign this person last CLICKED, per site.
 *
 * The delivery log's engagement rollup (`email-delivery-log.ts`) answers "is
 * this person still listening". It cannot answer "which email brought them
 * here", because it keeps instants and not identities, and that second
 * question is what attribution is: an order or a sign-up arrives, and
 * something has to say which campaign preceded it.
 *
 * ## On the person's own delivery document
 *
 * The alternative was a per-host collection of touch documents, and it fails
 * on erasure: an erasure arrives as an ADDRESS and knows nothing about which
 * sites have mailed it, so a per-host collection would be a record of a
 * person's clicks that an erasure request could not reach. On the person's
 * document in the platform's delivery log (`emailDeliveries/{key}`) it is
 * one field, keyed by the same hash every suppression list uses. The
 * platform's address erasure asks this plugin to forget the person through
 * the conversion-credit contract (`plugin-conversion-credit.ts`), and
 * {@link eraseEmailCampaignTouches} deletes the field — a click is the same
 * personal fact as the open recorded next to it.
 *
 * ## A CLICK ONLY
 *
 * The delivery log's `ENGAGEMENT_TYPES` include opens because the control
 * they feed REFUSES to mail people, and the generous signal is the correct
 * one for a refusal. This is the opposite kind of decision — it CREDITS a
 * campaign with money — so it takes the strict signal. Since Apple's Mail Privacy Protection an open is
 * substantially a statement about the recipient's mail client, and crediting
 * revenue to one would credit whichever campaign most recently reached an
 * Apple Mail user with orders from people who never read it.
 *
 * ## Per host, and capped
 *
 * A single global touch would credit site A's campaign with site B's order,
 * or refuse both — the send path refuses cross-site reach and the revenue
 * join has to agree with it. So the field is a map keyed by host, and a map
 * on a document has to be bounded: past {@link EMAIL_TOUCH_MAX_HOSTS} the
 * oldest touch is evicted, inside the transaction the forward-only rule
 * already pays for. A person who clicks mail from eleven different sites
 * loses their oldest click, which costs an attribution rather than a fact
 * anybody else reads.
 *=========================================*/

/** The field on `emailDeliveries/{key}` holding the per-host touches. */
export const EMAIL_TOUCH_FIELD = 'campaignTouches'

/**
 * How many sites' touches one person's document keeps.
 *
 * A cap, not a page size: the map lives in a document with a 1 MiB ceiling
 * and nothing else bounds how many sites may mail one address.
 */
export const EMAIL_TOUCH_MAX_HOSTS = 10

/**
 * The last campaign one person clicked on one site.
 *
 * A click on a SEQUENCE email (AGL-3254) is the same touch with two more
 * facts: the sequence and the enrollment the email went out under. The
 * campaign is then the container the sequence is in, and the identify
 * moments this touch is credited to read as the sequence's rather than as
 * a campaign send's.
 */
export interface EmailCampaignTouch {
  hostId: string
  campaignId: string
  /** When the click happened, epoch ms — the provider's instant. */
  clickedAtMs: number
  sequenceId?: string
  enrollmentId?: string
}

/** One host's entry in the touch map, as stored. */
interface StoredTouch {
  campaignId: string
  atMs: number
  sequenceId?: string
  enrollmentId?: string
}

/** Reads the touch map off a person document's data, defensively. */
function touchesFrom(
  data: Record<string, unknown> | null | undefined,
): Record<string, StoredTouch> {
  const raw = data?.[EMAIL_TOUCH_FIELD]
  if (!raw || typeof raw !== 'object') return {}
  const found: Record<string, StoredTouch> = {}
  for (const [hostId, entry] of Object.entries(
    raw as Record<
      string,
      { campaignId?: unknown; atMs?: unknown; sequenceId?: unknown; enrollmentId?: unknown }
    >,
  )) {
    const campaignId = String(entry?.campaignId ?? '')
    const atMs = Number(entry?.atMs ?? 0)
    if (!campaignId || !Number.isFinite(atMs) || atMs <= 0) continue
    const sequenceId = String(entry?.sequenceId ?? '')
    const enrollmentId = String(entry?.enrollmentId ?? '')
    found[hostId] = {
      campaignId,
      atMs,
      ...(sequenceId && enrollmentId ? { sequenceId, enrollmentId } : {}),
    }
  }
  return found
}

/**
 * Records that this person clicked this campaign's mail. Never throws.
 *
 * Forward-only, in a transaction, for the reason the delivery log's
 * `recordPersonEngagement` is: provider delivery is at-least-once and unordered, so a replayed click
 * from last month must not displace this week's. That same property is what
 * makes this idempotent — a redelivered event finds its own instant already
 * stored and writes nothing.
 *
 * @returns whether the touch moved forward.
 */
export async function recordEmailCampaignTouch(
  touch: {
    email: string | null | undefined
    hostId: string
    campaignId: string
    atMs: number
    /** Both or neither: a sequence click names the enrollment it came through. */
    sequenceId?: string
    enrollmentId?: string
  },
  firestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(touch.email)
  const hostId = String(touch.hostId ?? '')
  const campaignId = String(touch.campaignId ?? '')
  const atMs = Number(touch.atMs)
  if (!key || !hostId || !campaignId) return false
  if (!Number.isFinite(atMs) || atMs <= 0) return false
  const sequenceId = String(touch.sequenceId ?? '')
  const enrollmentId = String(touch.enrollmentId ?? '')
  const viaSequence = sequenceId && enrollmentId ? { sequenceId, enrollmentId } : {}

  try {
    const db = firestore ?? defaultFirestore()
    const ref = db.collection(EMAIL_DELIVERIES_COLLECTION).doc(key)
    let moved = false
    await db.runTransaction(async (transaction: any) => {
      moved = false
      const snapshot = await transaction.get(ref)
      const stored = touchesFrom(
        (snapshot.exists ? snapshot.data() : null) ?? {},
      )
      const held = stored[hostId]
      // Not newer than what is already there, so nothing is written. An
      // out-of-order or replayed event is the ordinary case this skips.
      if (held && held.atMs >= atMs) return

      /*
       * A merge-set merges nested maps at depth, so a campaign click after a
       * sequence click would keep the sequence's ids beside the new campaign
       * unless they are deleted by name: the two are written as the value
       * or as `FieldValue.delete()` whenever the held entry carried them.
       */
      const dropSequence =
        held?.sequenceId && !('sequenceId' in viaSequence)
          ? { sequenceId: FieldValue.delete(), enrollmentId: FieldValue.delete() }
          : {}
      const update: Record<string, unknown> = {
        [hostId]: { campaignId, atMs, ...viaSequence, ...dropSequence },
      }
      /*
       * EVICTION, and only when this host is NEW to the map. Replacing an
       * existing host's touch cannot grow it, so the cap is checked exactly
       * where the map can cross it. The oldest goes, because the window makes
       * an old touch the one least likely to be credited with anything.
       *
       * `FieldValue.delete()` INSIDE the map: a merge-set merges nested maps
       * at depth, which is what keeps every other host's touch — and is also
       * why an evicted key has to be deleted explicitly rather than by
       * omission.
       */
      if (!held && Object.keys(stored).length >= EMAIL_TOUCH_MAX_HOSTS) {
        const oldest = Object.entries(stored).sort(
          (a, b) => a[1].atMs - b[1].atMs || a[0].localeCompare(b[0]),
        )[0]
        if (oldest) update[oldest[0]] = FieldValue.delete()
      }

      transaction.set(
        ref,
        { [EMAIL_TOUCH_FIELD]: update, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
      moved = true
    })
    return moved
  } catch (error) {
    console.error('[email-campaign-touch] campaign touch write failed', error)
    return false
  }
}

/**
 * The last campaign this person clicked on this site, or `null`.
 *
 * One keyed document read — no query, no index, and nothing that can be
 * truncated. `null` for an address we hold no touch for AND for a read that
 * failed, which are the same answer on purpose: both mean "we cannot say
 * which campaign preceded this order", and the only safe thing to do with
 * that is credit nobody.
 */
export async function readEmailCampaignTouch(
  email: string | null | undefined,
  hostId: string,
  firestore?: any,
): Promise<EmailCampaignTouch | null> {
  const key = emailSuppressionKey(email)
  if (!key || !hostId) return null
  try {
    const db = firestore ?? defaultFirestore()
    const snapshot = await db
      .collection(EMAIL_DELIVERIES_COLLECTION)
      .doc(key)
      .get()
    const held = touchesFrom(snapshot.data() ?? {})[hostId]
    if (!held) return null
    return {
      hostId,
      campaignId: held.campaignId,
      clickedAtMs: held.atMs,
      ...(held.sequenceId && held.enrollmentId
        ? { sequenceId: held.sequenceId, enrollmentId: held.enrollmentId }
        : {}),
    }
  } catch (error) {
    console.error('[email-campaign-touch] campaign touch read failed', error)
    return null
  }
}

/**
 * Forgets every site's touch for one person, by `emailSuppressionKey` — the
 * erasure's half of this module. Never throws; answers whether the field
 * was on the document to delete.
 *
 * `update()` rather than a merge-set: a person the log never held has no
 * document, and an erasure must not leave one behind holding a deletion.
 */
export async function eraseEmailCampaignTouches(
  key: string | null | undefined,
  firestore?: any,
): Promise<boolean> {
  if (!key || typeof key !== 'string') return false
  try {
    const db = firestore ?? defaultFirestore()
    const ref = db.collection(EMAIL_DELIVERIES_COLLECTION).doc(key)
    const snapshot = await ref.get()
    if (!snapshot.exists || !(EMAIL_TOUCH_FIELD in (snapshot.data() ?? {}))) return false
    await ref.update({ [EMAIL_TOUCH_FIELD]: FieldValue.delete() })
    return true
  } catch (error) {
    console.error('[email-campaign-touch] erasure failed', error)
    return false
  }
}
