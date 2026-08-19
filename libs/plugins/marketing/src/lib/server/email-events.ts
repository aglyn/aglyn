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
// AGL-1771 lifted `isDocumentId` here from the local copy AGL-1768 wrote. The
// copy's stated reason was wrong: `@nx/enforce-module-boundaries` does NOT
// refuse an edge between two feature plugins — every plugin carries only
// `aglyn:addons`, and that tag's rule permits `aglyn:addons` as a target, which
// is why `campaign-send.ts` already imports `@aglyn/plugins-commerce/model`. It
// now lives beside `updateExisting` in the library where Firestore paths are
// built, which was always the better home and is now the reachable one.
import { firebaseAdmin, updateExisting } from '@aglyn/tenant-data-admin'
// From the LEAF, not the barrel, for the same reason `isDocumentId` is
// (AGL-1771): a spec that mocks `@aglyn/tenant-data-admin` — which it must,
// because that graph reaches the admin SDK — would otherwise replace the real
// suppression writer with whatever the factory happened to list. A stub there
// is a false green on the one behaviour AGL-2407 is about.
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { createHmac, timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { assignExperimentVariant, type HostExperiment } from '../model/experiments'
// The one list `campaign-send` reads, keyed the one way it keys it.
import { suppressionId } from './campaign-send'

/**
 * Svix signature check (Resend webhooks): HMAC-SHA256 over
 * `{id}.{timestamp}.{payload}` with the base64 secret after `whsec_`;
 * the header carries space-delimited `v1,<base64sig>` entries.
 */
function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer,
  signatureHeader: string,
): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(payload)
      .digest()
    return signatureHeader.split(' ').some((entry) => {
      const [, signature] = entry.split(',')
      if (!signature) return false
      const candidate = Buffer.from(signature, 'base64')
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      )
    })
  } catch {
    return false
  }
}

/** Tags arrive as an array of {name, value} or a plain map — accept both. */
function tagMap(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const map: Record<string, string> = {}
    for (const tag of raw) {
      if (tag?.name) map[String(tag.name)] = String(tag.value ?? '')
    }
    return map
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    )
  }
  return {}
}

/**
 * A bounce or a complaint suppresses the address (AGL-1918).
 *
 * Until now this webhook answered `email.bounced` and `email.complained` with
 * `200 {ignored:true}` — acknowledged, and dropped. The consequences were not
 * cosmetic, because `campaign-send.ts` filters its audience against exactly
 * one list and nothing but an unsubscribe click ever wrote to it: a hard-bounced
 * address was re-sent on every subsequent campaign forever, and a spam
 * complaint had no effect on whether that complainant was mailed again. Both
 * are the behaviours mailbox providers measure a sending domain on, and
 * `aglyn.com` carries the password resets and receipts on the same key and the
 * same From address as the campaigns.
 *
 * WHICH failures suppress:
 *
 * - **Every complaint.** Someone pressed "report spam". There is no reading of
 *   that which permits mailing them again.
 * - **Permanent bounces only.** Resend reports `data.bounce.type` as
 *   `Permanent` or `Transient`. A transient bounce is a full mailbox or a
 *   greylisting server — suppressing on one would unsubscribe a real
 *   subscriber over a temporary condition at their provider, which is a
 *   customer's list being quietly destroyed by our error handling.
 * - An **unrecognised or absent** bounce type does NOT suppress. Guessing in
 *   the suppressing direction is the destructive guess, and the spec asserts
 *   the shape so a payload change fails as itself rather than by silently
 *   ceasing to suppress anything.
 *
 * The entry is keyed and shaped exactly as the unsubscribe handler's
 * (`suppressionId(email)` → `{ email, createdAt }`), because the reader does
 * not care how an address got there — it is one list, and a second shape would
 * be a second list that `campaign-send` reads half of. `createdAt` is written
 * only when the document is new, so a bounce arriving after an unsubscribe
 * does not restamp the date the person actually unsubscribed.
 *
 * WHERE it lands, since AGL-2407: BOTH lists, and the per-host one is now the
 * optional half.
 *
 * - The PLATFORM list (`emailSuppressions`) is always written. That is the
 *   half that did not exist: a bounce on an invite, a password reset, a
 *   receipt or a usage summary carries no `hostId` — only `campaign-send`
 *   ever stamped one — so this webhook had nowhere to file it and answered
 *   `200 {ignored:true}`, exactly as if the address were fine. A dead mailbox
 *   was re-mailed on every subsequent send, forever.
 * - The PER-HOST list is written when the send named a site, because that is
 *   the list `campaign-send` filters its audience against and a merchant's
 *   own list is theirs to see and undo (AGL-2410).
 *
 * A hard bounce is address-level truth and belongs on the platform list even
 * when a site was named — the mailbox does not exist for anyone. A COMPLAINT
 * is a judgement about one sender's mail, and it goes on the platform list too
 * for a narrower reason: the platform list is consulted only by bulk mail, and
 * someone who pressed "report spam" on anything from `noreply@aglyn.com` must
 * not receive more bulk mail from `noreply@aglyn.com`. Neither list is
 * consulted by transactional mail; see `email-suppression.ts` for why.
 */
async function recordDeliveryFailure(args: {
  firestore: FirebaseFirestore.Firestore
  /** Null when the send named no site — the case AGL-2407 exists for. */
  hostRef: FirebaseFirestore.DocumentReference | null
  type: 'email.bounced' | 'email.complained'
  recipient: string
  bounceType: string
  /** The `context` tag `sendEmail` stamps, naming which sender produced it. */
  context: string
  res: Parameters<PluginApiHandler>[1]
}) {
  const { firestore, hostRef, type, recipient, bounceType, context, res } = args
  if (!recipient) return res.status(200).json({ ignored: true })

  const complaint = type === 'email.complained'
  const permanent = bounceType.trim().toLowerCase() === 'permanent'
  if (!complaint && !permanent) {
    // A transient bounce is real information we deliberately do not act on.
    return res.status(200).json({ ok: true, suppressed: false })
  }
  const reason = complaint ? 'complaint' : 'bounce'

  // The platform list FIRST, and unconditionally. Ordered ahead of the
  // per-host write because it is the one that must happen for every failure:
  // if the per-host write throws, the outer handler answers 200 and the
  // address is still off the bulk senders' lists.
  await suppressEmail({
    email: recipient,
    reason,
    context: context || null,
    hostId: hostRef?.id ?? null,
    firestore,
  })

  if (hostRef) {
    const ref = hostRef.collection('suppressions').doc(suppressionId(recipient))
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref)
      transaction.set(
        ref,
        {
          email: recipient,
          reason,
          suppressedAt: FieldValue.serverTimestamp(),
          ...(existing.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      )
    })
  }
  return res
    .status(200)
    .json({ ok: true, suppressed: true, scope: hostRef ? 'host' : 'platform' })
}

/**
 * Resend event ingestion (AGL-268), relocated from the console app route
 * into its owning plugin (AGL-418) — the URL `/api/email/events` is
 * preserved through the plugin API dispatcher. Opened/clicked events
 * increment the tagged campaign's stats; clicks on experiment sends also
 * count as the recipient's variant conversion — the variant re-derives
 * deterministically from the address, so nothing per-send is stored.
 * Svix signs the RAW body: `req.rawBody` carries the exact request text.
 */
export const emailEventsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return res.status(501).json({ error: 'Webhook is not configured' })
  }
  const payload = Buffer.from(req.rawBody ?? '', 'utf8')
  const headers = req.headers as Partial<Record<string, string>>
  const svixId = String(headers['svix-id'] ?? '')
  const svixTimestamp = String(headers['svix-timestamp'] ?? '')
  const svixSignature = String(headers['svix-signature'] ?? '')
  if (
    !svixId ||
    !svixTimestamp ||
    !verifySvix(secret, svixId, svixTimestamp, payload, svixSignature)
  ) {
    return res.status(401).json({ error: 'Bad signature' })
  }

  try {
    const event = JSON.parse(payload.toString('utf8'))
    const type = String(event?.type ?? '')
    if (
      type !== 'email.opened' &&
      type !== 'email.clicked' &&
      type !== 'email.bounced' &&
      type !== 'email.complained'
    ) {
      return res.status(200).json({ ignored: true })
    }
    const data = event?.data ?? {}
    const tags = tagMap(data?.tags)
    const hostId = tags['hostId']
    const campaignId = tags['campaignId']
    const recipient = String(
      Array.isArray(data?.to) ? (data.to[0] ?? '') : (data?.to ?? ''),
    )
      .trim()
      .toLowerCase()
    // A path component, so "non-empty" was never the whole question.
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = isDocumentId(hostId)
      ? firestore.collection('hosts').doc(hostId)
      : null

    if (type === 'email.bounced' || type === 'email.complained') {
      // NO `hostId` gate here since AGL-2407. It used to sit above this
      // branch, which is what made every transactional bounce a no-op: only
      // `campaign-send` stamps a `hostId` tag, so a bounce on an invite or a
      // password reset failed the gate and was dropped with `ignored: true`.
      // The failure path needs no site at all — `recordDeliveryFailure` files
      // the platform record either way and adds the per-host one when there
      // is a host to add it to.
      return await recordDeliveryFailure({
        firestore,
        hostRef,
        type,
        recipient,
        bounceType: String(data?.bounce?.type ?? ''),
        context: tags['context'] ?? '',
        res,
      })
    }

    // Opens and clicks ARE per-campaign, so this pair still needs both ids —
    // and therefore still needs the host, which the failure path above no
    // longer does.
    if (!hostRef || !isDocumentId(campaignId)) {
      return res.status(200).json({ ignored: true })
    }
    // Plain refusal (AGL-1768). A merge-set against a missing path CREATES it,
    // so an open re-created a campaign the merchant had deleted — a document
    // holding a `stats` map and nothing else: no subject, no body, no
    // audience, no status. Opens trail sends by days, so deleting it again did
    // not help. `updateExisting` rejects only that case (gRPC NOT_FOUND) and
    // rethrows everything else, so a Firestore outage stays distinguishable
    // from an open against a deleted campaign instead of being swallowed by a
    // `.catch(() => undefined)`. AGL-1760's test — does refusing discard money
    // or work that already happened? — is passed: the open count for a
    // campaign that no longer exists has no reader.
    //
    // DOTTED FIELD PATH, not a nested map. `update({ stats: { opens: … } })`
    // REPLACES the whole `stats` map, so every open would clobber `clicks`;
    // only `set({ merge: true })` merges maps at depth.
    await updateExisting(hostRef.collection('campaigns').doc(campaignId), {
      [type === 'email.opened' ? 'stats.opens' : 'stats.clicks']:
        FieldValue.increment(1),
    })

    // Experiment conversion (AGL-268): clicks are the signal.
    const experimentId = tags['experimentId']
    if (type === 'email.clicked' && isDocumentId(experimentId) && recipient) {
      const experimentSnapshot = await hostRef
        .collection('experiments')
        .doc(experimentId)
        .get()
      const experiment = experimentSnapshot.data() as
        | HostExperiment
        | undefined
      if (experimentSnapshot.exists && experiment) {
        const variant = assignExperimentVariant(
          experiment,
          experimentId,
          recipient,
        )
        // `variant.id` is merchant-authored — `validateExperiment` checks the
        // ids are unique and nothing about their SHAPE — and it is a path
        // component here too.
        if (variant && isDocumentId(variant.id)) {
          // Still a merge-set, and deliberately so: this one CREATES. The
          // first conversion for a variant has no stats document yet, the
          // experiment it hangs off was just proven to exist, and the click
          // is work that really happened — refusing would discard it. The
          // `.catch(() => undefined)` is gone for the same reason as above: a
          // swallowed failure here is a conversion lost silently.
          await experimentSnapshot.ref
            .collection('stats')
            .doc(variant.id)
            .set(
              {
                conversions: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
        }
      }
    }
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    // Never make Resend retry-storm.
    return res.status(200).json({ ok: true })
  }
}
